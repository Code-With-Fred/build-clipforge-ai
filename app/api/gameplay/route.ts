import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCloudinaryConfig, getVideoResource, MISSING_CONFIG_MESSAGE, UPLOAD_FOLDERS } from '@/lib/cloudinary'
import { db } from '@/lib/db'
import { ensureClipTable } from '@/lib/db/ensure'
import { gameplay } from '@/lib/db/schema'
import { OWNER_ID } from '@/lib/owner'

export const runtime = 'nodejs'

export async function GET() {
  await ensureClipTable()
  const items = await db.select().from(gameplay).where(eq(gameplay.userId, OWNER_ID)).orderBy(desc(gameplay.createdAt))
  return NextResponse.json({ gameplay: items })
}

const registerSchema = z.object({
  publicId: z.string().min(1).max(500).refine((id) => id.startsWith(`${UPLOAD_FOLDERS.gameplay}/`), 'Not a gameplay upload.'),
  name: z.string().trim().min(1).max(200),
  bytes: z.number().int().nonnegative().optional(),
  duration: z.number().positive().optional(),
})

/** Register a gameplay clip the browser just uploaded (audio already stripped). */
export async function POST(request: Request) {
  const config = getCloudinaryConfig()
  if (!config) return NextResponse.json({ error: MISSING_CONFIG_MESSAGE }, { status: 503 })
  const parsed = registerSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid gameplay upload.' }, { status: 400 })
  const input = parsed.data

  let duration: number
  try {
    duration = (await getVideoResource(config, input.publicId)).duration ?? Number(input.duration)
  } catch (error) {
    return NextResponse.json({ error: `Could not read the gameplay video: ${error instanceof Error ? error.message : 'unknown error'}` }, { status: 502 })
  }
  if (!Number.isFinite(duration) || duration <= 0) return NextResponse.json({ error: 'Cloudinary did not report the gameplay length yet. Try again.' }, { status: 409 })

  await ensureClipTable()
  const row = { id: randomUUID(), userId: OWNER_ID, publicId: input.publicId, name: input.name, duration: Math.floor(duration), size: Math.min(input.bytes ?? 0, 2_147_483_647) }
  await db.insert(gameplay).values(row)
  return NextResponse.json({ gameplay: row }, { status: 201 })
}
