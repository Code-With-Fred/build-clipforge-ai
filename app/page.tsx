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

  const dashboardProjects = projects.map((item) => ({
    ...item,
    duration: item.duration ? `${Math.floor(item.duration / 60)}m ${item.duration % 60}s` : 'Duration pending',
    status: item.status,
    date: item.updatedAt.toLocaleDateString(),
    clips: 0,
    initial: item.name.slice(0, 2).toUpperCase(),
    gradient: 'from-violet-950 via-indigo-950 to-slate-950',
  }))

  return <ClipforgeDashboard projects={dashboardProjects} user={session?.user} />
}
