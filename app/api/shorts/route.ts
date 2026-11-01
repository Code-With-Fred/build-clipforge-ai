import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { planShorts } from '@/lib/ai-planner'
import { clipTransformation, clipUrl, getCloudinaryConfig, getVideoResource, MISSING_CONFIG_MESSAGE, queueClipRenders } from '@/lib/cloudinary'
import { db } from '@/lib/db'
import { ensureClipTable } from '@/lib/db/ensure'
import { clip, project, upload } from '@/lib/db/schema'
import { OWNER_ID } from '@/lib/owner'
import { feasibleCount, parseTranscript, SHORTS_LIMITS } from '@/lib/shorts'

export const runtime = 'nodejs'
export const maxDuration = 120

const requestSchema = z.object({
  publicId: z.string().min(1).max(500),
  name: z.string().trim().min(1).max(200),
  sourceLabel: z.string().max(2000).optional(),
  bytes: z.number().int().nonnegative().optional(),
  count: z.number().int().min(SHORTS_LIMITS.minCount).max(SHORTS_LIMITS.maxCount),
  clipDuration: z.number().int().min(SHORTS_LIMITS.minClipSeconds).max(SHORTS_LIMITS.maxClipSeconds),
  crop: z.enum(['center', 'smart', 'blur']),
  grayscale: z.boolean(),
  transcript: z.string().max(500_000).optional(),
})

export async function POST(request: Request) {
  const config = getCloudinaryConfig()
  if (!config) return NextResponse.json({ error: MISSING_CONFIG_MESSAGE }, { status: 503 })

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid shorts request.', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data

  // Trust Cloudinary, not the browser, for the real duration.
  let videoDuration: number
  try {
    const resource = await getVideoResource(config, input.publicId)
    videoDuration = Number(resource.duration)
  } catch (error) {
    return NextResponse.json({ error: `Could not read the uploaded video from Cloudinary: ${error instanceof Error ? error.message : 'unknown error'}` }, { status: 502 })
  }
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
    return NextResponse.json({ error: 'Cloudinary has not reported a duration for this video yet. Wait a moment and try again.' }, { status: 409 })
  }
  if (feasibleCount(videoDuration, input.clipDuration, input.count) < 1) {
    return NextResponse.json({ error: `The video is shorter than one ${input.clipDuration}-second clip.` }, { status: 400 })
  }

  await ensureClipTable()

  const plan = await planShorts({
    videoDuration,
    count: input.count,
    clipDuration: input.clipDuration,
    segments: input.transcript ? parseTranscript(input.transcript) : [],
    videoName: input.name,
  })

  const projectId = randomUUID()
  const now = new Date()
  const clips = plan.clips.map((planned, index) => {
    const transformation = clipTransformation({ start: planned.start, duration: planned.duration, crop: input.crop, grayscale: input.grayscale })
    return {
      id: randomUUID(),
      projectId,
      userId: OWNER_ID,
      position: index + 1,
      start: planned.start,
      duration: planned.duration,
      title: planned.title,
      reason: planned.reason,
      transformation,
      url: clipUrl(config.cloudName, input.publicId, transformation),
      status: 'processing',
      createdAt: now,
      updatedAt: now,
    }
  })

  await db.insert(project).values({
    id: projectId,
    userId: OWNER_ID,
    name: input.name,
    status: 'processing',
    duration: Math.round(videoDuration),
    sourcePathname: input.publicId,
  })
  await db.insert(upload).values({
    id: randomUUID(),
    userId: OWNER_ID,
    projectId,
    pathname: input.publicId,
    filename: input.sourceLabel || input.name,
    contentType: 'video/mp4',
    size: Math.min(input.bytes ?? 0, 2_147_483_647),
  })
  await db.insert(clip).values(clips)

  try {
    await queueClipRenders(config, input.publicId, clips.map((item) => item.transformation))
  } catch (error) {
    await db.update(project).set({ status: 'failed', updatedAt: new Date() }).where(eq(project.id, projectId))
    return NextResponse.json({ error: `Cloudinary refused the render job: ${error instanceof Error ? error.message : 'unknown error'}`, projectId }, { status: 502 })
  }

  return NextResponse.json({ projectId, mode: plan.mode, note: plan.note, videoDuration }, { status: 201 })
}
