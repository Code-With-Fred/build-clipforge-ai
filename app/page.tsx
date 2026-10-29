import ClipforgeDashboard from '@/components/clipforge-dashboard'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function Page() {
  const session = await getSession()
  if (!session?.user) redirect('/sign-in')
  return <ClipforgeDashboard user={session.user} />
}
