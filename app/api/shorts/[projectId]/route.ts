import { and, asc, eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { checkClipReady } from '@/lib/cloudinary'
import { db } from '@/lib/db'
import { ensureClipTable } from '@/lib/db/ensure'
import { clip, project } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const maxDuration = 60

// Eager renders of an hour-long source can take a while; give up well after that.
const RENDER_TIMEOUT_MS = 2 * 60 * 60 * 1000

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { projectId } = await params

  await ensureClipTable()
  const owned = await db.query.project.findFirst({ where: and(eq(project.id, projectId), eq(project.userId, session.user.id)) })
  if (!owned) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  let clips = await db.select().from(clip).where(eq(clip.projectId, projectId)).orderBy(asc(clip.position))
  const pending = clips.filter((item) => item.status !== 'ready')

  if (pending.length && owned.status !== 'failed') {
    const checks = await Promise.all(pending.map(async (item) => ({ id: item.id, ...(await checkClipReady(item.url)) })))
    const readyIds = checks.filter((check) => check.ready).map((check) => check.id)
    if (readyIds.length) {
      await db.update(clip).set({ status: 'ready', updatedAt: new Date() }).where(inArray(clip.id, readyIds))
    }
    clips = clips.map((item) => (readyIds.includes(item.id) ? { ...item, status: 'ready' } : item))

    const allReady = clips.every((item) => item.status === 'ready')
    const timedOut = !allReady && Date.now() - owned.createdAt.getTime() > RENDER_TIMEOUT_MS
    if (allReady || timedOut) {
      const status = allReady ? 'ready' : 'failed'
      await db.update(project).set({ status, updatedAt: new Date() }).where(eq(project.id, projectId))
      owned.status = status
    }
  }

  return NextResponse.json({
    project: { id: owned.id, name: owned.name, status: owned.status, duration: owned.duration, createdAt: owned.createdAt },
    clips: clips.map(({ userId: _userId, transformation: _transformation, ...rest }) => rest),
  })
}
