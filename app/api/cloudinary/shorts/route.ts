import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const body = await request.json() as { publicId?: string; clips?: Array<{ start: number; title?: string; reason?: string }>; clipDuration?: number; grayscale?: boolean }
  const publicId = body.publicId
  const clips = Array.isArray(body.clips) ? body.clips : []
  const clipDuration = Number(body.clipDuration)
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME

  if (!cloudName || typeof publicId !== "string" || !publicId || clips.length !== 10 || !Number.isFinite(clipDuration)) {
    return NextResponse.json({ error: "Provide one uploaded video and exactly ten clip positions." }, { status: 400 })
  }

  const safePublicId = publicId.split("/").map(encodeURIComponent).join("/")
  const effect = body.grayscale ? ",e_grayscale" : ""
  const transformation = clips.map((clip, index) => {
    const start = Math.max(0, Number(clip.start) || 0)
    const url = `https://res.cloudinary.com/${cloudName}/video/upload/so_${start},du_${clipDuration},c_fill,ar_9:16,w_1080,h_1920,q_auto,f_mp4${effect}/${safePublicId}.mp4`
    return { ...clip, index: index + 1, url }
  })

  return NextResponse.json({ clips: transformation })
}
