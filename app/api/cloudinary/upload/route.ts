import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { project, upload } from "@/lib/db/schema"
import { headers } from "next/headers"

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024
const VIDEO_TYPES = /^(video\/(mp4|quicktime|webm|x-matroska|x-msvideo|mpeg)|application\/octet-stream)$/i

export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get("file")
  const sourceUrl = formData.get("url")
  const videoFile = file instanceof File ? file : null
  const isRemoteSource = typeof sourceUrl === "string" && sourceUrl.length > 0

  if (!isRemoteSource && !videoFile) {
    return NextResponse.json({ error: "Choose a video file or provide a direct video URL." }, { status: 400 })
  }
  if (isRemoteSource) {
    try {
      const parsed = new URL(sourceUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
    } catch {
      return NextResponse.json({ error: "Enter a valid direct video URL." }, { status: 400 })
    }
  }
  if (videoFile && (videoFile.size === 0 || videoFile.size > MAX_FILE_SIZE)) {
    return NextResponse.json({ error: "Video must be smaller than 2 GB." }, { status: 413 })
  }
  if (videoFile && !VIDEO_TYPES.test(videoFile.type) && !/\.(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg)$/i.test(videoFile.name)) {
    return NextResponse.json({ error: "Unsupported video format." }, { status: 415 })
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET
  if (!cloudName || !uploadPreset) {
    return NextResponse.json({ error: "Cloudinary is not configured." }, { status: 503 })
  }

  const cloudinaryForm = new FormData()
  cloudinaryForm.append("file", isRemoteSource ? sourceUrl : videoFile!)
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
    const [createdProject] = await db.insert(project).values({
      id: crypto.randomUUID(),
      userId: session.user.id,
      name: isRemoteSource ? 'Remote video' : videoFile?.name.replace(/\.[^.]+$/, "") || 'Uploaded video',
      status: "uploaded",
      duration: Math.round(result.duration ?? 0),
      sourcePathname: result.public_id,
    }).returning({ id: project.id })
    projectId = createdProject.id
    await db.insert(upload).values({
      id: crypto.randomUUID(),
      projectId,
      userId: session.user.id,
      pathname: result.public_id,
      filename: isRemoteSource ? sourceUrl : videoFile?.name || 'uploaded-video',
      contentType: videoFile?.type || "video/mp4",
      size: videoFile?.size || 0,
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
