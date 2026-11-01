import { ShortsStudio } from '@/components/shorts-studio'

export default async function EditorPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams
  return <ShortsStudio initialProjectId={typeof project === 'string' ? project : undefined} />
}
