import { NextResponse } from 'next/server'
import { freeSourceStorage, storageSummary } from '@/lib/cleanup'
import { ensureClipTable } from '@/lib/db/ensure'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * Free Cloudinary space by deleting the source video + audio. Older projects first get
 * their shorts saved as standalone files (a few per call); the client repeats the call
 * until `done` is true.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  await ensureClipTable()
  try {
    const result = await freeSourceStorage(projectId, 3)
    if (!result.done && result.reason === 'not-found') return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    if (!result.done && result.reason === 'still-rendering') return NextResponse.json({ error: 'Wait until every short is ready.' }, { status: 409 })
    if (!result.done && result.reason === 'not-configured') return NextResponse.json({ error: 'Cloudinary is not configured.' }, { status: 503 })
    return NextResponse.json({ ...result, storage: await storageSummary(projectId) })
  } catch (error) {
    return NextResponse.json({ error: `Could not free storage: ${error instanceof Error ? error.message : 'unknown error'}` }, { status: 502 })
  }
}
