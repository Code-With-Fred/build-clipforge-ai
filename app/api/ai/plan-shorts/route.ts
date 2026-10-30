import { generateObject } from "ai"
import { z } from "zod"
import { NextResponse } from "next/server"

const planSchema = z.object({
  clips: z.array(z.object({
    start: z.number().min(0),
    title: z.string().min(1).max(80),
    reason: z.string().min(1).max(180),
  })).length(10),
})

export async function POST(request: Request) {
  const body = await request.json() as { command?: string; duration?: number; clipDuration?: number }
  const duration = Number(body.duration)
  const clipDuration = Math.min(Math.max(Number(body.clipDuration) || 60, 5), 60)
  const command = typeof body.command === "string" ? body.command.trim() : ""

  if (!Number.isFinite(duration) || duration <= 0 || !command) {
    return NextResponse.json({ error: "Provide a command and a valid video duration." }, { status: 400 })
  }

  const maxStart = Math.max(0, duration - clipDuration)
  try {
    const { object } = await generateObject({
      model: "anthropic/claude-sonnet-4.6",
      schema: planSchema,
      prompt: `You are planning ten short clips from one uploaded video. The video is ${duration.toFixed(1)} seconds long. Each clip must be exactly ${clipDuration} seconds or end at the video boundary. The user command is: ${command}

Choose ten distinct start times spread across the video. Without a transcript or visual analysis, do not claim specific events happened; use neutral titles and explain that the position follows the requested distribution. Return starts between 0 and ${maxStart.toFixed(1)} seconds, sorted ascending, with no duplicate starts.`,
    })
    const clips = object.clips
      .map((clip) => ({ ...clip, start: Math.min(maxStart, Math.max(0, Math.round(clip.start * 10) / 10)) }))
      .sort((a, b) => a.start - b.start)
    return NextResponse.json({ clips, clipDuration, mode: "ai" })
  } catch {
    const spacing = maxStart / 9
    const clips = Array.from({ length: 10 }, (_, index) => ({
      start: Math.round(index * spacing * 10) / 10,
      title: `Video section ${index + 1}`,
      reason: "Evenly distributed fallback position across the uploaded video.",
    }))
    return NextResponse.json({ clips, clipDuration, mode: "distributed" })
  }
}
