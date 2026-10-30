import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { projects, uploads } from "@/lib/db/schema"
import { headers } from "next/headers"

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024
const VIDEO_TYPES = /^(video\/(mp4|quicktime|webm|x-matroska|x-msvideo|mpeg)|application\/octet-stream)$/i

export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get("file")

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A video file is required." }, { status: 400 })
  }
  if (file.size === 0 || file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Video must be smaller than 2 GB." }, { status: 413 })
  }
  if (!VIDEO_TYPES.test(file.type) && !/\.(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg)$/i.test(file.name)) {
    return NextResponse.json({ error: "Unsupported video format." }, { status: 415 })
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET
  if (!cloudName || !uploadPreset) {
    return NextResponse.json({ error: "Cloudinary is not configured." }, { status: 503 })
  }

  const cloudinaryForm = new FormData()
  cloudinaryForm.append("file", file)
  cloudinaryForm.append("upload_preset", uploadPreset)
  cloudinaryForm.append("resource_type", "video")
  cloudinaryForm.append("folder", "clipforge/source")

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
    method: "POST",
    body: cloudinaryForm,
  })
  const result = await response.json()

  if (!response.ok) {
    console.error("[v0] Cloudinary upload failed", result)
    return NextResponse.json({ error: "Video upload failed." }, { status: 502 })
  }

  const session = await auth.api.getSession({ headers: await headers() })
  let projectId: string | undefined
  if (session?.user?.id) {
    const [project] = await db.insert(projects).values({
      id: crypto.randomUUID(),
      userId: session.user.id,
      name: file.name.replace(/\.[^.]+$/, ""),
      status: "uploaded",
    }).returning({ id: projects.id })
    projectId = project.id
    await db.insert(uploads).values({
      id: crypto.randomUUID(),
      projectId,
      userId: session.user.id,
      pathname: result.public_id,
      filename: file.name,
      mimeType: file.type || "video/mp4",
      sizeBytes: file.size,
      status: "ready",
    })
  }

  return NextResponse.json({
    projectId,
    publicId: result.public_id,
    url: result.secure_url,
    duration: result.duration,
    width: result.width,
    height: result.height,
  })
}
