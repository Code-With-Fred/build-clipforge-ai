import { count, desc, eq } from 'drizzle-orm'
import ClipforgeDashboard from '@/components/clipforge-dashboard'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { ensureClipTable } from '@/lib/db/ensure'
import { clip, project } from '@/lib/db/schema'

export default async function Page() {
  const session = await getSession()
  if (session?.user) await ensureClipTable()
  const projects = session?.user
    ? await db.select().from(project).where(eq(project.userId, session.user.id)).orderBy(desc(project.updatedAt))
    : []
  const clipCounts = session?.user
    ? await db.select({ projectId: clip.projectId, total: count() }).from(clip).where(eq(clip.userId, session.user.id)).groupBy(clip.projectId)
    : []
  const clipsByProject = new Map(clipCounts.map((row) => [row.projectId, Number(row.total)]))

  const dashboardProjects = projects.map((item) => ({
    ...item,
    durationSeconds: item.duration,
    duration: item.duration ? `${Math.floor(item.duration / 60)}m ${item.duration % 60}s` : 'Duration pending',
    status: item.status,
    date: item.updatedAt.toLocaleDateString(),
    clips: clipsByProject.get(item.id) ?? 0,
    initial: item.name.slice(0, 2).toUpperCase(),
    gradient: 'from-violet-950 via-indigo-950 to-slate-950',
  }))

  return <ClipforgeDashboard projects={dashboardProjects} user={session?.user} />
}
