import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const publicId = searchParams.get("publicId")
  const start = Number(searchParams.get("start"))
  const duration = Number(searchParams.get("duration"))
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME

  if (!cloudName || !publicId || !Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration <= 0 || duration > 300) {
    return NextResponse.json({ error: "Invalid clip download request." }, { status: 400 })
  }

  const safePublicId = publicId.split("/").map(encodeURIComponent).join("/")
  const transformation = `so_${start},du_${duration},c_fill,ar_9:16,w_1080,h_1920,q_auto,f_mp4,vc_h264,ac_aac`
  const source = `https://res.cloudinary.com/${cloudName}/video/upload/${transformation}/${safePublicId}.mp4`
  let response = await fetch(source)
  for (let attempt = 1; attempt < 4 && !response.ok; attempt += 1) {
    if (![420, 423, 500, 502, 503].includes(response.status)) break
    await new Promise((resolve) => setTimeout(resolve, attempt * 1500))
    response = await fetch(source)
  }

  if (!response.ok) return NextResponse.json({ error: "Cloudinary could not generate this clip yet. Please retry the download." }, { status: 502 })

  return new NextResponse(await response.arrayBuffer(), {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": "attachment; filename=clipforge-clip.mp4",
      "Cache-Control": "private, max-age=3600",
    },
  })
}
