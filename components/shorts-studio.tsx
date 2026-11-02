'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Captions, Check, Copy, Download, FileText, Gamepad2, HardDrive, Loader2, ShieldAlert, ShieldCheck, ShieldQuestion, Trash2, Upload, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatTimestamp, type CropMode } from '@/lib/shorts'
import { extractAudio, parseSizeLimit, rememberedSizeLimit, rememberSizeLimit, splitVideo, stripAudio } from '@/lib/split-video'
import { CAPTION_STYLES, CAPTION_STYLE_IDS, type CaptionPosition, type CaptionStyle } from '@/lib/captions'

type ClipView = {
  id: string
  position: number
  start: number
  duration: number
  title: string
  reason: string
  url: string
  status: string
  detail?: string
  hook?: string
  description?: string
  hashtags?: string
  captions?: string
  youtubeCheck?: 'pending' | 'passed' | 'claimed'
}

type RightsSource = '' | 'own' | 'permission' | 'unsure'

/** Badge for how the right to clip this video was established. */
function RightsBadge({ source, proof }: { source?: string | null; proof?: string | null }) {
  if (source === 'own') return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] text-emerald-200"><ShieldCheck className="size-3.5" />Your own video</span>
  if (source === 'permission') {
    const isLink = Boolean(proof && /^https?:\/\//i.test(proof))
    return <span className="inline-flex items-center gap-1 rounded-full bg-sky-400/15 px-2 py-0.5 text-[11px] text-sky-200"><ShieldCheck className="size-3.5" />Permission / campaign{proof && <> · {isLink ? <a href={proof} target="_blank" rel="noreferrer" className="underline">proof</a> : proof}</>}</span>
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-[#c7c8d0]"><ShieldQuestion className="size-3.5" />Rights not recorded</span>
}

type ProjectView = { id: string; name: string; status: string; duration: number; rightsSource?: string | null; rightsProof?: string | null }

type Stage = 'idle' | 'splitting' | 'uploading' | 'audio' | 'planning' | 'rendering' | 'done' | 'failed'

type UploadedSource = { publicId: string; bytes: number; duration?: number }

const CHUNK_SIZE = 20 * 1024 * 1024 // Cloudinary chunked upload: >= 5 MB per chunk except the last.
const POLL_MS = 8000

async function readJson(response: Response) {
  return await response.json().catch(() => ({})) as Record<string, unknown>
}

function cloudinaryMessage(body: Record<string, unknown>, fallback: string) {
  const error = body.error as { message?: string } | string | undefined
  return typeof error === 'string' ? error : error?.message || fallback
}

async function withRetry<T>(task: () => Promise<T>, attempts = 4) {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await task() } catch (error) {
      lastError = error
      if (error instanceof Error && error.name === 'FatalUploadError') break
      await new Promise((resolve) => setTimeout(resolve, 1500 * 2 ** attempt))
    }
  }
  throw lastError
}

function fatal(message: string) {
  const error = new Error(message)
  error.name = 'FatalUploadError'
  return error
}

/** Upload straight from the browser to Cloudinary in 20 MB chunks (bypasses Vercel's 4.5 MB body limit). */
async function uploadToCloudinary(source: File | string, onProgress: (fraction: number) => void, folder?: 'gameplay') {
  const loadSignature = async () => {
    const response = await fetch(`/api/cloudinary/config${folder ? `?folder=${folder}` : ''}`, { cache: 'no-store' })
    const body = await readJson(response)
    if (!response.ok) throw new Error(String(body.error || 'Cloudinary is not configured.'))
    return { ...body, loadedAt: Date.now() } as Record<string, unknown>
  }
  let config = await loadSignature()
  const endpoint = `https://api.cloudinary.com/v1_1/${config.cloudName}/video/upload`

  const send = async (body: FormData, headers?: Record<string, string>) => {
    const response = await fetch(endpoint, { method: 'POST', body, headers })
    const result = await readJson(response)
    if (response.status >= 400 && response.status < 500) throw fatal(cloudinaryMessage(result, 'Cloudinary rejected the upload.'))
    if (!response.ok) throw new Error(cloudinaryMessage(result, `Upload failed (${response.status}).`))
    return result
  }
  const baseForm = async () => {
    // Cloudinary rejects signatures older than ~1 hour; long uploads re-sign as they go.
    if (Date.now() - Number(config.loadedAt) > 40 * 60 * 1000) config = await loadSignature()
    const form = new FormData()
    // Signed by the server (/api/cloudinary/config); no upload preset needed.
    for (const key of ['api_key', 'timestamp', 'signature', 'folder'] as const) form.append(key, String(config[key]))
    return form
  }

  if (typeof source === 'string') {
    const form = await baseForm()
    form.append('file', source)
    onProgress(0.5)
    const result = await withRetry(() => send(form), 2)
    onProgress(1)
    return result
  }

  const uploadId = crypto.randomUUID()
  let result: Record<string, unknown> = {}
  for (let start = 0; start < source.size; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, source.size)
    result = await withRetry(async () => {
      const form = await baseForm()
      form.append('file', source.slice(start, end), source.name)
      return send(form, { 'X-Unique-Upload-Id': uploadId, 'Content-Range': `bytes ${start}-${end - 1}/${source.size}` })
    })
    onProgress(end / source.size)
  }
  return result
}

