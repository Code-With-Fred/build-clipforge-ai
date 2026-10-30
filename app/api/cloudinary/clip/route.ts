import { NextResponse } from "next/server"

const number = (value: FormDataEntryValue | null) => Number(value)

export async function POST(request: Request) {
  const formData = await request.formData()
  const publicId = formData.get("publicId")
  const start = number(formData.get("start"))
  const duration = number(formData.get("duration"))

  if (typeof publicId !== "string" || !publicId || !Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration <= 0 || duration > 300) {
    return NextResponse.json({ error: "Provide a valid video, start time, and duration up to five minutes." }, { status: 400 })
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  if (!cloudName) return NextResponse.json({ error: "Cloudinary is not configured." }, { status: 503 })

  const safePublicId = publicId.split("/").map(encodeURIComponent).join("/")
  const transformation = `so_${start},du_${duration},c_fill,ar_9:16,w_1080,h_1920,q_auto,f_mp4,vc_h264,ac_aac`
  const url = `https://res.cloudinary.com/${cloudName}/video/upload/${transformation}/${safePublicId}.mp4`
  const downloadUrl = `/api/cloudinary/download?publicId=${encodeURIComponent(publicId)}&start=${start}&duration=${duration}`
  return NextResponse.json({ url, downloadUrl, publicId, start, duration })
}
