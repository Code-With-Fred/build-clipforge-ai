import { NextResponse } from 'next/server'
import { getCloudinaryConfig, MISSING_CONFIG_MESSAGE, signedUploadParams } from '@/lib/cloudinary'

export const dynamic = 'force-dynamic'

/** Fresh signed upload parameters for a direct browser → Cloudinary chunked upload. */
export async function GET() {
  const config = getCloudinaryConfig()
  if (!config) return NextResponse.json({ error: MISSING_CONFIG_MESSAGE }, { status: 503 })
  return NextResponse.json(
    { cloudName: config.cloudName, ...signedUploadParams(config) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
