'use client'

import { useMemo, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clapperboard,
  Clock3,
  Download,
  FileVideo,
  Film,
  FolderOpen,
  Gauge,
  HardDrive,
  HelpCircle,
  Layers3,
  Menu,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Upload,
  UserRound,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

const projects: Array<{ name: string; date: string; duration: string; clips: number; status: string; gradient: string; initial: string }> = []

const nav = [
  { label: 'Overview', icon: Gauge },
  { label: 'Projects', icon: FolderOpen },
  { label: 'Generated shorts', icon: Clapperboard, count: '34' },
  { label: 'Processing queue', icon: Activity, count: '1' },
]

function StatCard({ label, value, detail, icon: Icon, accent }: { label: string; value: string; detail: string; icon: typeof Gauge; accent: string }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111216] p-5 transition-colors hover:border-white/[0.14]">
      <div className={`absolute -right-8 -top-8 size-28 rounded-full blur-3xl opacity-20 ${accent}`} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[12px] font-medium text-[#858894]">{label}</p>
          <p className="mt-3 text-[30px] font-semibold tracking-[-0.04em] text-[#f4f4f5]">{value}</p>
          <p className="mt-1 text-[12px] text-[#858894]">{detail}</p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-2.5 text-[#a9abb6]"><Icon className="size-4" /></div>
      </div>
    </div>
  )
}

export default function ClipforgeDashboard({ user }: { user?: { name?: string | null; email: string } }) {
  const [active, setActive] = useState('Overview')
  const [showUpload, setShowUpload] = useState(false)
  const [fileName, setFileName] = useState('')
  const [playing, setPlaying] = useState<number | null>(null)
  const [search, setSearch] = useState('')

  const filteredProjects = useMemo(() => projects.filter((project) => project.name.toLowerCase().includes(search.toLowerCase())), [search])

  return (
    <div className="min-h-screen bg-[#090a0d] text-[#f4f4f5] selection:bg-violet-400/30">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[244px] flex-col border-r border-white/[0.06] bg-[#0d0e11] px-3 py-4 lg:flex">
        <div className="flex items-center gap-3 px-3 pb-8 pt-1">
          <div className="relative flex size-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-violet-400 to-indigo-600 shadow-[0_0_24px_rgba(124,92,255,0.35)]"><Film className="size-[17px] text-white" strokeWidth={2.3} /></div>
          <div><p className="text-[14px] font-semibold tracking-[-0.02em]">ClipForge <span className="text-violet-400">AI</span></p><p className="text-[10px] text-[#737580]">Creator workspace</p></div>
        </div>
        <div className="px-2"><Button onClick={() => setShowUpload(true)} className="h-10 w-full justify-center gap-2 rounded-xl bg-[#f1f1f3] text-[12px] font-semibold text-[#17181c] hover:bg-white"><Plus data-icon="inline-start" /> New project</Button></div>
        <nav className="mt-8 flex flex-col gap-1">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5f626d]">Workspace</p>
          {nav.map(({ label, icon: Icon, count }) => <button key={label} onClick={() => setActive(label)} className={`flex h-10 items-center gap-3 rounded-xl px-3 text-left text-[12px] transition-colors ${active === label ? 'bg-white/[0.08] text-white' : 'text-[#858894] hover:bg-white/[0.04] hover:text-[#d7d7dc]'}`}><Icon className="size-[16px]" /><span className="flex-1">{label}</span>{count && <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[10px] text-[#8d90a0]">{count}</span>}</button>)}
        </nav>
        <div className="mt-auto flex flex-col gap-1">
          <button className="flex h-10 items-center gap-3 rounded-xl px-3 text-[12px] text-[#858894] hover:bg-white/[0.04] hover:text-[#d7d7dc]"><Settings2 className="size-[16px]" /> Settings</button>
          <button className="flex h-10 items-center gap-3 rounded-xl px-3 text-[12px] text-[#858894] hover:bg-white/[0.04] hover:text-[#d7d7dc]"><HelpCircle className="size-[16px]" /> Help center</button>
          <div className="mt-4 flex items-center gap-3 border-t border-white/[0.06] px-3 pt-4"><div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-[#f1a880] to-[#9d66e8] text-[11px] font-semibold text-white">JD</div><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium">Jordan Davis</p><p className="truncate text-[10px] text-[#70727c]">Pro workspace</p></div><ChevronDown className="size-3.5 text-[#686a75]" /></div>
        </div>
      </aside>

      <main className="lg:pl-[244px]">
        <header className="flex h-[72px] items-center justify-between border-b border-white/[0.06] px-5 sm:px-8">
          <div className="flex items-center gap-3"><button className="lg:hidden"><Menu className="size-5 text-[#9799a4]" /></button><div><p className="text-[12px] text-[#6f727d]">Workspace / <span className="text-[#c7c8ce]">{active}</span></p><h1 className="mt-1 text-[20px] font-semibold tracking-[-0.03em]">Good morning, Jordan <span className="text-[#a7a9b3]">✦</span></h1></div></div>
          <div className="flex items-center gap-3"><div className="hidden items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2 sm:flex"><Search className="size-3.5 text-[#6f727d]" /><input aria-label="Search projects" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects" className="w-32 bg-transparent text-[11px] outline-none placeholder:text-[#636671]" /></div><Button variant="outline" onClick={() => setShowUpload(true)} className="h-9 gap-2 rounded-xl border-white/[0.1] bg-transparent px-3 text-[11px] text-[#d8d8dc] hover:bg-white/[0.06]"><Upload data-icon="inline-start" /> Upload video</Button><div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-[#f1a880] to-[#9d66e8] text-[10px] font-semibold lg:hidden">JD</div></div>
        </header>

        <div className="mx-auto max-w-[1360px] px-5 py-7 sm:px-8 lg:px-10">
          <section className="relative overflow-hidden rounded-2xl border border-violet-400/20 bg-gradient-to-br from-[#181628] via-[#12131c] to-[#101116] px-6 py-7 sm:px-8">
            <div className="absolute -right-24 -top-28 size-72 rounded-full bg-violet-600/20 blur-[80px]" /><div className="absolute bottom-[-100px] left-[42%] size-56 rounded-full bg-indigo-500/10 blur-[70px]" />
            <div className="relative flex flex-col justify-between gap-7 md:flex-row md:items-center"><div><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-400/10 px-2.5 py-1 text-[10px] font-medium text-violet-200"><Sparkles className="size-3" /> Your creative pipeline is ready</div><h2 className="max-w-xl text-[25px] font-semibold leading-tight tracking-[-0.04em] sm:text-[30px]">Turn long videos into <span className="text-violet-300">scroll-stopping shorts.</span></h2><p className="mt-2 max-w-lg text-[12px] leading-relaxed text-[#9b9ca8]">Upload a video and let ClipForge find the moments your audience will want to watch twice.</p></div><Button onClick={() => setShowUpload(true)} className="h-11 shrink-0 gap-2 rounded-xl bg-violet-500 px-5 text-[12px] font-semibold text-white shadow-[0_8px_30px_rgba(124,92,255,0.25)] hover:bg-violet-400"><WandSparkles data-icon="inline-start" /> Create your first short</Button></div>
          </section>

          <section className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4"><StatCard label="Videos processed" value="28" detail="+12.5% this month" icon={FileVideo} accent="bg-violet-500" /><StatCard label="Shorts generated" value="186" detail="Across 23 projects" icon={Clapperboard} accent="bg-cyan-500" /><StatCard label="Hours saved" value="42.8" detail="vs. manual editing" icon={Clock3} accent="bg-amber-500" /><StatCard label="Storage used" value="18.4 GB" detail="of 100 GB available" icon={HardDrive} accent="bg-emerald-500" /></section>

          <section className="mt-9 flex items-center justify-between"><div><h2 className="text-[16px] font-semibold tracking-[-0.02em]">Recent projects</h2><p className="mt-1 text-[11px] text-[#767984]">Pick up where you left off</p></div><button className="flex items-center gap-1 text-[11px] font-medium text-violet-300 hover:text-violet-200">View all <ArrowUpRight className="size-3.5" /></button></section>
          <section className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filteredProjects.map((project, index) => <article key={project.name} className="group overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111216] transition-all hover:-translate-y-0.5 hover:border-white/[0.15]"><div className={`relative aspect-[1.95/1] overflow-hidden bg-gradient-to-br ${project.gradient}`}><div className="absolute inset-0 bg-[radial-gradient(circle_at_65%_35%,rgba(255,255,255,.2),transparent_26%),linear-gradient(140deg,transparent,rgba(0,0,0,.45))]" /><div className="absolute left-4 top-4 flex items-center gap-2"><span className="rounded-md border border-white/20 bg-black/20 px-2 py-1 text-[10px] font-semibold tracking-wide text-white/80">{project.initial}</span><span className="rounded-md bg-black/25 px-2 py-1 text-[10px] text-white/70">{project.duration}</span></div><button onClick={() => setPlaying(playing === index ? null : index)} className="absolute left-1/2 top-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-black/25 text-white backdrop-blur-sm transition-transform hover:scale-110">{playing === index ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" fill="currentColor" />}</button><div className="absolute bottom-3 left-4 right-4 flex items-center justify-between text-[10px] text-white/65"><span>{project.clips} clips generated</span><span>{project.status === 'Processing' ? <span className="flex items-center gap-1.5"><span className="size-1.5 animate-pulse rounded-full bg-amber-300" /> Processing</span> : <span className="flex items-center gap-1.5"><Check className="size-3 text-emerald-300" /> Ready</span>}</span></div></div><div className="flex items-center justify-between p-4"><div className="min-w-0"><h3 className="truncate text-[13px] font-medium text-[#e6e6e8]">{project.name}</h3><p className="mt-1 text-[10px] text-[#737580]">{project.date}</p></div><button aria-label={`More options for ${project.name}`} className="rounded-lg p-2 text-[#737580] hover:bg-white/[0.06] hover:text-white"><MoreHorizontal className="size-4" /></button></div></article>)}</section>

          <section className="mt-9 grid gap-4 xl:grid-cols-[1.25fr_0.75fr]"><div className="rounded-2xl border border-white/[0.07] bg-[#111216] p-5"><div className="flex items-center justify-between"><div><h2 className="text-[14px] font-semibold">Processing queue</h2><p className="mt-1 text-[11px] text-[#767984]">1 job currently running</p></div><span className="flex items-center gap-1.5 rounded-full border border-amber-300/15 bg-amber-300/10 px-2.5 py-1 text-[10px] text-amber-200"><span className="size-1.5 animate-pulse rounded-full bg-amber-300" /> Live</span></div><div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.025] p-4"><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#3d1f49] to-[#c3789c]"><FileVideo className="size-4 text-white/80" /></div><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium">Founder stories — episode 04</p><p className="mt-1 text-[10px] text-[#747783]">Generating 8 shorts · 4:32 remaining</p></div><span className="text-[12px] font-semibold text-violet-300">68%</span></div><div className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full w-[68%] rounded-full bg-gradient-to-r from-violet-500 to-indigo-400" /></div><div className="mt-3 flex items-center justify-between text-[10px] text-[#737580]"><span>Analysing highlights</span><button className="flex items-center gap-1 hover:text-white"><X className="size-3" /> Cancel</button></div></div></div><div className="rounded-2xl border border-white/[0.07] bg-[#111216] p-5"><div className="flex items-center justify-between"><div><h2 className="text-[14px] font-semibold">Your plan</h2><p className="mt-1 text-[11px] text-[#767984]">Pro workspace</p></div><Zap className="size-4 text-violet-300" /></div><div className="mt-5 flex items-end justify-between"><div><span className="text-[25px] font-semibold tracking-[-0.04em]">186</span><span className="ml-1 text-[11px] text-[#777985]">/ 500 clips</span></div><span className="text-[10px] text-[#8e90a0]">37% used</span></div><div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full w-[37%] rounded-full bg-violet-400" /></div><button className="mt-5 flex items-center gap-1 text-[11px] font-medium text-violet-300 hover:text-violet-200">Manage plan <ArrowUpRight className="size-3.5" /></button></div></section>
        </div>
      </main>

      {showUpload && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-2xl border border-white/[0.1] bg-[#15161b] p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 className="text-[18px] font-semibold">Create a new project</h2><p className="mt-1 text-[12px] text-[#858894]">Upload a long-form video to start forging shorts.</p></div><button onClick={() => setShowUpload(false)} className="rounded-lg p-2 text-[#858894] hover:bg-white/[0.06] hover:text-white"><X className="size-4" /></button></div><label htmlFor="video-upload" className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-violet-300/30 bg-violet-400/[0.04] px-5 py-10 text-center transition-colors hover:bg-violet-400/[0.08]"><div className="flex size-12 items-center justify-center rounded-2xl bg-violet-400/15 text-violet-300"><Upload className="size-5" /></div><p className="mt-4 text-[13px] font-medium">Drop your video here or browse files</p><p className="mt-1 text-[11px] text-[#777a86]">MP4, MOV, MKV, AVI or WEBM · up to 10 GB</p><input id="video-upload" type="file" accept="video/mp4,video/quicktime,video/x-matroska,video/x-msvideo,video/webm" className="sr-only" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')} /></label>{fileName && <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.06] p-3"><FileVideo className="size-4 text-emerald-300" /><span className="flex-1 truncate text-[12px]">{fileName}</span><Check className="size-4 text-emerald-300" /></div>}<div className="mt-6 flex justify-end gap-2"><Button variant="outline" onClick={() => setShowUpload(false)} className="rounded-xl border-white/[0.1] bg-transparent text-[12px]">Cancel</Button><Button disabled={!fileName} onClick={() => { setShowUpload(false); setActive('Processing queue') }} className="rounded-xl bg-violet-500 text-[12px] hover:bg-violet-400"><WandSparkles data-icon="inline-start" /> Start analysis</Button></div></div></div>}
    </div>
  )
}
