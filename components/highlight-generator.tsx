'use client'

import { useState } from 'react'

export function HighlightGenerator() {
  const [transcript, setTranscript] = useState('')
  const [highlights, setHighlights] = useState<Array<{ title?: string; hook?: string; caption?: string; reason?: string }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function generate() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/highlights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Generation failed')
      setHighlights(Array.isArray(data.highlights) ? data.highlights : [])
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Generation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">AI editor</p>
        <h2 className="mt-2 text-xl font-semibold text-white">Find highlights and write captions</h2>
        <p className="mt-1 text-sm text-white/50">Paste a transcript to get hooks, clip ideas, and captions.</p>
      </div>
      <textarea
        value={transcript}
        onChange={(event) => setTranscript(event.target.value)}
        placeholder="Paste your transcript here..."
        className="min-h-36 w-full resize-y rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-violet-400"
      />
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={generate}
          disabled={loading || transcript.trim().length < 20}
          className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? 'Generating...' : 'Generate highlights'}
        </button>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
      </div>
      {highlights.length > 0 ? (
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {highlights.map((highlight, index) => (
            <article key={`${highlight.title ?? 'highlight'}-${index}`} className="rounded-xl border border-white/10 bg-black/20 p-4">
              <h3 className="font-semibold text-white">{highlight.title ?? `Highlight ${index + 1}`}</h3>
              <p className="mt-2 text-sm text-violet-200">{highlight.hook}</p>
              <p className="mt-2 text-sm text-white/60">{highlight.caption}</p>
              <p className="mt-3 text-xs text-white/40">{highlight.reason}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
