import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { planShorts } from '@/lib/ai-planner'
import { buildClipCues, CAPTION_STYLE_IDS, fallbackHook, toSrt, type CaptionStyle, type TimedWord } from '@/lib/captions'
import { assignGameplay } from '@/lib/gameplay'
import { clipTransformation, clipUrl, getCloudinaryConfig, getVideoResource, MISSING_CONFIG_MESSAGE, queueClipRenders } from '@/lib/cloudinary'
import { db } from '@/lib/db'
import { ensureClipTable } from '@/lib/db/ensure'
import { clip, gameplay, project, upload } from '@/lib/db/schema'
import { OWNER_ID } from '@/lib/owner'
import { feasibleCount, parseTranscript, partIndexFor, SHORTS_LIMITS, type SourcePart, type TranscriptSegment } from '@/lib/shorts'
import { transcribeAudioUrl, transcriptionAvailable } from '@/lib/transcribe'

export const runtime = 'nodejs'
// Transcribing an hour of audio can take a minute or two.
export const maxDuration = 300

// `duration` is what Cloudinary returned for the upload; used when the Admin API omits it.
const sourceSchema = z.object({ publicId: z.string().min(1).max(500), bytes: z.number().int().nonnegative().optional(), duration: z.number().positive().optional() })

const requestSchema = z.object({
  // A long video may arrive as several consecutive parts (split in the browser to fit
  // the Cloudinary plan's per-file size limit). `publicId` is kept for single uploads.
  sources: z.array(sourceSchema).min(1).max(50).optional(),
  publicId: z.string().min(1).max(500).optional(),
  name: z.string().trim().min(1).max(200),
  sourceLabel: z.string().max(2000).optional(),
  bytes: z.number().int().nonnegative().optional(),
  count: z.number().int().min(SHORTS_LIMITS.minCount).max(SHORTS_LIMITS.maxCount),
  clipDuration: z.number().int().min(SHORTS_LIMITS.minClipSeconds).max(SHORTS_LIMITS.maxClipSeconds),
  crop: z.enum(['center', 'smart', 'blur']),
  grayscale: z.boolean(),
  transcript: z.string().max(500_000).optional(),
  // Audio track extracted in the browser and uploaded to Cloudinary, for auto-transcription.
  audioPublicId: z.string().min(1).max(500).optional(),
  captions: z.boolean().default(true),
  hook: z.boolean().default(true),
  layout: z.enum(['full', 'split']).default('full'),
  // Split-screen: which library clips to use (all when omitted).
  gameplayIds: z.array(z.string().min(1)).max(50).optional(),
  captionStyle: z.enum(CAPTION_STYLE_IDS as [CaptionStyle, ...CaptionStyle[]]).default('classic'),
  captionPosition: z.enum(['lower', 'middle']).default('lower'),
  sourceCredit: z.string().trim().max(300).optional(),
  // Where the right to clip comes from. "Not sure" is not accepted: those clips get claimed.
  rightsSource: z.enum(['own', 'permission'], { message: 'Choose where your rights to clip this video come from.' }),
  rightsProof: z.string().trim().max(500).optional(),
}).refine((value) => value.rightsSource !== 'permission' || Boolean(value.rightsProof), {
  message: 'Add the clipping campaign or permission link.',
  path: ['rightsProof'],
})

