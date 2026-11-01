// Pure caption helpers: turn a transcript into short, punchy on-screen caption cues
// for one clip, serialise them as SRT, and escape text for Cloudinary overlays.

import type { TranscriptSegment } from '@/lib/shorts'

export type TimedWord = { start: number; end: number; text: string }
export type CaptionCue = { start: number; end: number; text: string }

const MAX_WORDS_PER_CUE = 3
const MAX_CUE_SECONDS = 1.6
const MIN_CUE_SECONDS = 0.35

/** Spread a segment's words evenly across its time span when word timings are unknown. */
function wordsFromSegments(segments: TranscriptSegment[], videoEnd: number): TimedWord[] {
  const words: TimedWord[] = []
  segments.forEach((segment, index) => {
    const end = segments[index + 1]?.start ?? Math.min(segment.start + 6, videoEnd)
    const tokens = segment.text.split(/\s+/).filter(Boolean)
    if (!tokens.length || end <= segment.start) return
    const step = (end - segment.start) / tokens.length
    tokens.forEach((text, i) => words.push({ start: segment.start + i * step, end: segment.start + (i + 1) * step, text }))
  })
  return words
}

/**
 * Caption cues for the clip [clipStart, clipStart + clipDuration], with times relative
 * to the clip (0 = first frame of the short). Prefers real word timings (Whisper).
 */
export function buildClipCues(
  source: { words?: TimedWord[]; segments?: TranscriptSegment[] },
  clipStart: number,
  clipDuration: number,
): CaptionCue[] {
  const clipEnd = clipStart + clipDuration
  const allWords = source.words?.length ? source.words : wordsFromSegments(source.segments ?? [], clipEnd + 10)
  const words = allWords
    .filter((word) => word.end > clipStart && word.start < clipEnd && word.text.trim())
    .map((word) => ({
      start: Math.max(0, word.start - clipStart),
      end: Math.min(clipDuration, word.end - clipStart),
      text: word.text.trim(),
    }))

  const cues: CaptionCue[] = []
  let current: TimedWord[] = []
  const flush = () => {
    if (!current.length) return
    const start = current[0].start
    const end = Math.max(current[current.length - 1].end, start + MIN_CUE_SECONDS)
    cues.push({ start, end, text: current.map((word) => word.text).join(' ') })
    current = []
  }
  for (const word of words) {
    const tooLong = current.length && word.end - current[0].start > MAX_CUE_SECONDS
    const gap = current.length && word.start - current[current.length - 1].end > 0.6
    if (current.length >= MAX_WORDS_PER_CUE || tooLong || gap) flush()
    current.push(word)
    if (/[.!?]$/.test(word.text)) flush()
  }
  flush()

  // Never overlap: a cue ends when the next begins.
  for (let i = 0; i < cues.length - 1; i += 1) cues[i].end = Math.min(cues[i].end, cues[i + 1].start)
  return cues.filter((cue) => cue.end - cue.start >= 0.05).map((cue) => ({ ...cue, end: Math.min(cue.end, clipDuration) }))
}

function srtTime(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`
}

export function toSrt(cues: CaptionCue[]) {
  return cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text.toUpperCase()}\n`).join('\n')
}

/** First words spoken in the clip; fallback hook when the AI did not write one. */
export function fallbackHook(cues: CaptionCue[], maxWords = 7) {
  const words = cues.map((cue) => cue.text).join(' ').split(/\s+/).filter(Boolean).slice(0, maxWords)
  return words.length >= 3 ? `${words.join(' ').replace(/[.,;:!?]+$/, '')}…` : ''
}

/**
 * Escape text for a Cloudinary l_text overlay: URL-encode, and double-encode the
 * characters Cloudinary treats as URL syntax (comma and slash).
 */
export function cloudinaryText(text: string) {
  const clean = text.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)
  return encodeURIComponent(clean).replace(/%2C/gi, '%252C').replace(/%2F/gi, '%252F')
}
