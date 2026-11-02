// Cloudinary storage management. The Free plan's storage/credit allowance fills up fast
// with hour-long sources, so once a project's shorts exist on their own we delete the
// big source video (and its audio track). "Delete project" removes everything.

import { and, eq } from 'drizzle-orm'
import { deleteResources, getCloudinaryConfig, saveRenderedClip, savedClipUrl } from '@/lib/cloudinary'
import { db } from '@/lib/db'
import { clip, project, upload } from '@/lib/db/schema'
import { OWNER_ID } from '@/lib/owner'

type ClipRow = typeof clip.$inferSelect

/** A clip still depends on a source if its delivery URL is a render of that source. */
export function dependsOnSource(url: string, sourcePublicIds: string[]) {
  return sourcePublicIds.some((id) => url.includes(`/${id.split('/').map(encodeURIComponent).join('/')}.`))
}

async function loadProject(projectId: string) {
  const owned = await db.query.project.findFirst({ where: and(eq(project.id, projectId), eq(project.userId, OWNER_ID)) })
  if (!owned) return null
  const uploads = await db.select().from(upload).where(eq(upload.projectId, projectId))
  const clips = await db.select().from(clip).where(eq(clip.projectId, projectId))
  return { owned, uploads, clips }
}

export async function storageSummary(projectId: string) {
  const uploads = await db.select({ size: upload.size }).from(upload).where(eq(upload.projectId, projectId))
  return { sourcesStored: uploads.length > 0, sourceBytes: uploads.reduce((total, row) => total + (row.size || 0), 0) }
}

/**
 * Delete the source video parts + audio for a finished project. Shorts that are still
 * rendered from the source (older projects, or plain fallbacks) are first saved as their
 * own assets, `saveBudget` per call, so their downloads keep working.
 */
export async function freeSourceStorage(projectId: string, saveBudget = 3): Promise<
  | { done: true; deletedFiles: number; freedBytes: number }
  | { done: false; reason: 'not-found' | 'not-configured' | 'still-rendering' | 'saving'; remaining?: number }
> {
  const config = getCloudinaryConfig()
  if (!config) return { done: false, reason: 'not-configured' }
  const loaded = await loadProject(projectId)
  if (!loaded) return { done: false, reason: 'not-found' }
  const { uploads, clips } = loaded
  if (!uploads.length) return { done: true, deletedFiles: 0, freedBytes: 0 }
  if (clips.some((item) => item.status !== 'ready')) return { done: false, reason: 'still-rendering' }

  const sourceIds = uploads.map((row) => row.pathname)
  const dependent = clips.filter((item) => dependsOnSource(item.url, sourceIds))
  for (const item of dependent.slice(0, saveBudget)) {
    const saved = await saveRenderedClip(config, item.url, `clipforge/shorts/${item.id}`)
    await db.update(clip).set({ url: savedClipUrl(config.cloudName, saved.public_id), updatedAt: new Date() }).where(eq(clip.id, item.id))
  }
  if (dependent.length > saveBudget) return { done: false, reason: 'saving', remaining: dependent.length - saveBudget }

  // Video parts and the audio track are both "video" resources in Cloudinary.
  const deletedFiles = await deleteResources(config, 'video', sourceIds)
  const freedBytes = uploads.reduce((total, row) => total + (row.size || 0), 0)
  await db.delete(upload).where(eq(upload.projectId, projectId))
  await db.update(project).set({ sourcePathname: null, updatedAt: new Date() }).where(eq(project.id, projectId))
  return { done: true, deletedFiles, freedBytes }
}

/** Remove a project completely: source, audio, saved shorts, caption files and DB rows. */
export async function deleteProject(projectId: string) {
  const config = getCloudinaryConfig()
  const loaded = await loadProject(projectId)
  if (!loaded) return { deleted: false as const }
  const { uploads, clips } = loaded
  if (config) {
    const legacySources = (loaded.owned.sourcePathname || '').split(',').filter(Boolean)
    const videoIds = [...new Set([...uploads.map((row) => row.pathname), ...legacySources, ...clips.map((item: ClipRow) => `clipforge/shorts/${item.id}`)])]
    await deleteResources(config, 'video', videoIds)
    await deleteResources(config, 'raw', clips.filter((item) => item.captions).map((item) => `clipforge/captions/${item.id}.srt`))
  }
  await db.delete(clip).where(eq(clip.projectId, projectId))
  await db.delete(upload).where(eq(upload.projectId, projectId))
  await db.delete(project).where(eq(project.id, projectId))
  return { deleted: true as const }
}
