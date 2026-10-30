import { desc, eq } from 'drizzle-orm'
import ClipforgeDashboard from '@/components/clipforge-dashboard'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { project } from '@/lib/db/schema'

export default async function Page() {
  const session = await getSession()
  const projects = session?.user
    ? await db.select().from(project).where(eq(project.userId, session.user.id)).orderBy(desc(project.updatedAt))
    : []

  return <ClipforgeDashboard projects={projects} user={session?.user} />
}
