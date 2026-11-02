import { and, asc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CaptionPosition, CaptionStyle } from '@/lib/captions'
import { deleteProject, freeSourceStorage, storageSummary } from '@/lib/cleanup'
import { checkClipReady, clipUrl, finishingTransformation, getCloudinaryConfig, queueClipRenders, saveRenderedClip, savedClipUrl, uploadCaptions } from '@/lib/cloudinary'
import { db } from '@/lib/db'
import { ensureClipTable } from '@/lib/db/ensure'
import { clip, project } from '@/lib/db/schema'
import { OWNER_ID } from '@/lib/owner'

export const runtime = 'nodejs'
export const maxDuration = 120

// Eager renders of an hour-long source can take a while; give up well after that.
const RENDER_TIMEOUT_MS = 2 * 60 * 60 * 1000
// Burning captions onto a saved 1-minute short normally takes well under this.
const FINISHING_TIMEOUT_MS = 20 * 60 * 1000
// Saving + captioning is a few Cloudinary calls per clip; cap per poll to stay within limits.
const FINISH_PER_POLL = 3

type ClipRow = typeof clip.$inferSelect

/**
 * Each short moves through: processing (base render on the long video)
 *   → finishing (saved as its own asset; captions + hook burned on-the-fly)
 *   → ready.
 * If captioning fails, the plain render is delivered instead of nothing.
 * Shorts without captions/hook are also saved as their own asset, so the big source
 * video can be deleted afterwards (see lib/cleanup.ts) without breaking downloads.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params

  await ensureClipTable()
  const owned = await db.query.project.findFirst({ where: and(eq(project.id, projectId), eq(project.userId, OWNER_ID)) })
  if (!owned) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  let clips = await db.select().from(clip).where(eq(clip.projectId, projectId)).orderBy(asc(clip.position))
  const config = getCloudinaryConfig()

  if (owned.status !== 'failed' && clips.some((item) => item.status !== 'ready')) {
    let finishBudget = FINISH_PER_POLL
    const update = async (item: ClipRow, changes: Partial<ClipRow>) => {
      await db.update(clip).set({ ...changes, updatedAt: new Date() }).where(eq(clip.id, item.id))
      return { ...item, ...changes }
    }
    const deliverPlain = (item: ClipRow, reason: string) =>
      update(item, { status: 'ready', url: item.renderUrl || item.url, finishing: 'failed', detail: item.layout === 'split' ? `The split-screen render failed (${reason.slice(0, 200)}); this is the top half only. Try again or use the full layout.` : `Captions could not be added (${reason.slice(0, 200)}); the plain short is ready.` })

    clips = await Promise.all(clips.map(async (item) => {
      if (item.status === 'ready') return item

      if (item.status === 'processing') {
        const base = await checkClipReady(item.renderUrl || item.url)
        if (!base.ready) return item
        if (!config) return update(item, { status: 'ready' })
        if (finishBudget <= 0) return item
        finishBudget -= 1
        if (item.finishing !== 'pending') {
          try {
            const saved = await saveRenderedClip(config, item.renderUrl || item.url, `clipforge/shorts/${item.id}`)
            return update(item, { status: 'ready', url: savedClipUrl(config.cloudName, saved.public_id) })
          } catch {
            return update(item, { status: 'ready' }) // still downloadable from the source render
          }
        }
        try {
          const saved = await saveRenderedClip(config, item.renderUrl || item.url, `clipforge/shorts/${item.id}`)
          const captionsId = item.captions ? `clipforge/captions/${item.id}.srt` : undefined
          if (captionsId) await uploadCaptions(config, item.captions, captionsId)
          const finishing = finishingTransformation({
            captionsPublicId: captionsId,
            hookText: item.hook || undefined,
            captionStyle: item.captionStyle as CaptionStyle,
            captionPosition: item.captionPosition as CaptionPosition,
            gameplay: item.layout === 'split' && item.gameplayPublicId ? { publicId: item.gameplayPublicId, start: item.gameplayStart, duration: item.duration } : undefined,
          })
          // Background render: works for shorts above the on-the-fly size limit (40 MB on Free).
          await queueClipRenders(config, saved.public_id, [finishing])
          const finalUrl = clipUrl(config.cloudName, saved.public_id, finishing)
          return update(item, { status: 'finishing', finishing: 'applied', url: finalUrl, detail: '' })
        } catch (error) {
          return deliverPlain(item, error instanceof Error ? error.message : 'unknown error')
        }
      }

      if (item.status === 'finishing') {
        const final = await checkClipReady(item.url)
        if (final.ready) return update(item, { status: 'ready' })
        // 423, timeouts and "too large / processing" mean still rendering; other 4xx mean
        // Cloudinary rejected the overlay itself (e.g. an invalid caption file).
        const waiting = final.status === undefined || final.status === 423 || /too large|process|async|eager/i.test(final.detail || '')
        const rejected = !waiting && final.status !== undefined && final.status >= 400 && final.status < 500
        const stale = Date.now() - item.updatedAt.getTime() > FINISHING_TIMEOUT_MS
        if (rejected || stale) return deliverPlain(item, final.detail || 'timed out')
      }
      return item
    }))

    const allReady = clips.every((item) => item.status === 'ready')
    const timedOut = !allReady && Date.now() - owned.createdAt.getTime() > RENDER_TIMEOUT_MS
    if (allReady || timedOut) {
      const status = allReady ? 'ready' : 'failed'
      await db.update(project).set({ status, updatedAt: new Date() }).where(eq(project.id, projectId))
      owned.status = status
      // All shorts exist on their own now: free the big source video automatically.
      if (allReady) await freeSourceStorage(projectId, 0).catch((error) => console.error('[clipforge] auto-free failed', error))
    }
  }

  return NextResponse.json({
    storage: await storageSummary(projectId),
    project: { id: owned.id, name: owned.name, status: owned.status, duration: owned.duration, createdAt: owned.createdAt, rightsSource: owned.rightsSource, rightsProof: owned.rightsProof },
    clips: clips.map(({ userId: _userId, transformation: _transformation, renderUrl: _renderUrl, finishing: _finishing, ...rest }) => rest),
  })
}

const checkSchema = z.object({ clipId: z.string().min(1), youtubeCheck: z.enum(['pending', 'passed', 'claimed']) })

/** Record the result of YouTube Studio's copyright check for one short. */
export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const parsed = checkSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid copyright check update.' }, { status: 400 })

  await ensureClipTable()
  const [updated] = await db.update(clip)
    .set({ youtubeCheck: parsed.data.youtubeCheck, updatedAt: new Date() })
    .where(and(eq(clip.id, parsed.data.clipId), eq(clip.projectId, projectId), eq(clip.userId, OWNER_ID)))
    .returning({ id: clip.id, youtubeCheck: clip.youtubeCheck })
  if (!updated) return NextResponse.json({ error: 'Short not found.' }, { status: 404 })
  return NextResponse.json(updated)
}

/** Delete the project, its shorts and every Cloudinary file it created. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  await ensureClipTable()
  try {
    const result = await deleteProject(projectId)
    if (!result.deleted) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    return NextResponse.json({ error: `Could not delete the project: ${error instanceof Error ? error.message : 'unknown error'}` }, { status: 502 })
  }
}
