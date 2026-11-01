import { createHash } from 'node:crypto'
import type { CropMode } from '@/lib/shorts'

type CloudinaryConfig = {
  cloudName: string
  apiKey: string
  apiSecret: string
  uploadPreset?: string
}

/** Reads CLOUDINARY_URL (cloudinary://key:secret@cloud) or the individual variables. */
export function getCloudinaryConfig(): CloudinaryConfig | null {
  let cloudName = process.env.CLOUDINARY_CLOUD_NAME
  let apiKey = process.env.CLOUDINARY_API_KEY
  let apiSecret = process.env.CLOUDINARY_API_SECRET
  if (process.env.CLOUDINARY_URL) {
    try {
      const parsed = new URL(process.env.CLOUDINARY_URL)
      cloudName ||= parsed.hostname
      apiKey ||= decodeURIComponent(parsed.username)
      apiSecret ||= decodeURIComponent(parsed.password)
    } catch {
      // Fall through to the missing-config check.
    }
  }
  if (!cloudName || !apiKey || !apiSecret) return null
  return { cloudName, apiKey, apiSecret, uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET }
}

export const MISSING_CONFIG_MESSAGE =
  'Cloudinary is not fully configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET and CLOUDINARY_UPLOAD_PRESET (or CLOUDINARY_URL).'

/**
 * One canonical transformation per clip. The eager job and the delivery URL MUST use
 * this exact string, otherwise Cloudinary tries an on-the-fly transform, which fails
 * for sources above its sync limit (40 MB free / 300 MB paid) — i.e. every long video.
 */
export function clipTransformation(options: { start: number; duration: number; crop: CropMode; grayscale: boolean }) {
  const trim = `so_${Math.max(0, Math.round(options.start))},du_${Math.round(options.duration)}`
  const frame = options.crop === 'blur'
    ? 'b_blurred:400:15,c_pad,h_1920,w_1080'
    : `c_fill,g_${options.crop === 'smart' ? 'auto' : 'center'},h_1920,w_1080`
  const encode = `q_auto,vc_h264,ac_aac${options.grayscale ? ',e_grayscale' : ''}`
  return `${trim}/${frame}/${encode}`
}

function encodePublicId(publicId: string) {
  return publicId.split('/').map(encodeURIComponent).join('/')
}

export function clipUrl(cloudName: string, publicId: string, transformation: string) {
  return `https://res.cloudinary.com/${cloudName}/video/upload/${transformation}/${encodePublicId(publicId)}.mp4`
}

function sign(params: Record<string, string>, apiSecret: string) {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
  return createHash('sha1').update(payload + apiSecret).digest('hex')
}

async function cloudinaryError(response: Response) {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null
  return body?.error?.message || `Cloudinary responded with ${response.status}`
}

/** Admin API lookup; confirms the asset exists and gives the authoritative duration. */
export async function getVideoResource(config: CloudinaryConfig, publicId: string) {
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/resources/video/upload/${encodePublicId(publicId)}`,
    {
      headers: { Authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64')}` },
      cache: 'no-store',
    },
  )
  if (!response.ok) throw new Error(await cloudinaryError(response))
  return await response.json() as { public_id: string; duration?: number; bytes?: number; width?: number; height?: number }
}

/**
 * Queue background (eager async) renders for every clip. Sent in small batches so a
 * single oversized request can't fail the whole set.
 */
export async function queueClipRenders(config: CloudinaryConfig, publicId: string, transformations: string[]) {
  const batchSize = 5
  for (let offset = 0; offset < transformations.length; offset += batchSize) {
    const batch = transformations.slice(offset, offset + batchSize)
    const params: Record<string, string> = {
      eager: batch.map((transformation) => `${transformation}/mp4`).join('|'),
      eager_async: 'true',
      public_id: publicId,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'upload',
    }
    const body = new URLSearchParams({ ...params, api_key: config.apiKey, signature: sign(params, config.apiSecret) })
    const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/video/explicit`, { method: 'POST', body })
    if (!response.ok) throw new Error(await cloudinaryError(response))
  }
}

/**
 * A clip is ready when its delivery URL answers 200. While the eager job is still
 * running, Cloudinary answers 4xx (typically 423, or 400 "too large to process synchronously").
 */
export async function checkClipReady(url: string): Promise<{ ready: boolean; detail?: string }> {
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    if (response.ok) return { ready: true }
    return { ready: false, detail: response.headers.get('x-cld-error') || `HTTP ${response.status}` }
  } catch (error) {
    return { ready: false, detail: error instanceof Error ? error.message : 'Network error' }
  }
}
