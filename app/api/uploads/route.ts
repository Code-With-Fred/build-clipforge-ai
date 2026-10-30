import { put } from '@vercel/blob'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { project, upload } from '@/lib/db/schema'

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024
const allowedTypes = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'])

export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file')
  const requestedProjectId = formData.get('projectId')
  if (!(file instanceof File)) return NextResponse.json({ error: 'A video file is required.' }, { status: 400 })
  if (!allowedTypes.has(file.type)) return NextResponse.json({ error: 'Unsupported video type.' }, { status: 415 })
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'Video must be smaller than 2 GB.' }, { status: 413 })

  let projectId: string | null = null
  if (typeof requestedProjectId === 'string' && requestedProjectId) {
    const ownedProject = await db.query.project.findFirst({
      where: and(eq(project.id, requestedProjectId), eq(project.userId, session.user.id)),
      columns: { id: true },
    })
    if (!ownedProject) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    projectId = ownedProject.id
  } else {
    projectId = randomUUID()
    await db.insert(project).values({
      id: projectId,
      userId: session.user.id,
      name: file.name.replace(/\.[^/.]+$/, '').slice(0, 120) || 'Untitled video',
      status: 'uploaded',
      duration: 0,
    })
  }

  const pathname = `users/${session.user.id}/uploads/${randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const blob = await put(pathname, file, { access: 'private', addRandomSuffix: false })
  const record = {
    id: randomUUID(),
    userId: session.user.id,
    projectId,
    pathname: blob.pathname,
    filename: file.name,
    contentType: file.type,
    size: file.size,
  }
  await db.insert(upload).values(record)
  return NextResponse.json({ id: record.id, projectId, pathname: record.pathname, filename: record.filename }, { status: 201 })
}