async function downloadClip(clip: ClipView, projectName: string) {
  const safeName = `${String(clip.position).padStart(2, '0')}-${(clip.title || projectName).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'short'}.mp4`
  try {
    const response = await fetch(clip.url)
    if (!response.ok) throw new Error(String(response.status))
    const href = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = href
    link.download = safeName
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(href), 10_000)
  } catch {
    window.open(clip.url, '_blank', 'noopener')
  }
}

export function ShortsStudio({ initialProjectId }: { initialProjectId?: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [count, setCount] = useState(12)
  const [clipDuration, setClipDuration] = useState(60)
  const [crop, setCrop] = useState<CropMode>('center')
  const [grayscale, setGrayscale] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [captionsOn, setCaptionsOn] = useState(true)
  const [hookOn, setHookOn] = useState(true)
  const [sourceCredit, setSourceCredit] = useState('')
  const [layout, setLayout] = useState<'full' | 'split'>('full')
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>('classic')
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>('lower')
  const [gameplayList, setGameplayList] = useState<Array<{ id: string; name: string; duration: number }>>([])
  const [gameplaySelected, setGameplaySelected] = useState<string[]>([])
  const [gameplayBusy, setGameplayBusy] = useState('')
  const [rightsSource, setRightsSource] = useState<RightsSource>('')
  const [rightsProof, setRightsProof] = useState('')
  const rightsReady = rightsSource === 'own' || (rightsSource === 'permission' && rightsProof.trim().length > 0)
  const [stage, setStage] = useState<Stage>(initialProjectId ? 'rendering' : 'idle')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [projectId, setProjectId] = useState(initialProjectId || '')
  const [projectView, setProjectView] = useState<ProjectView | null>(null)
  const [clips, setClips] = useState<ClipView[]>([])
  const [copied, setCopied] = useState('')
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [storage, setStorage] = useState<{ sourcesStored: boolean; sourceBytes: number } | null>(null)
  const [storageBusy, setStorageBusy] = useState<'' | 'free' | 'delete'>('')
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [partLabel, setPartLabel] = useState('')
  const busy = stage === 'splitting' || stage === 'uploading' || stage === 'audio' || stage === 'planning'
  const readyCount = clips.filter((item) => item.status === 'ready').length

  const poll = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/shorts/${id}`, { cache: 'no-store' })
      const body = await readJson(response)
      if (!response.ok) throw new Error(String(body.error || 'Could not load the project.'))
      const nextProject = body.project as ProjectView
      const nextClips = body.clips as ClipView[]
      if (body.storage) setStorage(body.storage as { sourcesStored: boolean; sourceBytes: number })
      setProjectView(nextProject)
      setClips(nextClips)
      if (nextProject.status === 'ready') { setStage('done'); return }
      if (nextProject.status === 'failed') {
        setStage('failed')
        setError('Cloudinary did not finish every clip. Ready clips can still be downloaded; create the project again to retry the rest.')
        return
      }
      setStage('rendering')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Status check failed. Retrying…')
    }
    pollTimer.current = setTimeout(() => poll(id), POLL_MS)
  }, [])

  const loadGameplay = useCallback(async () => {
    const body = await readJson(await fetch('/api/gameplay', { cache: 'no-store' }).catch(() => new Response('{}')))
    if (Array.isArray(body.gameplay)) setGameplayList(body.gameplay as Array<{ id: string; name: string; duration: number }>)
  }, [])
  useEffect(() => { loadGameplay() }, [loadGameplay])

  // Gameplay library: audio is stripped in the browser, then the clip is uploaded and registered.
  const addGameplay = async (picked: File | undefined) => {
    if (!picked) return
    setError('')
    try {
      setGameplayBusy('Removing audio…')
      const silent = await stripAudio(picked)
      setGameplayBusy('Uploading 0%')
      const uploaded = await uploadToCloudinary(silent, (fraction) => setGameplayBusy(`Uploading ${Math.round(fraction * 100)}%`), 'gameplay')
      const response = await fetch('/api/gameplay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicId: uploaded.public_id, name: picked.name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Gameplay', bytes: Number(uploaded.bytes) || silent.size, duration: Number(uploaded.duration) || undefined }),
      })
      const body = await readJson(response)
      if (!response.ok) throw new Error(String(body.error || 'Could not add the gameplay clip.'))
      await loadGameplay()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the gameplay clip.')
    } finally {
      setGameplayBusy('')
    }
  }

  const removeGameplay = async (id: string) => {
    if (!window.confirm('Remove this gameplay clip from the library?')) return
    const response = await fetch(`/api/gameplay/${id}`, { method: 'DELETE' })
    const body = await readJson(response)
    if (!response.ok) { setError(String(body.error || 'Could not remove the gameplay clip.')); return }
    setGameplaySelected((current) => current.filter((item) => item !== id))
    await loadGameplay()
  }

  useEffect(() => {
    if (projectId) poll(projectId)
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current) }
  }, [projectId, poll])

  const loadTranscriptFile = async (picked: File | undefined) => {
    if (picked) setTranscript(await picked.text())
  }

  const start = async () => {
    const url = remoteUrl.trim()
    if (!file && !url) return
    if (!file && /(^|\.)(youtube\.com|youtu\.be)$/.test(new URL(url).hostname)) {
      setError('YouTube watch links are web pages, not video files. Download the video (e.g. from YouTube Studio) and upload the file instead.')
      return
    }
    setError(''); setNote(''); setClips([]); setProjectView(null); setUploadProgress(0)
    try {
      const toSource = (uploaded: Record<string, unknown>, fallbackBytes: number): UploadedSource => {
        const publicId = String(uploaded.public_id || '')
        if (!publicId) throw new Error('Cloudinary did not return a video ID.')
        const duration = Number(uploaded.duration)
        return { publicId, bytes: Number(uploaded.bytes) || fallbackBytes, ...(duration > 0 ? { duration } : {}) }
      }

      // Cloudinary plans cap the size of a single video file (100 MB on Free). Bigger files
      // are split in the browser into consecutive parts (no re-encoding), uploaded one by one.
      const uploadInParts = async (source: File, limitBytes: number) => {
        rememberSizeLimit(limitBytes)
        const parts: UploadedSource[] = []
        let doneBytes = 0
        setStage('splitting'); setUploadProgress(0); setPartLabel('')
        for await (const part of splitVideo(source, {
          targetBytes: Math.floor(limitBytes * 0.75),
          minPartSeconds: Math.max(clipDuration * 3, 300),
          onProgress: setUploadProgress,
        })) {
          if (part.file.size > limitBytes) throw new Error(`Part ${part.index + 1} is still too large for your Cloudinary plan (${Math.round(part.file.size / 1048576)} MB). Export the video at a lower bitrate and try again.`)
          setStage('uploading')
          setPartLabel(`part ${part.index + 1} of ${part.total}`)
          const uploaded = await uploadToCloudinary(part.file, (fraction) => setUploadProgress((doneBytes + fraction * part.file.size) / source.size))
          doneBytes += part.file.size
          parts.push(toSource(uploaded, part.file.size))
        }
        if (!parts.length) throw new Error('The video splitter produced no parts.')
        return parts
      }

      let sources: UploadedSource[]
      const knownLimit = rememberedSizeLimit()
      if (file && knownLimit && file.size > knownLimit) {
        sources = await uploadInParts(file, knownLimit)
      } else {
        setStage('uploading'); setPartLabel('')
        try {
          sources = [toSource(await uploadToCloudinary(file ?? url, setUploadProgress), file?.size ?? 0)]
        } catch (uploadError) {
          const limit = uploadError instanceof Error ? parseSizeLimit(uploadError.message) : null
          if (!file || !limit) {
            if (!file && limit) throw new Error(`This video is larger than your Cloudinary plan allows (${Math.round(limit / 1048576)} MB). Download it and upload the file instead: large files are split automatically.`)
            throw uploadError
          }
          sources = await uploadInParts(file, limit)
        }
      }
      setPartLabel('')

      // Auto-transcription: pull a small audio track in the browser and upload it, so the
      // server can transcribe it for captions, hooks and AI moment picking.
      let audioPublicId: string | undefined
      if (file && !transcript.trim() && (captionsOn || hookOn)) {
        try {
          const settings = await readJson(await fetch('/api/cloudinary/config', { cache: 'no-store' }))
          if (settings.transcription) {
            setStage('audio'); setUploadProgress(0)
            const audio = await extractAudio(file, (fraction) => setUploadProgress(fraction * 0.7))
            if (audio) {
              const uploadedAudio = await uploadToCloudinary(audio, (fraction) => setUploadProgress(0.7 + fraction * 0.3))
              audioPublicId = String(uploadedAudio.public_id || '') || undefined
            }
          } else {
            setNote('Tip: add a free GROQ_API_KEY (console.groq.com) in Vercel for automatic captions, hooks and AI-picked moments, or paste a transcript.')
          }
        } catch (audioError) {
          console.warn('Audio extraction failed; continuing without captions', audioError)
        }
      }

      setStage('planning')
      const name = file ? file.name.replace(/\.[^.]+$/, '') : decodeURIComponent(new URL(url).pathname.split('/').pop() || 'Remote video').replace(/\.[^.]+$/, '')
      const response = await fetch('/api/shorts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources,
          name: name.slice(0, 200) || 'Untitled video',
          sourceLabel: file ? file.name : url,
          count,
          clipDuration,
          crop,
          grayscale,
          transcript: transcript.trim() || undefined,
          audioPublicId,
          captions: captionsOn,
          hook: hookOn,
          sourceCredit: sourceCredit.trim() || undefined,
          layout,
          gameplayIds: layout === 'split' && gameplaySelected.length ? gameplaySelected : undefined,
          captionStyle,
          captionPosition,
          rightsSource,
          rightsProof: rightsProof.trim() || undefined,
        }),
      })
      const body = await readJson(response)
      if (!response.ok) throw new Error(String(body.error || 'Could not create the shorts.'))
      if (body.mode === 'even' && transcript.trim()) setNote(String(body.note || 'The transcript had too few timestamps, so clips were spread evenly.'))
      else if (body.note) setNote(String(body.note))
      const id = String(body.projectId)
      window.history.replaceState(null, '', `/editor?project=${id}`)
      setStage('rendering')
      setProjectId(id)
    } catch (caught) {
      setStage('failed')
      setError(caught instanceof Error && caught.message !== 'Failed to fetch' ? caught.message : 'Network error while talking to Cloudinary. Check your connection and try again.')
    }
  }

  const reset = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current)
    window.history.replaceState(null, '', '/editor')
    setProjectId(''); setProjectView(null); setClips([]); setStage('idle'); setError(''); setNote(''); setFile(null); setRemoteUrl(''); setUploadProgress(0)
  }

  const downloadAll = async () => {
    setDownloadingAll(true)
    for (const item of clips.filter((entry) => entry.status === 'ready')) {
      await downloadClip(item, projectView?.name || 'short')
      await new Promise((resolve) => setTimeout(resolve, 600))
    }
    setDownloadingAll(false)
  }

  const copyText = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => undefined)
    setCopied(key)
    setTimeout(() => setCopied(''), 1500)
  }
  const youtubeDescription = (item: ClipView) => [item.description, item.hashtags].filter(Boolean).join('\n\n')
  // Delete the big source video (and audio) once the shorts exist; repeats while older
  // shorts are being saved as standalone files.
  const freeSpace = async () => {
    setStorageBusy('free'); setError('')
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const response = await fetch(`/api/shorts/${projectId}/free`, { method: 'POST' })
        const body = await readJson(response)
        if (!response.ok) throw new Error(String(body.error || 'Could not free up space.'))
        if (body.storage) setStorage(body.storage as { sourcesStored: boolean; sourceBytes: number })
        if (body.done) {
          const mb = Math.round(Number(body.freedBytes || 0) / 1048576)
          setNote(`Freed ${mb > 0 ? `${mb} MB` : 'the source files'} on Cloudinary. Your shorts stay downloadable.`)
          await poll(projectId)
          return
        }
      }
      throw new Error('Still saving shorts. Click "Free up space" again to continue.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not free up space.')
    } finally {
      setStorageBusy('')
    }
  }

  const deleteWholeProject = async () => {
    if (!window.confirm('Delete this project, all its shorts and every Cloudinary file it created? Download the shorts you need first. This cannot be undone.')) return
    setStorageBusy('delete'); setError('')
    try {
      const response = await fetch(`/api/shorts/${projectId}`, { method: 'DELETE' })
      const body = await readJson(response)
      if (!response.ok) throw new Error(String(body.error || 'Could not delete the project.'))
      if (pollTimer.current) clearTimeout(pollTimer.current)
      window.location.href = '/'
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the project.')
      setStorageBusy('')
    }
  }

  const setYoutubeCheck = async (item: ClipView, youtubeCheck: NonNullable<ClipView['youtubeCheck']>) => {
    setClips((current) => current.map((entry) => (entry.id === item.id ? { ...entry, youtubeCheck } : entry)))
    const response = await fetch(`/api/shorts/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clipId: item.id, youtubeCheck }),
    }).catch(() => null)
    if (!response?.ok) setError('Could not save the copyright check. Try again.')
  }

  const downloadSrt = (item: ClipView) => {
    if (!item.captions) return
    const href = URL.createObjectURL(new Blob([item.captions], { type: 'application/x-subrip' }))
    const link = document.createElement('a')
    link.href = href
    link.download = `${String(item.position).padStart(2, '0')}-captions.srt`
    link.click()
    setTimeout(() => URL.revokeObjectURL(href), 5000)
  }

  const inputClass = 'mt-2 w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-violet-300/50'
  const showForm = !projectId

  return <main className="min-h-screen bg-[#090a0d] px-4 py-10 text-[#f4f4f5] sm:px-8">
    <div className="mx-auto max-w-4xl">
      <a href="/" className="text-xs text-[#858894] transition-colors hover:text-white">← Back to dashboard</a>
      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">ClipForge AI</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Long video → YouTube Shorts</h1>
      <p className="mt-2 text-sm text-[#858894]">Upload a long video (an hour or more works) and get {count} vertical 1080×1920 shorts ready for YouTube.</p>

      {showForm && <section className="mt-8 space-y-4">
        <label htmlFor="source-file" className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-violet-300/30 bg-violet-400/[0.05] px-6 py-12 text-center hover:bg-violet-400/[0.09]">
          <Upload className="text-violet-300" />
          <span className="mt-3 text-sm font-medium">{file ? file.name : 'Choose a video file'}</span>
          <span className="mt-1 text-xs text-[#777a86]">{file ? `${(file.size / 1024 / 1024).toFixed(0)} MB` : 'MP4, MOV, MKV, WEBM — uploaded in chunks straight to Cloudinary'}</span>
          <input id="source-file" type="file" accept="video/*,.mov,.m4v,.mp4,.webm,.mkv" className="sr-only" disabled={busy} onChange={(event) => { const picked = event.target.files?.[0]; if (picked) { setFile(picked); setRemoteUrl(''); setError('') } }} />
        </label>

        <div className="rounded-2xl border border-white/[0.08] bg-[#111216] p-4">
          <label htmlFor="video-url" className="text-xs font-medium text-[#c7c8d0]">…or paste a direct video file URL</label>
          <input id="video-url" type="url" value={remoteUrl} disabled={busy} onChange={(event) => { setRemoteUrl(event.target.value); if (event.target.value) setFile(null) }} placeholder="https://cdn.example.com/podcast.mp4" className={inputClass} />
        </div>

        <div className="grid gap-4 rounded-2xl border border-white/[0.08] bg-[#111216] p-4 sm:grid-cols-2">
          <label className="text-xs text-[#a8aab4]">Number of shorts: <span className="font-semibold text-white">{count}</span>
            <input type="range" min={10} max={15} value={count} disabled={busy} onChange={(event) => setCount(Number(event.target.value))} className="mt-3 w-full accent-violet-400" />
          </label>
          <label className="text-xs text-[#a8aab4]">Length of each short
            <select value={clipDuration} disabled={busy} onChange={(event) => setClipDuration(Number(event.target.value))} className={inputClass}>
              {[30, 45, 60, 90, 120, 180].map((seconds) => <option key={seconds} value={seconds} className="bg-[#111216]">{seconds < 60 ? `${seconds} seconds` : `${seconds / 60} minute${seconds > 60 ? 's' : ''}`}</option>)}
            </select>
          </label>
          <label className="text-xs text-[#a8aab4]">Vertical framing
            <select value={crop} disabled={busy} onChange={(event) => setCrop(event.target.value as CropMode)} className={inputClass}>
              <option value="center" className="bg-[#111216]">Center crop (fills the screen)</option>
              <option value="smart" className="bg-[#111216]">Smart crop (follows faces/action)</option>
              <option value="blur" className="bg-[#111216]">Full frame on blurred background</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-[#c7c8d0]"><input type="checkbox" checked={grayscale} disabled={busy} onChange={(event) => setGrayscale(event.target.checked)} /> Black-and-white grade</label>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-[#111216] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-[#c7c8d0]"><FileText className="mr-1 inline size-3.5" /> Transcript (optional: pasted, or created automatically)</p>
            <label className="cursor-pointer text-xs text-violet-300 hover:text-violet-200">Load .srt / .vtt / .txt<input type="file" accept=".srt,.vtt,.txt" className="sr-only" onChange={(event) => loadTranscriptFile(event.target.files?.[0])} /></label>
          </div>
          <textarea value={transcript} disabled={busy} onChange={(event) => setTranscript(event.target.value)} rows={5} placeholder={'Paste a timestamped transcript, e.g. from YouTube "Show transcript":\n0:00\nWelcome back to the channel…\n0:07\nToday we are talking about…'} className={`${inputClass} font-mono text-xs`} />
          <p className="mt-2 text-xs text-[#777a86]">{transcript.trim() ? 'Your transcript will be used for the AI picks, captions, hooks, titles and descriptions.' : 'Leave empty to transcribe automatically (needs a free GROQ_API_KEY in Vercel). Without either, clips are spread evenly and have no captions.'} Tip: YouTube Studio → Subtitles → download the .srt.</p>
        </div>

        <div className="grid gap-4 rounded-2xl border border-white/[0.08] bg-[#111216] p-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-[#c7c8d0]"><input type="checkbox" checked={captionsOn} disabled={busy} onChange={(event) => setCaptionsOn(event.target.checked)} /> <Captions className="size-4 text-violet-300" /> Burn in captions</label>
          <label className="flex items-center gap-2 text-sm text-[#c7c8d0]"><input type="checkbox" checked={hookOn} disabled={busy} onChange={(event) => setHookOn(event.target.checked)} /> <WandSparkles className="size-4 text-violet-300" /> Hook text for the first 3 seconds</label>
          <label className="text-xs text-[#a8aab4] sm:col-span-2">Source credit (added to every description)
            <input value={sourceCredit} disabled={busy} onChange={(event) => setSourceCredit(event.target.value)} placeholder="e.g. From the full episode on @MyPodcast — youtube.com/watch?v=…" className={inputClass} />
          </label>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-[#111216] p-4">
          <p className="text-xs font-medium text-[#c7c8d0]">Look</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {([
              ['full', 'Full vertical', 'Your clip fills the whole 9:16 screen.'],
              ['split', 'Split-screen + gameplay', 'Your clip on top, gameplay below, captions in the middle.'],
            ] as const).map(([value, label, hint]) => (
              <label key={value} className={`cursor-pointer rounded-xl border p-3 text-sm ${layout === value ? 'border-violet-300/50 bg-violet-400/[0.08]' : 'border-white/[0.08] hover:bg-white/[0.03]'}`}>
                <input type="radio" name="layout" className="sr-only" checked={layout === value} disabled={busy} onChange={() => setLayout(value)} />
                <span className="font-medium text-white">{label}</span>
                <span className="mt-1 block text-xs text-[#858894]">{hint}</span>
              </label>
            ))}
          </div>

          {layout === 'split' && <div className="mt-3 rounded-xl border border-white/[0.06] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-[#c7c8d0]"><Gamepad2 className="mr-1 inline size-3.5 text-violet-300" />Gameplay library {gameplaySelected.length ? `(${gameplaySelected.length} selected)` : '(all clips are used, one per short)'}</p>
              <label className={`cursor-pointer rounded-lg bg-white/[0.06] px-2 py-1 text-xs text-violet-200 hover:bg-white/[0.12] ${gameplayBusy ? 'pointer-events-none opacity-60' : ''}`}>
                {gameplayBusy || '+ Add gameplay clip'}
                <input type="file" accept="video/*,.mp4,.mov,.webm,.mkv" className="sr-only" disabled={Boolean(gameplayBusy)} onChange={(event) => { addGameplay(event.target.files?.[0]); event.target.value = '' }} />
              </label>
            </div>
            {gameplayList.length === 0
              ? <p className="mt-2 text-xs text-amber-200">No gameplay yet. Add a clip of your own gameplay or footage marked free to reuse, longer than your shorts (2–5 minutes is ideal, under 100 MB). Its audio is removed automatically.</p>
              : <ul className="mt-2 space-y-1">{gameplayList.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-2 py-1.5 text-xs">
                  <label className="flex min-w-0 items-center gap-2 text-[#c7c8d0]">
                    <input type="checkbox" checked={gameplaySelected.includes(item.id)} disabled={busy} onChange={(event) => setGameplaySelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />
                    <span className="truncate">{item.name}</span>
                    <span className={item.duration > clipDuration ? 'text-[#777a86]' : 'text-amber-200'}>{formatTimestamp(item.duration)}{item.duration > clipDuration ? '' : ' (too short)'}</span>
                  </label>
                  <button type="button" onClick={() => removeGameplay(item.id)} className="text-[#858894] hover:text-red-300" aria-label={`Remove ${item.name}`}><Trash2 className="size-3.5" /></button>
                </li>
              ))}</ul>}
          </div>}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[#a8aab4]">Caption style
              <select value={captionStyle} disabled={busy} onChange={(event) => setCaptionStyle(event.target.value as CaptionStyle)} className={inputClass}>
                {CAPTION_STYLE_IDS.map((id) => <option key={id} value={id} className="bg-[#111216]">{CAPTION_STYLES[id].label}</option>)}
              </select>
            </label>
            <label className="text-xs text-[#a8aab4]">Caption position
              <select value={layout === 'split' ? 'middle' : captionPosition} disabled={busy || layout === 'split'} onChange={(event) => setCaptionPosition(event.target.value as CaptionPosition)} className={inputClass}>
                <option value="lower" className="bg-[#111216]">Lower third</option>
                <option value="middle" className="bg-[#111216]">Middle of the screen</option>
              </select>
            </label>
          </div>
        </div>

        <fieldset className="rounded-2xl border border-white/[0.08] bg-[#111216] p-4">
          <legend className="px-1 text-xs font-medium text-[#c7c8d0]"><ShieldCheck className="mr-1 inline size-3.5 text-emerald-300" />Copyright: where do your rights to clip this video come from?</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {([
              ['own', 'My own video', 'I made it or own it.', 'border-emerald-300/40 bg-emerald-400/[0.08]'],
              ['permission', 'Permission / clipping campaign', 'Vyro, Whop Content Rewards, or the creator said yes.', 'border-sky-300/40 bg-sky-400/[0.08]'],
              ['unsure', 'Not sure', 'Someone else’s video, no permission.', 'border-red-300/40 bg-red-400/[0.08]'],
            ] as const).map(([value, label, hint, active]) => (
              <label key={value} className={`cursor-pointer rounded-xl border p-3 text-sm transition-colors ${rightsSource === value ? active : 'border-white/[0.08] hover:bg-white/[0.03]'}`}>
                <input type="radio" name="rights" className="sr-only" checked={rightsSource === value} disabled={busy} onChange={() => setRightsSource(value)} />
                <span className="font-medium text-white">{label}</span>
                <span className="mt-1 block text-xs text-[#858894]">{hint}</span>
              </label>
            ))}
          </div>
          {rightsSource === 'permission' && <label className="mt-3 block text-xs text-[#a8aab4]">Campaign or permission link (required)
            <input value={rightsProof} disabled={busy} onChange={(event) => setRightsProof(event.target.value)} placeholder="e.g. https://vyro.com/campaign/… or https://whop.com/…" className={inputClass} />
          </label>}
          {rightsSource === 'unsure' && <p className="mt-3 flex gap-2 rounded-xl bg-red-400/10 p-3 text-xs text-red-200"><ShieldAlert className="size-4 shrink-0" />Clips of videos you don&apos;t have rights to get Content ID claims and copyright strikes (3 strikes deletes a channel), and music or effects don&apos;t prevent that. Join the creator&apos;s official clipping campaign (e.g. on Vyro or Whop), then choose &ldquo;Permission / clipping campaign&rdquo;.</p>}
          <p className="mt-3 text-xs text-[#777a86]">ClipForge can&apos;t see YouTube&apos;s Content ID database. After you upload, each short gets a checkbox for YouTube&apos;s own copyright check.</p>
        </fieldset>

        <Button onClick={start} disabled={busy || !rightsReady || (!file && !remoteUrl.trim())} className="h-11 gap-2 rounded-xl bg-violet-500 px-5 hover:bg-violet-400">
          {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <WandSparkles data-icon="inline-start" />}
          {stage === 'splitting' ? `Splitting large video ${Math.round(uploadProgress * 100)}%` : stage === 'uploading' ? `Uploading${partLabel ? ` ${partLabel}` : ''} ${Math.round(uploadProgress * 100)}%` : stage === 'audio' ? `Preparing captions ${Math.round(uploadProgress * 100)}%` : stage === 'planning' ? 'Transcribing and picking the best moments…' : `Create ${count} shorts`}
        </Button>
        {(stage === 'uploading' || stage === 'splitting' || stage === 'audio') && <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full bg-gradient-to-r from-violet-500 to-indigo-400 transition-all" style={{ width: `${Math.round(uploadProgress * 100)}%` }} /></div>}
        {(stage === 'uploading' || stage === 'splitting') && <p className="text-xs text-[#777a86]">{stage === 'splitting' ? 'Your file is bigger than your Cloudinary plan allows, so it is being split into parts in your browser (no quality loss). ' : ''}Keep this tab open until the upload finishes. Rendering happens on Cloudinary afterwards, so you can leave once it starts.</p>}
      </section>}

      {projectId && <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#111216] p-4">
          <div>
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">{projectView?.name || 'Loading project…'}{projectView && <RightsBadge source={projectView.rightsSource} proof={projectView.rightsProof} />}</p>
            <p className="mt-1 text-xs text-[#858894]">
              {stage === 'done' ? `All ${clips.length} shorts are ready.` : stage === 'failed' ? `${readyCount}/${clips.length} shorts ready.` : `Rendering on Cloudinary: ${readyCount}/${clips.length || '…'} ready. Long videos can take several minutes, and you can close this tab and come back from the dashboard.`}
            </p>
            {readyCount > 0 && <p className="mt-1 text-xs text-[#858894]">
              YouTube copyright check: <span className="text-emerald-300">{clips.filter((entry) => entry.youtubeCheck === 'passed').length} passed</span>
              {clips.some((entry) => entry.youtubeCheck === 'claimed') && <> · <span className="text-amber-200">{clips.filter((entry) => entry.youtubeCheck === 'claimed').length} claimed</span></>}
              {' '}· {clips.filter((entry) => entry.status === 'ready' && (!entry.youtubeCheck || entry.youtubeCheck === 'pending')).length} not checked yet
            </p>}
            {storage && <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#858894]">
              <HardDrive className="size-3.5" />
              {storage.sourcesStored
                ? <>Source video still stored on Cloudinary{storage.sourceBytes > 0 ? ` (${Math.round(storage.sourceBytes / 1048576)} MB)` : ''}.
                  {stage === 'done' && <button type="button" disabled={Boolean(storageBusy)} onClick={freeSpace} className="rounded-md bg-white/[0.06] px-2 py-0.5 text-violet-200 hover:bg-white/[0.12] disabled:opacity-50">{storageBusy === 'free' ? 'Freeing…' : 'Free up space'}</button>}</>
                : <span className="text-emerald-300">Source video deleted to save space. Shorts stay downloadable.</span>}
            </p>}
          </div>
          <div className="flex gap-2">
            {readyCount > 0 && <Button onClick={downloadAll} disabled={downloadingAll} className="gap-2 rounded-xl bg-white text-black hover:bg-white/90">{downloadingAll ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}Download {readyCount === clips.length ? 'all' : `${readyCount} ready`}</Button>}
            <Button variant="outline" onClick={reset} className="rounded-xl border-white/[0.1] bg-transparent">New video</Button>
            <Button variant="outline" onClick={deleteWholeProject} disabled={Boolean(storageBusy) || stage === 'rendering'} title="Delete project and all its files" className="gap-1.5 rounded-xl border-red-300/30 bg-transparent text-red-200 hover:bg-red-400/10">{storageBusy === 'delete' ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}Delete</Button>
          </div>
        </div>
        {stage === 'rendering' && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full bg-gradient-to-r from-violet-500 to-indigo-400 transition-all" style={{ width: `${clips.length ? Math.max(4, (readyCount / clips.length) * 100) : 4}%` }} /></div>}

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clips.map((item) => <article key={item.id} className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111216]">
            <div className="relative aspect-[9/16] bg-black">
              {item.status === 'ready'
                ? <video src={item.url} controls preload="metadata" playsInline className="h-full w-full object-contain" />
                : <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-[#858894]"><Loader2 className="size-5 animate-spin text-violet-300" />{item.status === 'finishing' ? 'Adding captions…' : 'Rendering…'}</div>}
              <span className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-1 text-[10px] text-white/80">#{item.position} · {formatTimestamp(item.start)}–{formatTimestamp(item.start + item.duration)}</span>
            </div>
            <div className="p-3">
              <p className="text-sm font-medium leading-snug">{item.title}</p>
              {item.hook && <p className="mt-1 text-xs text-violet-200">Hook: “{item.hook}”</p>}
              {item.description
                ? <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-[#858894]">{item.description}</p>
                : item.reason && <p className="mt-1 text-xs text-[#858894]">{item.reason}</p>}
              {item.hashtags && <p className="mt-1 text-xs text-sky-300">{item.hashtags}</p>}
              {item.detail && <p className="mt-1 text-xs text-amber-200">{item.detail}</p>}
              {item.status === 'ready' && <div className="mt-3 rounded-lg border border-white/[0.08] p-2 text-xs">
                <p className="text-[#a8aab4]">
                  {item.youtubeCheck === 'passed' ? <span className="text-emerald-300">✅ YouTube check: no issues found. Safe to publish.</span>
                    : item.youtubeCheck === 'claimed' ? <span className="text-amber-200">⚠️ YouTube found a copyright claim. Don&apos;t publish; delete the draft.</span>
                    : <>YouTube copyright check: upload as <b>Private</b> in YouTube Studio and wait for the &ldquo;Checks&rdquo; step.</>}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setYoutubeCheck(item, 'passed')} className={`rounded-md px-2 py-1 ${item.youtubeCheck === 'passed' ? 'bg-emerald-400/20 text-emerald-200' : 'bg-white/[0.05] text-[#c7c8d0] hover:bg-white/[0.1]'}`}>No issues found</button>
                  <button type="button" onClick={() => setYoutubeCheck(item, 'claimed')} className={`rounded-md px-2 py-1 ${item.youtubeCheck === 'claimed' ? 'bg-amber-400/20 text-amber-200' : 'bg-white/[0.05] text-[#c7c8d0] hover:bg-white/[0.1]'}`}>Got a claim</button>
                  {item.youtubeCheck && item.youtubeCheck !== 'pending' && <button type="button" onClick={() => setYoutubeCheck(item, 'pending')} className="rounded-md px-2 py-1 text-[#858894] hover:text-white">Reset</button>}
                </div>
              </div>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" disabled={item.status !== 'ready'} onClick={() => downloadClip(item, projectView?.name || 'short')} className="gap-1.5 rounded-lg bg-violet-500 hover:bg-violet-400"><Download data-icon="inline-start" />MP4</Button>
                <Button size="sm" variant="outline" onClick={() => copyText(`${item.id}:title`, item.title)} className="gap-1.5 rounded-lg border-white/[0.1] bg-transparent">{copied === `${item.id}:title` ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}Title</Button>
                <Button size="sm" variant="outline" onClick={() => copyText(`${item.id}:desc`, youtubeDescription(item) || item.title)} className="gap-1.5 rounded-lg border-white/[0.1] bg-transparent">{copied === `${item.id}:desc` ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}Description</Button>
                {item.captions && <Button size="sm" variant="outline" onClick={() => downloadSrt(item)} className="gap-1.5 rounded-lg border-white/[0.1] bg-transparent"><Captions data-icon="inline-start" />.srt</Button>}
              </div>
            </div>
          </article>)}
        </div>
      </section>}

      {note && <p className="mt-4 text-sm text-amber-200">{note}</p>}
      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
    </div>
  </main>
}
