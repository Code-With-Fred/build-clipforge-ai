import { and, eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { db } from "@/lib/db"
import { project } from "@/lib/db/schema"

const statuses = new Set(["uploaded", "processing", "ready", "failed"])

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => null)
  const status = typeof body?.status === "string" ? body.status : ""
  if (!statuses.has(status)) return NextResponse.json({ error: "Invalid project status." }, { status: 400 })

  const [updated] = await db.update(project).set({ status, updatedAt: new Date() }).where(and(eq(project.id, id), eq(project.userId, session.user.id))).returning()
  if (!updated) return NextResponse.json({ error: "Project not found." }, { status: 404 })
  return NextResponse.json({ project: updated })
}
