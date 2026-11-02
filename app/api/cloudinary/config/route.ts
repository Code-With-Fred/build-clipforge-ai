import { NextResponse } from 'next/server'
import { getCloudinaryConfig, MISSING_CONFIG_MESSAGE, signedUploadParams, UPLOAD_FOLDERS } from '@/lib/cloudinary'
import { transcriptionAvailable } from '@/lib/transcribe'

export const dynamic = 'force-dynamic'

/** Fresh signed upload parameters for a direct browser → Cloudinary chunked upload. */
export async function GET(request: Request) {
  // ?folder=gameplay signs uploads into the gameplay library; anything else is a source upload.
  const folder = new URL(request.url).searchParams.get('folder') === 'gameplay' ? UPLOAD_FOLDERS.gameplay : UPLOAD_FOLDERS.source
  const config = getCloudinaryConfig()
  if (!config) return NextResponse.json({ error: MISSING_CONFIG_MESSAGE }, { status: 503 })
  return NextResponse.json(
    { cloudName: config.cloudName, transcription: transcriptionAvailable(), ...signedUploadParams(config, folder) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
