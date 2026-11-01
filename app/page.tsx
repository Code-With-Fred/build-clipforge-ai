import { count, desc, eq } from 'drizzle-orm'
import ClipforgeDashboard from '@/components/clipforge-dashboard'
import { db } from '@/lib/db'
import { ensureClipTable } from '@/lib/db/ensure'
import { clip, project } from '@/lib/db/schema'
import { OWNER_ID } from '@/lib/owner'

export const dynamic = 'force-dynamic'

export default async function Page() {
  await ensureClipTable()
  const projects = await db.select().from(project).where(eq(project.userId, OWNER_ID)).orderBy(desc(project.updatedAt))
  const clipCounts = await db.select({ projectId: clip.projectId, total: count() }).from(clip).where(eq(clip.userId, OWNER_ID)).groupBy(clip.projectId)
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

  return <ClipforgeDashboard projects={dashboardProjects} />
}
