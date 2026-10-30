import { gateway, generateText } from 'ai'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : ''

    if (!transcript || transcript.length < 20) {
      return NextResponse.json({ error: 'Provide a transcript with at least 20 characters.' }, { status: 400 })
    }

    const result = await generateText({
      model: gateway('openai/o4-mini'),
      system:
        'You are a short-form video editor. Return concise, practical editing suggestions. Do not invent quotes that are not in the transcript.',
      prompt: `Analyze this transcript and identify the strongest short-form moments. Return JSON with a highlights array. Each highlight must include title, hook, startHint, endHint, reason, and caption. Keep captions under 120 characters.\n\nTranscript:\n${transcript.slice(0, 50000)}`,
    })

    let parsed: unknown
    try {
      parsed = JSON.parse(result.text)
    } catch {
      parsed = { highlights: [], raw: result.text }
    }

    return NextResponse.json(parsed)
  } catch (error) {
    console.error('Highlight generation failed:', error)
    return NextResponse.json({ error: 'Highlight generation failed.' }, { status: 500 })
  }
}
