import { redirect } from 'next/navigation'
import { ShortsStudio } from '@/components/shorts-studio'
import { getSession } from '@/lib/auth'

export default async function EditorPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const session = await getSession()
  if (!session?.user) redirect('/sign-in')
  const { project } = await searchParams
  return <ShortsStudio initialProjectId={typeof project === 'string' ? project : undefined} />
}
