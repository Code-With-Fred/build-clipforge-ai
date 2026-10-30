'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, Scissors, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'

const CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'

export function VideoCutter() {
  const ffmpegRef = useRef<any>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState('')
  const [duration, setDuration] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [outputUrl, setOutputUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    return () => {
      if (outputUrl) URL.revokeObjectURL(outputUrl)
      if (fileUrl) URL.revokeObjectURL(fileUrl)
    }
  }, [fileUrl, outputUrl])

  const chooseFile = (nextFile: File | undefined) => {
    if (!nextFile) return
    const looksLikeVideo = nextFile.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv|mpeg|mpg|3gp)$/i.test(nextFile.name)
    if (!looksLikeVideo) { setError('Choose a supported video file.'); return }
    setError('')
    setOutputUrl('')
    setFile(nextFile)
    setFileUrl(URL.createObjectURL(nextFile))
    // FFmpeg probes the source during processing, so browser preview support is not required.
    // A generous default lets HEVC/MOV files proceed even when the HTML video element cannot decode them.
    setDuration(3600)
    setStart(0)
    setEnd(60)
  }

  const cutVideo = async () => {
    if (!file || end <= start) return
    setProcessing(true); setProgress(0); setError('')
    try {
      const ffmpegModuleUrl = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js'
      const utilModuleUrl = 'https://unpkg.com/@ffmpeg/util@0.12.2/dist/esm/index.js'
      const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
        import(/* webpackIgnore: true */ ffmpegModuleUrl),
        import(/* webpackIgnore: true */ utilModuleUrl),
      ])
      const ffmpeg = ffmpegRef.current ?? new FFmpeg()
      ffmpegRef.current = ffmpeg
      if (!ffmpeg.loaded) {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
        })
      }
      ffmpeg.on('progress', ({ progress: value }: { progress: number }) => setProgress(Math.round(value * 100)))
      const inputName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'input.video'
      await ffmpeg.writeFile(inputName, await fetchFile(file))
      await ffmpeg.exec(['-ss', String(start), '-i', inputName, '-t', String(end - start), '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', 'clip.mp4'])
      const data = await ffmpeg.readFile('clip.mp4')
      const blob = new Blob([data as Uint8Array], { type: 'video/mp4' })
      setOutputUrl(URL.createObjectURL(blob))
    } catch { setError('The video could not be cut in this browser. Try an MP4 or WEBM file.') }
    finally { setProcessing(false) }
  }

  return <main className="min-h-screen bg-[#090a0d] px-5 py-10 text-[#f4f4f5] sm:px-8">
    <div className="mx-auto max-w-3xl">
      <a href="/" className="text-xs text-[#858894] transition-colors hover:text-white">← Back to dashboard</a>
      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">ClipForge AI</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Cut a video into a clip</h1>
      <p className="mt-2 text-sm text-[#858894]">Everything runs in your browser. Your original video is not uploaded.</p>
      <p className="mt-2 text-xs text-[#777a86]">Browser preview is optional. The cutter processes the original file with FFmpeg, including MOV and HEVC sources when the browser can load the FFmpeg runtime.</p>
      <label htmlFor="cutter-file" className="mt-8 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-violet-300/30 bg-violet-400/[0.05] px-6 py-14 text-center hover:bg-violet-400/[0.09]">
        <Upload className="text-violet-300" />
        <span className="mt-3 text-sm font-medium">Choose a video</span>
        <span className="mt-1 text-xs text-[#777a86]">MP4, MOV, WEBM, or other browser-supported video</span>
        <input id="cutter-file" type="file" accept="video/*" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} />
      </label>
      {file && <section className="mt-6 rounded-2xl border border-white/[0.08] bg-[#111216] p-5">
        <video className="aspect-video w-full rounded-xl bg-black object-contain" src={fileUrl} controls onLoadedMetadata={(event) => { const next = event.currentTarget.duration; setDuration(next); setEnd(next) }} onError={() => setError('Preview unavailable for this codec. You can still cut the original file with FFmpeg below.')} />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-[#a8aab4]">Start seconds<input type="number" min="0" max={Math.max(0, end - 0.1)} step="0.1" value={start} onChange={(event) => setStart(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none" /></label>
          <label className="text-xs text-[#a8aab4]">End seconds<input type="number" min={Math.min(duration, start + 0.1)} max={duration} step="0.1" value={end} onChange={(event) => setEnd(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none" /></label>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3"><Button onClick={cutVideo} disabled={processing || end <= start} className="gap-2 rounded-xl bg-violet-500 hover:bg-violet-400"><Scissors data-icon="inline-start" />{processing ? `Cutting ${progress}%` : 'Cut video'}</Button>{outputUrl && <a href={outputUrl} download="clipforge-clip.mp4"><Button variant="outline" className="gap-2 rounded-xl border-white/[0.1] bg-transparent"><Download data-icon="inline-start" /> Download clip</Button></a>}</div>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </section>}
    </div>
  </main>
}
