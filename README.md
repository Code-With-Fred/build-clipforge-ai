# ClipForge AI

Turn one long video (an hour or more) into 10–15 vertical YouTube Shorts.

## How it works

1. **Upload**: the browser uploads the video **directly to Cloudinary in 20 MB chunks**, so the file never passes through a Vercel function (those cap request bodies at 4.5 MB).
2. **Plan**: `POST /api/shorts` reads the real duration from Cloudinary and picks clip start times.
   - **With a transcript** (SRT, VTT or YouTube "Show transcript" text): the AI picks the strongest standalone moments and writes a title for each one.
   - **Without a transcript**: clips are spread evenly across the video. The model can't see or hear the video, so it doesn't guess.
3. **Render**: each clip is queued as a Cloudinary **eager async** job (signed `explicit` API call). Videos above Cloudinary's on-the-fly limit (40 MB on Free, 300 MB on paid plans) can only be cut this way.
4. **Track**: the editor polls `GET /api/shorts/:projectId`, which checks each clip's delivery URL. Clips are saved in the `clip` table, so you can close the tab and reopen the project from the dashboard.
5. **Download**: MP4s (1080×1920, H.264/AAC) download straight from Cloudinary's CDN, one at a time or with "Download all".

## Setup

Environment variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `CLOUDINARY_CLOUD_NAME` | Your cloud name |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Sign browser uploads and render jobs (secret stays server-side) |
| `CLOUDINARY_URL` | Optional: `cloudinary://key:secret@cloud` instead of the three variables above |
| `AI_GATEWAY_API_KEY` | Optional: Vercel AI Gateway, only used when `GROQ_API_KEY` is not set or `CLIPFORGE_AI_MODEL` is set (needs a card on file in Vercel) |
| `GROQ_API_KEY` | Recommended, **free** (no card): transcription with Whisper large-v3-turbo **and** AI moment picking, titles, hooks and descriptions with Groq's free chat models. Get one at console.groq.com |
| `CLIPFORGE_GROQ_MODEL` | Optional: pin a Groq chat model (default tries `openai/gpt-oss-120b`, then smaller fallbacks) |
| `OPENAI_API_KEY` | Paid alternative to Groq for transcription (~$0.36 per hour of video) |
| `CLIPFORGE_AI_MODEL` | Optional model override (default `anthropic/claude-sonnet-4.6`) |

No upload preset is needed: the server signs each browser upload with your API secret.

**Plan limits:** Cloudinary's Free plan has a small maximum video file size, so a full hour of HD video usually won't upload on it. Check "Max video file size" in your Cloudinary plan. If the upload is rejected, the app shows Cloudinary's exact error message.

The `clip` table is created automatically on first use (`lib/db/ensure.ts`).

```bash
pnpm install
pnpm dev
```

Open the app and click **New project**. There is no login: this is a single-user personal tool, so keep the URL private (anyone with it can use your Cloudinary credits).

## What each short gets

- 1080×1920 vertical MP4 (H.264/AAC), cut from the strongest moments
- Burned-in word-by-word captions (lower third, above the Shorts buttons)
- A hook line on screen for the first 3 seconds
- Its own title, description and hashtags, plus your source credit, with copy buttons
- A downloadable `.srt` captions file

Rendering pipeline per short: cut on the long video (eager) → saved as its own asset →
captions + hook (+ gameplay) burned on (eager) → ready. If finishing fails, the plain short is delivered.

## Look: split-screen + caption styles

In the editor's **Look** section:

- **Layout**: *Full vertical* (1080×1920) or *Split-screen + gameplay*. Split-screen puts your clip
  in the top half (1080×960) and a random stretch of a background clip from your **gameplay
  library** in the bottom half. Captions sit on the seam in the middle.
- **Gameplay library**: click **+ Add gameplay clip** to upload background footage (Minecraft
  parkour, Subway Surfers-style runs, satisfying loops...). Its audio is stripped in the browser
  before upload, so only your clip's speech is heard. Each clip must be at least the short's
  length + 1 second and under your Cloudinary upload limit (100 MB on Free). Clips rotate across
  shorts, each from a random start. Only use footage you recorded or that is licensed for reuse.
  Library clips live in `clipforge/gameplay/` and are kept when projects are deleted.
- **Caption style**: Classic, Yellow pop, Big & bold, Black on white or Small & subtle;
  **position** lower third or middle (split-screen is always middle).

## Storage (Cloudinary Free plan)

Every short is saved as its own small asset, so once all shorts of a project are ready the
big source video and its audio track are **deleted automatically** (downloads keep working).
Older projects have a **Free up space** button in the editor. **Delete** removes a project,
its shorts and every Cloudinary file it created: download what you need first.

Only clip videos you own or have permission to use: clips of other people's content get
Content ID claims and copyright strikes no matter how they are edited.

## Getting a transcript

Automatic when `GROQ_API_KEY` (free) or `OPENAI_API_KEY` is set. Otherwise paste one:


- YouTube Studio → Subtitles → your video → ⋮ → Download `.srt`
- Or, on a YouTube watch page, open "Show transcript", select everything and paste it.
