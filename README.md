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
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Used to sign render jobs (server only) |
| `CLOUDINARY_UPLOAD_PRESET` | An **unsigned** upload preset for browser uploads |
| `CLOUDINARY_URL` | Optional: `cloudinary://key:secret@cloud` instead of the three variables above |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway (automatic on Vercel through OIDC) |
| `CLIPFORGE_AI_MODEL` | Optional model override (default `anthropic/claude-sonnet-4.6`) |

Cloudinary preset: Settings → Upload → Upload presets → Add → Signing mode **Unsigned**. Leave incoming transformations empty.

**Plan limits:** Cloudinary's Free plan has a small maximum video file size, so a full hour of HD video usually won't upload on it. Check "Max video file size" in your Cloudinary plan. If the upload is rejected, the app shows Cloudinary's exact error message.

The `clip` table is created automatically on first use (`lib/db/ensure.ts`).

```bash
pnpm install
pnpm dev
```

Open the app and click **New project**. There is no login: this is a single-user personal tool, so keep the URL private (anyone with it can use your Cloudinary credits).

## Getting a transcript

- YouTube Studio → Subtitles → your video → ⋮ → Download `.srt`
- Or, on a YouTube watch page, open "Show transcript", select everything and paste it.
