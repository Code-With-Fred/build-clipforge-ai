import { NextResponse } from "next/server"

export function GET() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET
  if (!cloudName || !uploadPreset) return NextResponse.json({ error: "Cloudinary is not configured." }, { status: 503 })
  return NextResponse.json({ cloudName, uploadPreset })
}
