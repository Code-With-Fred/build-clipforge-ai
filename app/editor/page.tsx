import { HighlightGenerator } from '@/components/highlight-generator'
import { VideoCutter } from '@/components/video-cutter'

export default function EditorPage() {
  return (
    <main>
      <VideoCutter />
      <div className="mx-auto max-w-3xl px-6 pb-16">
        <HighlightGenerator />
      </div>
    </main>
  )
}
