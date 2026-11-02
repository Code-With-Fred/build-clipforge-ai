'use client'

// Splits a large video into consecutive parts in the browser, without re-encoding
// (stream copy), so each part fits under the Cloudinary plan's per-file size limit.
// Uses the ffmpeg.wasm build already shipped in /public/ffmpeg.

type FFmpegInstance = {
  loaded: boolean
  load(options: { coreURL: string; wasmURL: string }): Promise<boolean>
  on(event: 'log' | 'progress', callback: (payload: { message?: string; progress?: number }) => void): void
  off(event: 'log' | 'progress', callback: (payload: { message?: string; progress?: number }) => void): void
  exec(args: string[]): Promise<number>
  readFile(path: string): Promise<Uint8Array | string>
  deleteFile(path: string): Promise<boolean>
  listDir(path: string): Promise<Array<{ name: string; isDir: boolean }>>
  createDir(path: string): Promise<boolean>
  mount(type: string, options: { files: File[] }, mountPoint: string): Promise<boolean>
  unmount(mountPoint: string): Promise<boolean>
}

declare global {
  interface Window {
    FFmpegWASM?: { FFmpeg: new () => FFmpegInstance }
  }
}

let ffmpegPromise: Promise<FFmpegInstance> | null = null

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[data-ffmpeg-src="${src}"]`)) return resolve()
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.dataset.ffmpegSrc = src
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load the video splitter. Check your connection and try again.'))
    document.head.appendChild(script)
  })
}

function getFFmpeg() {
  ffmpegPromise ??= (async () => {
    if (!window.FFmpegWASM) await loadScript('/ffmpeg/ffmpeg.js')
    if (!window.FFmpegWASM) throw new Error('Video splitter is unavailable in this browser.')
    const ffmpeg = new window.FFmpegWASM.FFmpeg()
    await ffmpeg.load({ coreURL: '/ffmpeg/ffmpeg-core.js', wasmURL: '/ffmpeg/ffmpeg-core.wasm' })
    return ffmpeg
  })().catch((error) => { ffmpegPromise = null; throw error })
  return ffmpegPromise
}

const MOUNT = '/input'
const COPY_CONTAINERS = new Set(['mp4', 'mov', 'mkv', 'webm'])

/**
 * Yields the parts one at a time so only one part is held in JS memory while it uploads.
 * `targetBytes` is the desired size of each part; `minPartSeconds` keeps parts long enough
 * to hold several clips.
 */
export async function* splitVideo(
  file: File,
  options: { targetBytes: number; minPartSeconds: number; onProgress?: (fraction: number) => void },
): AsyncGenerator<{ file: File; index: number; total: number }> {
  const ffmpeg = await getFFmpeg()
  const logs: string[] = []
  const onLog = ({ message }: { message?: string }) => { if (message) logs.push(message) }
  const onProgress = ({ progress }: { progress?: number }) => {
    if (typeof progress === 'number' && progress >= 0 && progress <= 1) options.onProgress?.(progress)
  }
  ffmpeg.on('log', onLog)
  ffmpeg.on('progress', onProgress)

  // WORKERFS reads the file lazily from disk instead of copying gigabytes into memory.
  try { await ffmpeg.createDir(MOUNT) } catch { /* already exists */ }
  await ffmpeg.mount('WORKERFS', { files: [file] }, MOUNT)
  const input = `${MOUNT}/${file.name}`

  try {
    await ffmpeg.exec(['-hide_banner', '-i', input]) // probe only; exits non-zero by design
    const match = logs.join('\n').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
    if (!match) throw new Error('Could not read the video length. Try exporting it as MP4 and uploading again.')
    const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])

    const partSeconds = Math.max(options.minPartSeconds, Math.floor((duration * options.targetBytes) / file.size))
    const sourceExt = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
    const ext = sourceExt === 'm4v' ? 'mp4' : COPY_CONTAINERS.has(sourceExt) ? sourceExt : 'mkv'

    logs.length = 0
    const code = await ffmpeg.exec([
      '-hide_banner', '-i', input,
      '-map', '0:v:0', '-map', '0:a:0?', // first video + first audio; drop subtitles/data that break remuxing
      '-c', 'copy',
      '-f', 'segment', '-segment_time', String(partSeconds), '-reset_timestamps', '1',
      `/part_%03d.${ext}`,
    ])
    if (code !== 0) throw new Error(`Could not split the video (${logs.slice(-3).join(' ').slice(0, 200) || `code ${code}`}).`)

    const names = (await ffmpeg.listDir('/'))
      .filter((entry) => !entry.isDir && entry.name.startsWith('part_'))
      .map((entry) => entry.name)
      .sort()
    const base = file.name.replace(/\.[^.]+$/, '')
    const type = ext === 'webm' ? 'video/webm' : ext === 'mkv' ? 'video/x-matroska' : ext === 'mov' ? 'video/quicktime' : 'video/mp4'

    for (const [index, name] of names.entries()) {
      const data = await ffmpeg.readFile(`/${name}`)
      await ffmpeg.deleteFile(`/${name}`)
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
      yield { file: new File([bytes as BlobPart], `${base}-part${index + 1}.${ext}`, { type }), index, total: names.length }
    }
  } finally {
    ffmpeg.off('log', onLog)
    ffmpeg.off('progress', onProgress)
    try { await ffmpeg.unmount(MOUNT) } catch { /* ignore */ }
    for (const entry of await ffmpeg.listDir('/').catch(() => [])) {
      if (entry.name.startsWith('part_')) await ffmpeg.deleteFile(`/${entry.name}`).catch(() => undefined)
    }
  }
}

/**
 * Extract a compact speech-quality audio track (mono, 16 kHz, 32 kbps MP3: ~14 MB per hour)
 * for transcription. Reads the file lazily, so it works for multi-GB videos.
 */
export async function extractAudio(file: File, onProgress?: (fraction: number) => void): Promise<File | null> {
  const ffmpeg = await getFFmpeg()
  const logs: string[] = []
  const onLog = ({ message }: { message?: string }) => { if (message) logs.push(message) }
  const progress = ({ progress: value }: { progress?: number }) => {
    if (typeof value === 'number' && value >= 0 && value <= 1) onProgress?.(value)
  }
  ffmpeg.on('log', onLog)
  ffmpeg.on('progress', progress)
  try { await ffmpeg.createDir(MOUNT) } catch { /* already exists */ }
  await ffmpeg.mount('WORKERFS', { files: [file] }, MOUNT)
  const output = '/audio.mp3'
  try {
    const code = await ffmpeg.exec([
      '-hide_banner', '-i', `${MOUNT}/${file.name}`,
      '-vn', '-map', '0:a:0?', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k',
      output,
    ])
    if (code !== 0) return null
    const data = await ffmpeg.readFile(output)
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    if (!bytes.length) return null // video without an audio track
    return new File([bytes as BlobPart], `${file.name.replace(/\.[^.]+$/, '')}-audio.mp3`, { type: 'audio/mpeg' })
  } finally {
    ffmpeg.off('log', onLog)
    ffmpeg.off('progress', progress)
    await ffmpeg.deleteFile(output).catch(() => undefined)
    try { await ffmpeg.unmount(MOUNT) } catch { /* ignore */ }
  }
}

/**
 * Gameplay for split-screen: drop the audio track (so it never competes with speech) and
 * remux without re-encoding. Also makes the file smaller. Returns the original file if
 * remuxing fails for an unusual container.
 */
export async function stripAudio(file: File): Promise<File> {
  const ffmpeg = await getFFmpeg()
  try { await ffmpeg.createDir(MOUNT) } catch { /* already exists */ }
  await ffmpeg.mount('WORKERFS', { files: [file] }, MOUNT)
  const output = '/gameplay.mp4'
  try {
    const code = await ffmpeg.exec(['-hide_banner', '-i', `${MOUNT}/${file.name}`, '-map', '0:v:0', '-an', '-c', 'copy', '-movflags', '+faststart', output])
    if (code !== 0) return file
    const data = await ffmpeg.readFile(output)
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    return bytes.length ? new File([bytes as BlobPart], `${file.name.replace(/\.[^.]+$/, '')}-silent.mp4`, { type: 'video/mp4' }) : file
  } finally {
    await ffmpeg.deleteFile(output).catch(() => undefined)
    try { await ffmpeg.unmount(MOUNT) } catch { /* ignore */ }
  }
}

/** Parses Cloudinary's "File size too large. Got X. Maximum is Y." into Y (bytes). */
export function parseSizeLimit(message: string) {
  const match = message.match(/Maximum is (\d+)/i)
  return match ? Number(match[1]) : null
}

const LIMIT_KEY = 'clipforge:maxUploadBytes'

export function rememberedSizeLimit() {
  try { return Number(localStorage.getItem(LIMIT_KEY)) || null } catch { return null }
}

export function rememberSizeLimit(bytes: number) {
  try { localStorage.setItem(LIMIT_KEY, String(bytes)) } catch { /* private mode */ }
}
