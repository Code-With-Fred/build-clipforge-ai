import { and, eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { project } from "@/lib/db/schema"
import { OWNER_ID } from '@/lib/owner'

const statuses = new Set(["uploaded", "processing", "ready", "failed"])

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => null)
  const status = typeof body?.status === "string" ? body.status : ""
  if (!statuses.has(status)) return NextResponse.json({ error: "Invalid project status." }, { status: 400 })

  const [updated] = await db.update(project).set({ status, updatedAt: new Date() }).where(and(eq(project.id, id), eq(project.userId, OWNER_ID))).returning()
  if (!updated) return NextResponse.json({ error: "Project not found." }, { status: 404 })
  return NextResponse.json({ project: updated })
}
