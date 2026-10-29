import { put } from '@vercel/blob'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { upload } from '@/lib/db/schema'

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024
const allowedTypes = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'])

export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file')
  const projectId = formData.get('projectId')
  if (!(file instanceof File)) return NextResponse.json({ error: 'A video file is required.' }, { status: 400 })
  if (!allowedTypes.has(file.type)) return NextResponse.json({ error: 'Unsupported video type.' }, { status: 415 })
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'Video must be smaller than 2 GB.' }, { status: 413 })

  const pathname = `users/${session.user.id}/uploads/${randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const blob = await put(pathname, file, { access: 'private', addRandomSuffix: false })
  const record = {
    id: randomUUID(),
    userId: session.user.id,
    projectId: typeof projectId === 'string' ? projectId : null,
    pathname: blob.pathname,
    filename: file.name,
    contentType: file.type,
    size: file.size,
  }
  await db.insert(upload).values(record)
  return NextResponse.json({ id: record.id, pathname: record.pathname, filename: record.filename }, { status: 201 })
}
