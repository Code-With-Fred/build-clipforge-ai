// Pure helper: give each split-screen short its own stretch of background gameplay.

export type GameplayClip = { publicId: string; duration: number }
export type GameplayAssignment = { publicId: string; start: number }

/**
 * Rotate through the library (so consecutive shorts look different) and pick a random
 * start that leaves room for the whole short. Clips shorter than the short are skipped.
 * Returns null when no clip is long enough.
 */
export function assignGameplay(shortCount: number, clipDuration: number, library: GameplayClip[], random: () => number = Math.random): GameplayAssignment[] | null {
  const usable = library.filter((item) => item.duration >= clipDuration + 1)
  if (!usable.length) return null
  const offset = Math.floor(random() * usable.length)
  return Array.from({ length: shortCount }, (_, index) => {
    const item = usable[(offset + index) % usable.length]
    const room = Math.max(0, Math.floor(item.duration - clipDuration - 1))
    return { publicId: item.publicId, start: Math.floor(random() * (room + 1)) }
  })
}
