import { NextResponse } from 'next/server'
import { getCloudinaryConfig, MISSING_CONFIG_MESSAGE } from '@/lib/cloudinary'

/** Public upload settings for direct browser → Cloudinary chunked uploads. */
export async function GET() {
  const config = getCloudinaryConfig()
  if (!config?.uploadPreset) return NextResponse.json({ error: MISSING_CONFIG_MESSAGE }, { status: 503 })
  return NextResponse.json({ cloudName: config.cloudName, uploadPreset: config.uploadPreset })
}
