import { generateObject } from 'ai'
import { z } from 'zod'
import { finalizePlan, formatTimestamp, planEvenly, transcriptForPrompt, type ClipPlan, type TranscriptSegment } from '@/lib/shorts'

const pickSchema = z.object({
  clips: z.array(z.object({
    start: z.number().describe('Clip start time in seconds, taken from the transcript tags.'),
    title: z.string().describe('YouTube Shorts title, under 70 characters.'),
    reason: z.string().describe('One sentence on why this moment works as a standalone short.'),
  })),
})

export type PlanResult = { clips: ClipPlan[]; mode: 'ai' | 'even'; note?: string }

/**
 * Pick the strongest moments from a timestamped transcript. Without a transcript the
 * model cannot see or hear the video, so we spread clips evenly instead of guessing.
 */
export async function planShorts(options: {
  videoDuration: number
  count: number
  clipDuration: number
  segments: TranscriptSegment[]
  videoName: string
}): Promise<PlanResult> {
  const { videoDuration, count, clipDuration, segments } = options
  if (segments.length < 5) return { clips: planEvenly(videoDuration, count, clipDuration), mode: 'even' }

  try {
    const { object } = await generateObject({
      model: process.env.CLIPFORGE_AI_MODEL || 'anthropic/claude-sonnet-4.6',
      schema: pickSchema,
      system: 'You are an expert YouTube Shorts editor. You select self-contained moments from long videos that hook viewers in the first two seconds. You never invent content that is not in the transcript.',
      prompt: `Video: "${options.videoName}" (${formatTimestamp(videoDuration)} long).
Pick exactly ${count} moments for ${clipDuration}-second YouTube Shorts.

Rules:
- Each start must be a [Ns] tag value from the transcript (or within a few seconds of one), and start + ${clipDuration} must be <= ${Math.floor(videoDuration)}.
- Clips must not overlap: starts at least ${clipDuration} seconds apart.
- Start at the beginning of a sentence or thought, not mid-word. Favour strong hooks, surprising claims, stories, punchlines, clear tips, and emotional peaks.
- Each clip must make sense with no other context.
- Spread picks across the whole video when quality is similar.
- Titles: honest, specific, curiosity-driving, under 70 characters, no hashtags.

Transcript (each line tagged with its start time in seconds):
${transcriptForPrompt(segments)}`,
    })
    const clips = finalizePlan(object.clips, videoDuration, count, clipDuration)
    return { clips, mode: 'ai' }
  } catch (error) {
    console.error('[clipforge] AI planning failed, using even spread', error)
    return {
      clips: planEvenly(videoDuration, count, clipDuration),
      mode: 'even',
      note: 'AI moment selection was unavailable, so clips were spread evenly. Check AI Gateway access.',
    }
  }
}
