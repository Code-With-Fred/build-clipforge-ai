// Server-only: transcribe audio with Whisper (word-level timestamps).
// Providers (first configured wins), both OpenAI-compatible:
//   GROQ_API_KEY   — free tier (no card): ~8 h of audio/day, 25 MB per file
//   OPENAI_API_KEY — paid (~$0.006/min)
// Only used when the user did not paste a transcript.

import type { TimedWord } from '@/lib/captions'
import type { TranscriptSegment } from '@/lib/shorts'

export type Transcript = { words: TimedWord[]; segments: TranscriptSegment[] }

const WHISPER_MAX_BYTES = 25 * 1024 * 1024

function provider() {
  if (process.env.GROQ_API_KEY) {
    return {
      name: 'Groq',
      apiKey: process.env.GROQ_API_KEY,
      url: 'https://api.groq.com/openai/v1/audio/transcriptions',
      model: process.env.CLIPFORGE_TRANSCRIBE_MODEL || 'whisper-large-v3-turbo',
    }
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      name: 'OpenAI',
      apiKey: process.env.OPENAI_API_KEY,
      url: 'https://api.openai.com/v1/audio/transcriptions',
      model: process.env.CLIPFORGE_TRANSCRIBE_MODEL || 'whisper-1',
    }
  }
  return null
}

export function transcriptionAvailable() {
  return provider() !== null
}

/**
 * `offset` shifts timestamps when the audio is one part of a longer video.
 * Audio is fetched server-side (from Cloudinary), so it never passes through the
 * 4.5 MB Vercel request body limit.
 */
export async function transcribeAudioUrl(audioUrl: string, offset = 0): Promise<Transcript> {
  const service = provider()
  if (!service) throw new Error('No transcription key is set (GROQ_API_KEY or OPENAI_API_KEY).')

  const audio = await fetch(audioUrl, { cache: 'no-store' })
  if (!audio.ok) throw new Error(`Could not fetch the audio for transcription (HTTP ${audio.status}).`)
  const blob = await audio.blob()
  if (blob.size > WHISPER_MAX_BYTES) throw new Error('The audio track is too long to transcribe in one pass (over 25 MB).')

  const form = new FormData()
  form.append('file', blob, 'audio.mp3')
  form.append('model', service.model)
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  form.append('timestamp_granularities[]', 'segment')

  const response = await fetch(service.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${service.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(240_000),
  })
  const body = await response.json().catch(() => null) as {
    error?: { message?: string }
    words?: Array<{ word: string; start: number; end: number }>
    segments?: Array<{ start: number; end: number; text: string }>
  } | null
  if (!response.ok || !body) throw new Error(`${service.name} transcription failed: ${body?.error?.message || `HTTP ${response.status}`}`)

  return {
    words: (body.words ?? []).map((word) => ({ start: word.start + offset, end: word.end + offset, text: word.word.trim() })).filter((word) => word.text),
    segments: (body.segments ?? []).map((segment) => ({ start: segment.start + offset, text: segment.text.trim() })).filter((segment) => segment.text),
  }
}
