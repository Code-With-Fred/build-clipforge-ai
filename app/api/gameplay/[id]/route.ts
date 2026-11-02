import { and, eq, ne } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { deleteResources, getCloudinaryConfig } from '@/lib/cloudinary'
import { db } from '@/lib/db'
import { ensureClipTable } from '@/lib/db/ensure'
import { clip, gameplay } from '@/lib/db/schema'
import { OWNER_ID } from '@/lib/owner'

export const runtime = 'nodejs'

/**
 * Remove a gameplay clip from the library and Cloudinary. Shorts already rendered keep
 * working (their renders are saved as their own files).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await ensureClipTable()
  const [row] = await db.select().from(gameplay).where(and(eq(gameplay.id, id), eq(gameplay.userId, OWNER_ID)))
  if (!row) return NextResponse.json({ error: 'Gameplay clip not found.' }, { status: 404 })
  const [busy] = await db.select({ id: clip.id }).from(clip).where(and(eq(clip.gameplayPublicId, row.publicId), ne(clip.status, 'ready'))).limit(1)
  if (busy) return NextResponse.json({ error: 'A short using this gameplay is still rendering. Delete it once rendering finishes.' }, { status: 409 })
  const config = getCloudinaryConfig()
  try {
    if (config) await deleteResources(config, 'video', [row.publicId])
  } catch (error) {
    return NextResponse.json({ error: `Could not delete from Cloudinary: ${error instanceof Error ? error.message : 'unknown error'}` }, { status: 502 })
  }
  await db.delete(gameplay).where(eq(gameplay.id, id))
  return NextResponse.json({ deleted: true })
}
