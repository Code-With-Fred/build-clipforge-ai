// Server-only: transcribe a clip's audio with OpenAI Whisper (word-level timestamps).
// Optional: only used when OPENAI_API_KEY is set and the user did not paste a transcript.

import type { TimedWord } from '@/lib/captions'
import type { TranscriptSegment } from '@/lib/shorts'

export type Transcript = { words: TimedWord[]; segments: TranscriptSegment[] }

const WHISPER_MAX_BYTES = 25 * 1024 * 1024

export function transcriptionAvailable() {
  return Boolean(process.env.OPENAI_API_KEY)
}

/**
 * `offset` shifts timestamps when the audio is one part of a longer video.
 * Audio is fetched server-side (from Cloudinary), so it never passes through the
 * 4.5 MB Vercel request body limit.
 */
export async function transcribeAudioUrl(audioUrl: string, offset = 0): Promise<Transcript> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.')

  const audio = await fetch(audioUrl, { cache: 'no-store' })
  if (!audio.ok) throw new Error(`Could not fetch the audio for transcription (HTTP ${audio.status}).`)
  const blob = await audio.blob()
  if (blob.size > WHISPER_MAX_BYTES) throw new Error('The audio track is too long to transcribe in one pass (over 25 MB).')

  const form = new FormData()
  form.append('file', blob, 'audio.mp3')
  form.append('model', process.env.CLIPFORGE_TRANSCRIBE_MODEL || 'whisper-1')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  form.append('timestamp_granularities[]', 'segment')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(240_000),
  })
  const body = await response.json().catch(() => null) as {
    error?: { message?: string }
    words?: Array<{ word: string; start: number; end: number }>
    segments?: Array<{ start: number; end: number; text: string }>
  } | null
  if (!response.ok || !body) throw new Error(`Transcription failed: ${body?.error?.message || `HTTP ${response.status}`}`)

  return {
    words: (body.words ?? []).map((word) => ({ start: word.start + offset, end: word.end + offset, text: word.word.trim() })).filter((word) => word.text),
    segments: (body.segments ?? []).map((segment) => ({ start: segment.start + offset, text: segment.text.trim() })).filter((segment) => segment.text),
  }
}
