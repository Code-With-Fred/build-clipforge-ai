import { generateObject } from 'ai'
import { z } from 'zod'
import { finalizePlan, formatTimestamp, transcriptForPrompt, type ClipPlan, type SourcePart, type TranscriptSegment } from '@/lib/shorts'

const pickSchema = z.object({
  clips: z.array(z.object({
    start: z.coerce.number().describe('Clip start time in seconds, taken from the transcript tags.'),
    title: z.string().describe('YouTube Shorts title, under 70 characters.'),
    reason: z.string().describe('One sentence on why this moment works as a standalone short.'),
    hook: z.string().optional().describe('On-screen hook for the first 3 seconds: 3-8 punchy words, no emojis, no hashtags.'),
    description: z.string().optional().describe('YouTube description for this short: 2-3 sentences in plain language about what is said in it. No hashtags.'),
    hashtags: z.string().optional().describe('3-5 relevant hashtags separated by spaces, starting with #Shorts.'),
  })),
})

export type PlanResult = { clips: ClipPlan[]; mode: 'ai' | 'even'; note?: string }

const SYSTEM_PROMPT = 'You are an expert YouTube Shorts editor. You select self-contained moments from long videos that hook viewers in the first two seconds. You never invent content that is not in the transcript.'

// Groq free-tier models, tried in order (a model Groq has retired is skipped automatically).
const GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct']

/**
 * Free path: Groq's OpenAI-compatible chat API in JSON mode, using the same GROQ_API_KEY
 * as transcription. (Vercel AI Gateway needs a card on file, even for its free credits.)
 */
async function planWithGroq(prompt: string): Promise<unknown> {
  const models = [process.env.CLIPFORGE_GROQ_MODEL, ...GROQ_MODELS].filter((model, index, all): model is string => Boolean(model) && all.indexOf(model) === index)
  const errors: string[] = []
  for (const model of models) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT} Reply with a single JSON object only.` },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.6,
        max_completion_tokens: 6000,
        ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    }).catch((error: unknown) => ({ ok: false, status: 0, json: async () => ({ error: { message: String(error) } }) }) as unknown as Response)
    const body = await response.json().catch(() => null) as { error?: { message?: string }; choices?: Array<{ message?: { content?: string } }> } | null
    if (response.ok) {
      const content = body?.choices?.[0]?.message?.content
      try { return JSON.parse(content || '') } catch { errors.push(`${model}: invalid JSON`); continue }
    }
    errors.push(`${model}: ${body?.error?.message || `HTTP ${response.status}`}`)
    if (response.status === 401) break // bad key: no other model will work
  }
  throw new Error(`Groq planning failed (${errors.join(' | ').slice(0, 400)})`)
}

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
  parts?: SourcePart[]
}): Promise<PlanResult> {
  const { videoDuration, count, clipDuration, segments, parts = [] } = options
  const evenly = () => finalizePlan([], videoDuration, count, clipDuration, parts)
  if (segments.length < 5) return { clips: evenly(), mode: 'even' }

  const useGroq = Boolean(process.env.GROQ_API_KEY) && !process.env.CLIPFORGE_AI_MODEL
  // Groq's free tier allows only a few thousand tokens per request, so send a compact transcript.
  const transcriptBudget = useGroq ? 16_000 : 180_000
  const prompt = `Video: "${options.videoName}" (${formatTimestamp(videoDuration)} long).
Pick exactly ${count} moments for ${clipDuration}-second YouTube Shorts.

Rules:
- Each start must be a [Ns] tag value from the transcript (or within a few seconds of one), and start + ${clipDuration} must be <= ${Math.floor(videoDuration)}.
- Clips must not overlap: starts at least ${clipDuration} seconds apart.
- Start at the beginning of a sentence or thought, not mid-word. Favour strong hooks, surprising claims, stories, punchlines, clear tips, and emotional peaks.
- Each clip must make sense with no other context.
- Spread picks across the whole video when quality is similar.
- Titles: honest, specific, curiosity-driving, under 70 characters, no hashtags. Every title must be different.
- Hooks: a short line that makes someone stop scrolling, true to what is said in the clip.
- Descriptions: unique per clip, written for that clip only, faithful to the transcript. Never invent facts, quotes, or names.

Return JSON shaped exactly like:
{"clips":[{"start":123,"title":"...","reason":"...","hook":"...","description":"...","hashtags":"#Shorts #..."}]}

Transcript (each line tagged with its start time in seconds):
${transcriptForPrompt(segments, transcriptBudget)}`

  try {
    let picks: z.infer<typeof pickSchema>
    if (useGroq) {
      const parsed = pickSchema.safeParse(await planWithGroq(prompt))
      if (!parsed.success) throw new Error(`Groq returned an unexpected shape: ${parsed.error.issues[0]?.message}`)
      picks = parsed.data
    } else {
      const { object } = await generateObject({
        model: process.env.CLIPFORGE_AI_MODEL || 'anthropic/claude-sonnet-4.6',
        schema: pickSchema,
        system: SYSTEM_PROMPT,
        prompt,
      })
      picks = object
    }
    const clips = finalizePlan(picks.clips, videoDuration, count, clipDuration, parts)
    return { clips, mode: 'ai' }
  } catch (error) {
    console.error('[clipforge] AI planning failed, using even spread', error)
    return {
      clips: evenly(),
      mode: 'even',
      note: `AI moment selection was unavailable, so clips were spread evenly (${error instanceof Error ? error.message.slice(0, 160) : 'unknown error'}).`,
    }
  }
}