export async function POST(request: Request) {
  const config = getCloudinaryConfig()
  if (!config) return NextResponse.json({ error: MISSING_CONFIG_MESSAGE }, { status: 503 })

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid shorts request.', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const sources = input.sources ?? (input.publicId ? [{ publicId: input.publicId, bytes: input.bytes }] : [])
  if (!sources.length) return NextResponse.json({ error: 'No uploaded video was provided.' }, { status: 400 })

  // Trust Cloudinary, not the browser, for each part's real duration.
  let durations: number[]
  try {
    durations = await Promise.all(sources.map(async (source) => (await getVideoResource(config, source.publicId)).duration ?? Number(source.duration)))
  } catch (error) {
    return NextResponse.json({ error: `Could not read the uploaded video from Cloudinary: ${error instanceof Error ? error.message : 'unknown error'}` }, { status: 502 })
  }
  if (durations.some((value) => !Number.isFinite(value) || value <= 0)) {
    return NextResponse.json({ error: 'Cloudinary has not reported a duration for this video yet. Wait a moment and try again.' }, { status: 409 })
  }
  const parts: SourcePart[] = []
  for (const duration of durations) {
    const previous = parts[parts.length - 1]
    parts.push({ offset: previous ? previous.offset + previous.duration : 0, duration })
  }
  const videoDuration = parts[parts.length - 1].offset + parts[parts.length - 1].duration
  if (feasibleCount(videoDuration, input.clipDuration, input.count) < 1) {
    return NextResponse.json({ error: `This video is ${Math.round(videoDuration)} seconds long, shorter than one ${input.clipDuration}-second short. Pick a shorter "Length of each short" or use a longer video.` }, { status: 400 })
  }

  await ensureClipTable()

  // Split-screen needs at least one gameplay clip longer than a short; check before any work.
  let library: Array<{ publicId: string; duration: number }> = []
  if (input.layout === 'split') {
    library = await db.select({ publicId: gameplay.publicId, duration: gameplay.duration }).from(gameplay)
      .where(input.gameplayIds?.length ? and(eq(gameplay.userId, OWNER_ID), inArray(gameplay.id, input.gameplayIds)) : eq(gameplay.userId, OWNER_ID))
    if (!library.some((item) => item.duration >= input.clipDuration + 1)) {
      return NextResponse.json({ error: `Split-screen needs a gameplay clip longer than ${input.clipDuration} seconds. Add one in the gameplay library.` }, { status: 400 })
    }
  }

  // Transcript: pasted by the user, else transcribed automatically from the audio track.
  let segments: TranscriptSegment[] = input.transcript ? parseTranscript(input.transcript) : []
  let words: TimedWord[] = []
  let transcriptSource: 'pasted' | 'auto' | 'none' = segments.length ? 'pasted' : 'none'
  let transcriptNote: string | undefined
  if (!segments.length && input.audioPublicId) {
    if (!transcriptionAvailable()) {
      transcriptNote = 'Add a free GROQ_API_KEY (console.groq.com) in Vercel to get automatic captions, hooks and AI-picked moments.'
    } else {
      try {
        const audioUrl = `https://res.cloudinary.com/${config.cloudName}/video/upload/${input.audioPublicId.split('/').map(encodeURIComponent).join('/')}.mp3`
        const transcript = await transcribeAudioUrl(audioUrl)
        segments = transcript.segments
        words = transcript.words
        if (segments.length) transcriptSource = 'auto'
      } catch (error) {
        transcriptNote = `Automatic transcription failed, so there are no captions: ${error instanceof Error ? error.message : 'unknown error'}`
      }
    }
  }

  const plan = await planShorts({
    videoDuration,
    count: input.count,
    clipDuration: input.clipDuration,
    segments,
    videoName: input.name,
    parts,
  })
  const credit = input.sourceCredit ? `Credit: ${input.sourceCredit}` : ''
  const gameplayPicks = input.layout === 'split' ? assignGameplay(plan.clips.length, input.clipDuration, library) ?? [] : []

  const projectId = randomUUID()
  const now = new Date()
  const clips = plan.clips.map((planned, index) => {
    // Clips never straddle a part boundary (finalizePlan guarantees it); cut from the owning part.
    const partIndex = Math.max(0, partIndexFor(planned.start, planned.duration, parts))
    const publicId = sources[partIndex].publicId
    const localStart = Math.max(0, planned.start - parts[partIndex].offset)
    const transformation = clipTransformation({ start: localStart, duration: planned.duration, crop: input.crop, grayscale: input.grayscale, layout: input.layout })
    const pick = gameplayPicks[index]
    const cues = buildClipCues({ words, segments }, planned.start, planned.duration)
    const captions = input.captions && cues.length ? toSrt(cues) : ''
    const hook = input.hook ? (planned.hook || fallbackHook(cues)) : ''
    const renderUrl = clipUrl(config.cloudName, publicId, transformation)
    return {
      publicId,
      id: randomUUID(),
      projectId,
      userId: OWNER_ID,
      position: index + 1,
      start: planned.start,
      duration: planned.duration,
      title: planned.title,
      reason: planned.reason,
      transformation,
      url: renderUrl,
      renderUrl,
      status: 'processing',
      hook,
      captions,
      description: [planned.description || '', credit].filter(Boolean).join('\n\n'),
      hashtags: planned.hashtags || '#Shorts',
      // 'pending' = burn captions/hook after the base render; 'none' = deliver as rendered.
      finishing: captions || hook || pick ? 'pending' : 'none',
      layout: pick ? 'split' : 'full',
      gameplayPublicId: pick?.publicId ?? null,
      gameplayStart: pick?.start ?? 0,
      captionStyle: input.captionStyle,
      captionPosition: input.captionPosition,
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
    sourcePathname: sources.map((source) => source.publicId).join(','),
    rightsSource: input.rightsSource,
    rightsProof: input.rightsProof || null,
  })
  await db.insert(upload).values(sources.map((source, index) => ({
    id: randomUUID(),
    userId: OWNER_ID,
    projectId,
    pathname: source.publicId,
    filename: sources.length > 1 ? `${input.sourceLabel || input.name} (part ${index + 1}/${sources.length})` : input.sourceLabel || input.name,
    contentType: 'video/mp4',
    size: Math.min(source.bytes ?? 0, 2_147_483_647),
  })))
  // Track the audio track too, so freeing storage removes it with the source.
  if (input.audioPublicId) {
    await db.insert(upload).values({
      id: randomUUID(),
      userId: OWNER_ID,
      projectId,
      pathname: input.audioPublicId,
      filename: `${input.name} (audio for captions)`,
      contentType: 'audio/mpeg',
      size: 0,
    })
  }
  await db.insert(clip).values(clips.map(({ publicId: _publicId, ...row }) => row))

  try {
    for (const source of sources) {
      const transformations = clips.filter((item) => item.publicId === source.publicId).map((item) => item.transformation)
      if (transformations.length) await queueClipRenders(config, source.publicId, transformations)
    }
  } catch (error) {
    await db.update(project).set({ status: 'failed', updatedAt: new Date() }).where(eq(project.id, projectId))
    return NextResponse.json({ error: `Cloudinary refused the render job: ${error instanceof Error ? error.message : 'unknown error'}`, projectId }, { status: 502 })
  }

  return NextResponse.json({ projectId, mode: plan.mode, note: [transcriptNote, plan.note].filter(Boolean).join(' '), transcript: transcriptSource, videoDuration, parts: sources.length }, { status: 201 })
}
