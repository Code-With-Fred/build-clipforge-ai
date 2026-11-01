// Pure planning helpers shared by the API and the UI. No server-only imports here.

export type CropMode = 'center' | 'smart' | 'blur'

export type ClipPlan = {
  start: number
  duration: number
  title: string
  reason: string
}

export type TranscriptSegment = { start: number; text: string }

export const SHORTS_LIMITS = {
  minCount: 1,
  maxCount: 20,
  minClipSeconds: 15,
  maxClipSeconds: 180, // YouTube Shorts accept up to 3 minutes.
} as const

export function formatTimestamp(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

/** How many non-overlapping clips of `clipDuration` fit in the video, capped at `requested`. */
export function feasibleCount(videoDuration: number, clipDuration: number, requested: number) {
  return Math.max(0, Math.min(requested, Math.floor(videoDuration / clipDuration)))
}

/**
 * Evenly spread clips: split the video into `count` equal sections and take a clip
 * from the middle of each one. Used when no transcript is available.
 */
export function planEvenly(videoDuration: number, count: number, clipDuration: number): ClipPlan[] {
  const total = feasibleCount(videoDuration, clipDuration, count)
  if (total < 1) return []
  const section = videoDuration / total
  const maxStart = Math.max(0, Math.floor(videoDuration - clipDuration))
  return Array.from({ length: total }, (_, index) => {
    const centered = index * section + (section - clipDuration) / 2
    const start = Math.min(maxStart, Math.max(0, Math.floor(centered)))
    return {
      start,
      duration: clipDuration,
      title: `Part ${index + 1} (${formatTimestamp(start)})`,
      reason: 'Evenly spaced across the video (no transcript provided).',
    }
  })
}

/**
 * Validate AI (or any) picks: clamp into bounds, round, sort, drop overlaps,
 * then top up from an even spread so the user always gets `count` clips when they fit.
 */
export function finalizePlan(
  picks: Array<{ start: number; title?: string; reason?: string }>,
  videoDuration: number,
  count: number,
  clipDuration: number,
): ClipPlan[] {
  const total = feasibleCount(videoDuration, clipDuration, count)
  if (total < 1) return []
  const maxStart = Math.max(0, Math.floor(videoDuration - clipDuration))
  const overlaps = (a: number, list: ClipPlan[]) => list.some((clip) => Math.abs(clip.start - a) < clipDuration)

  const chosen: ClipPlan[] = []
  const cleaned = picks
    .filter((pick) => Number.isFinite(pick.start))
    .map((pick) => ({ ...pick, start: Math.min(maxStart, Math.max(0, Math.round(pick.start))) }))
    .sort((a, b) => a.start - b.start)

  for (const pick of cleaned) {
    if (chosen.length >= total) break
    if (overlaps(pick.start, chosen)) continue
    chosen.push({
      start: pick.start,
      duration: clipDuration,
      title: (pick.title?.trim() || `Clip at ${formatTimestamp(pick.start)}`).slice(0, 100),
      reason: (pick.reason?.trim() || '').slice(0, 300),
    })
  }

  if (chosen.length < total) {
    // Try many candidate positions so the top-up still succeeds when picks cluster.
    for (const filler of planEvenly(videoDuration, feasibleCount(videoDuration, clipDuration, SHORTS_LIMITS.maxCount * 3), clipDuration)) {
      if (chosen.length >= total) break
      if (!overlaps(filler.start, chosen)) chosen.push({ ...filler, title: `Clip at ${formatTimestamp(filler.start)}` })
    }
  }

  return chosen.sort((a, b) => a.start - b.start)
}

const ARROW_LINE = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->/
const LEADING_TIMESTAMP = /^\s*[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,]\d{1,3})?[\])]?\s*[-–—:]?\s*(.*)$/

function toSeconds(stamp: string) {
  const parts = stamp.replace(',', '.').split(':').map(Number)
  return parts.reduce((total, part) => total * 60 + part, 0)
}

/**
 * Parse SRT, WebVTT, or YouTube "Show transcript" text (timestamps on their own line
 * or at the start of a line) into timed segments.
 */
export function parseTranscript(raw: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  let current: { start: number; lines: string[] } | null = null
  const flush = () => {
    if (current && current.lines.length) segments.push({ start: current.start, text: current.lines.join(' ').replace(/\s+/g, ' ').trim() })
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === 'WEBVTT' || /^\d+$/.test(trimmed) || /^(NOTE|STYLE|Kind:|Language:)/.test(trimmed)) continue

    const arrow = ARROW_LINE.exec(trimmed)
    if (arrow) { flush(); current = { start: toSeconds(arrow[1]), lines: [] }; continue }

    const leading = LEADING_TIMESTAMP.exec(trimmed)
    if (leading) {
      flush()
      current = { start: toSeconds(leading[1]), lines: leading[2] ? [leading[2]] : [] }
      continue
    }

    if (current) current.lines.push(trimmed.replace(/<[^>]+>/g, ''))
  }
  flush()

  // SRT/VTT often repeats lines in rolling captions; collapse identical consecutive text.
  return segments.filter((segment, index) => segment.text && segment.text !== segments[index - 1]?.text)
}

/** Compact transcript for the model: merge segments into ~15s buckets tagged with seconds. */
export function transcriptForPrompt(segments: TranscriptSegment[], maxChars = 180_000) {
  const buckets: TranscriptSegment[] = []
  for (const segment of segments) {
    const last = buckets[buckets.length - 1]
    if (last && segment.start - last.start < 15) last.text += ` ${segment.text}`
    else buckets.push({ ...segment })
  }
  let output = ''
  for (const bucket of buckets) {
    const line = `[${Math.floor(bucket.start)}s] ${bucket.text}\n`
    if (output.length + line.length > maxChars) break
    output += line
  }
  return output
}
