'use client'

import { useEffect, useState } from 'react'
import { Download, Scissors, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function VideoCutter() {
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState('')
  const [duration, setDuration] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [outputUrl, setOutputUrl] = useState('')
  const [error, setError] = useState('')
  const [grayscale, setGrayscale] = useState(false)
  const [aiProcessing, setAiProcessing] = useState(false)
  const [generatedClips, setGeneratedClips] = useState<Array<{ index: number; title: string; reason: string; url: string; downloadUrl: string }>>([])

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
    if (fileUrl) URL.revokeObjectURL(fileUrl)
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
    setProcessing(true); setProgress(10); setError(''); setOutputUrl('')
    try {
      const upload = new FormData()
      upload.append('file', file)
      setProgress(25)
      const uploadResponse = await fetch('/api/cloudinary/upload', { method: 'POST', body: upload })
      const uploaded = await uploadResponse.json()
      if (!uploadResponse.ok) throw new Error(uploaded.error || 'Upload failed')

      setProgress(65)
      const clipRequest = new FormData()
      const publicId = uploaded.public_id || uploaded.publicId
      if (!publicId) throw new Error('Cloudinary did not return a video ID')
      clipRequest.append('publicId', publicId)
      clipRequest.append('start', String(start))
      clipRequest.append('duration', String(end - start))
      const clipResponse = await fetch('/api/cloudinary/clip', { method: 'POST', body: clipRequest })
      const clip = await clipResponse.json()
      if (!clipResponse.ok) throw new Error(clip.error || 'Clip generation failed')
      setProgress(100)
      setOutputUrl(clip.downloadUrl || clip.url)
    } catch (caught) {
      setError(caught instanceof Error && caught.message !== 'Failed to fetch' ? caught.message : 'Cloudinary upload could not be reached. Check the Cloudinary cloud name and unsigned upload preset.')
    } finally { setProcessing(false) }
  }

  const createShorts = async () => {
    if (!file) return
    setAiProcessing(true); setError(''); setGeneratedClips([]); setProgress(5)
    let projectId = ''
    try {
      const upload = new FormData()
      upload.append('file', file)
      setProgress(20)
      const uploadResponse = await fetch('/api/cloudinary/upload', { method: 'POST', body: upload })
      const uploaded = await uploadResponse.json()
      if (!uploadResponse.ok) throw new Error(uploaded.error || 'Upload failed')
      const publicId = uploaded.publicId || uploaded.public_id
      projectId = uploaded.projectId || ''
      if (projectId) await fetch(`/api/projects/${projectId}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'processing' }) })
      const videoDuration = Number(uploaded.duration || duration)
      setProgress(45)
      const clipCount = Math.floor(videoDuration / 60)
      if (clipCount < 1) throw new Error('The video must be at least one minute long.')
      const clips = Array.from({ length: clipCount }, (_, index) => ({
        start: index * 60,
        title: `Minute ${index + 1}`,
        reason: 'Consecutive one-minute segment from the uploaded video.',
      }))
      setProgress(70)
      const clipsResponse = await fetch('/api/cloudinary/shorts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publicId, clips, clipDuration: 60, grayscale }) })
      const result = await clipsResponse.json()
      if (!clipsResponse.ok) throw new Error(result.error || 'Cloudinary could not create the shorts')
      setGeneratedClips(result.clips)
      if (projectId) await fetch(`/api/projects/${projectId}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ready' }) })
      setProgress(100)
    } catch (caught) {
      if (projectId) await fetch(`/api/projects/${projectId}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'failed' }) })
      setError(caught instanceof Error && caught.message !== 'Failed to fetch' ? caught.message : 'The AI short workflow could not be reached. Check Cloudinary and AI Gateway settings.')
    } finally { setAiProcessing(false) }
  }

  return <main className="min-h-screen bg-[#090a0d] px-5 py-10 text-[#f4f4f5] sm:px-8">
    <div className="mx-auto max-w-3xl">
      <a href="/" className="text-xs text-[#858894] transition-colors hover:text-white">← Back to dashboard</a>
      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">ClipForge AI</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Cut a video into a clip</h1>
      <p className="mt-2 text-sm text-[#858894]">Upload any supported video and generate a hosted vertical clip without browser codec limitations.</p>
      <p className="mt-2 text-xs text-[#777a86]">Videos are uploaded directly to Cloudinary for reliable MOV, MP4, WEBM, and HEVC processing.</p>
      <label htmlFor="cutter-file" className="mt-8 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-violet-300/30 bg-violet-400/[0.05] px-6 py-14 text-center hover:bg-violet-400/[0.09]">
        <Upload className="text-violet-300" />
        <span className="mt-3 text-sm font-medium">Choose a video</span>
        <span className="mt-1 text-xs text-[#777a86]">MOV, MP4, WEBM, HEVC, and more</span>
        <input id="cutter-file" type="file" accept="video/*,.mov,.m4v,.mp4,.webm,.avi,.mkv,.3gp" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} onInput={(event) => chooseFile(event.currentTarget.files?.[0])} />
      </label>
      {file && <section className="mt-6 rounded-2xl border border-white/[0.08] bg-[#111216] p-5">
        <video className="aspect-video w-full rounded-xl bg-black object-contain" src={fileUrl} controls onLoadedMetadata={(event) => { const next = event.currentTarget.duration; setDuration(next); setEnd(next) }} onError={() => setError('Preview unavailable for this codec, but Cloudinary can still process the original file.')} />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-[#a8aab4]">Start time (minutes)<input type="number" min="0" max={Math.max(0, (end - 0.1) / 60)} step="0.1" value={Number((start / 60).toFixed(2))} onChange={(event) => setStart(Number(event.target.value) * 60)} className="mt-2 w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none" /></label>
          <label className="text-xs text-[#a8aab4]">End time (minutes)<input type="number" min={Math.min(duration, start + 0.1) / 60} max={duration / 60} step="0.1" value={Number((end / 60).toFixed(2))} onChange={(event) => setEnd(Number(event.target.value) * 60)} className="mt-2 w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none" /></label>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3"><Button onClick={cutVideo} disabled={processing || aiProcessing || end <= start} className="gap-2 rounded-xl bg-violet-500 hover:bg-violet-400"><Scissors data-icon="inline-start" />{processing ? `Cutting ${progress}%` : 'Cut video'}</Button>{outputUrl && <a href={outputUrl} download="clipforge-clip.mp4"><Button variant="outline" className="gap-2 rounded-xl border-white/[0.1] bg-transparent"><Download data-icon="inline-start" /> Download clip</Button></a>}</div>
        <div className="mt-8 rounded-2xl border border-violet-300/20 bg-violet-400/[0.05] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-200">AI short batch</p>
          <h2 className="mt-2 text-lg font-semibold">Split the full video into one-minute shorts</h2>
          <p className="mt-1 text-sm text-[#9b9da7]">A one-hour video creates 60 consecutive one-minute clips at once. Any leftover seconds are skipped so every download is exactly one minute.</p>
          <label className="mt-4 flex items-center gap-2 text-sm text-[#c7c8d0]"><input type="checkbox" checked={grayscale} onChange={(event) => setGrayscale(event.target.checked)} /> Apply black-and-white color grading</label>
          <Button onClick={createShorts} disabled={aiProcessing || processing || !file} className="mt-4 rounded-xl bg-white text-black hover:bg-white/90">{aiProcessing ? `Creating shorts ${progress}%` : 'Create all 1-minute shorts'}</Button>
          {generatedClips.length > 0 && <div className="mt-5 grid gap-2 sm:grid-cols-2"><p className="sm:col-span-2 text-sm font-medium text-white">Your shorts are ready. Download them, then edit audio in CapCut.</p>{generatedClips.map((clip) => <a key={clip.index} href={clip.downloadUrl || clip.url} download={`clipforge-short-${clip.index}.mp4`} className="rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-3 text-sm hover:bg-white/[0.08]"><span className="font-medium text-violet-200">Short {clip.index}: {clip.title}</span><span className="mt-1 block text-xs text-[#90929d]">Download MP4</span></a>)}</div>}
        </div>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </section>}
    </div>
  </main>
}
