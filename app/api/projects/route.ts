import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { project } from '@/lib/db/schema'

export async function GET() {
  const session = await getSession()
  if (!session?.user) return NextResponse.json({ projects: [] })

  const projects = await db
    .select()
    .from(project)
    .where(eq(project.userId, session.user.id))
    .orderBy(desc(project.updatedAt))

  return NextResponse.json({ projects })
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : ''
  if (!name) return NextResponse.json({ error: 'Project name is required.' }, { status: 400 })

  const record = {
    id: randomUUID(),
    userId: session.user.id,
    name,
    status: 'draft',
    duration: 0,
  }

  await db.insert(project).values(record)
  return NextResponse.json({ project: record }, { status: 201 })
}
