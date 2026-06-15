# ZVYX: The Open Video & Music Downloader

ZVYX is a modern, privacy-focused web app for downloading and managing videos and music from YouTube and other platforms. It features a fast, user-friendly interface, robust authentication, and a secure backend for handling downloads. ZVYX is designed for self-hosting or deployment on Vercel, with a flexible API that can run standalone or integrated with the Next.js frontend.

## Features

- Download YouTube videos and music with high reliability
- Support for age-gated and signed-in-only content (with cookies)
- Clean, mobile-friendly UI built with Next.js and Tailwind CSS
- Secure authentication (NextAuth, social logins)
- Download history, saved videos, and user profiles
- Multi-language support (i18n)
- Standalone API server for heavy download tasks
- Easy deployment to Vercel plus a Google Cloud Run download API

## Tech Stack

- **Frontend:** Next.js 15, React 19, Tailwind CSS, Radix UI, shadcn/ui
- **Backend/API:** Node.js, TypeScript, yt-dlp, custom download server
- **Authentication:** NextAuth.js (OAuth, social logins)
- **Database:** Supabase (for saved videos, download limits)
- **Other:** Docker, ESLint, pnpm, Vercel, Google Cloud Run, IPFS

---

## Local IPFS Video Archive

When a user completes a download, the browser uploads the finished file to `/api/videos`. If `VIDEO_ARCHIVE_SERVER_URL` is configured, that API route also forwards the file to a local archive receiver, which pins the video through an IPFS node.

1. Run an IPFS node on the local archive machine and keep the HTTP API available, usually on `127.0.0.1:5001`.

2. Configure the archive receiver on the local machine:

```bash
IPFS_ARCHIVE_HOST=0.0.0.0
IPFS_ARCHIVE_PORT=3000
IPFS_API_URL=http://127.0.0.1:5001
IPFS_GATEWAY_URL=https://ipfs.io/ipfs
IPFS_ARCHIVE_ALLOW_ORIGIN=https://z-xyz.vercel.app,http://192.168.18.82:3000,http://localhost:3000
VIDEO_ARCHIVE_SHARED_SECRET=replace-with-a-long-random-secret
```

3. Start the receiver:

```bash
pnpm dev:archive
```

The receiver listens on `http://192.168.18.82:3000/` when that machine owns the `192.168.18.82` LAN address. Health check:

```bash
curl http://192.168.18.82:3000/health
```

4. Configure the Next.js/Vercel app to forward completed download uploads:

```bash
VIDEO_ARCHIVE_SERVER_URL=http://192.168.18.82:3000
VIDEO_ARCHIVE_SHARED_SECRET=replace-with-the-same-secret
```

If the app is deployed on Vercel, `192.168.18.82` is a private LAN address and Vercel cannot reach it directly. Expose the archive receiver through a tunnel, VPN, reverse proxy, or public URL, then set `VIDEO_ARCHIVE_SERVER_URL` to that reachable URL.

## Local Download API

Yes, the Google Cloud Run download service can be replaced by a local server that runs the same download process. The standalone API in `server/download-server.ts` exposes the same `/api/download/inspect`, `/api/download/file`, and `/health` endpoints used by the Cloud Run container.

1. Install the runtime dependencies on the machine that will run downloads:

```bash
pnpm install
```

If you are not using the bundled/local `yt-dlp` binary, install `yt-dlp` and `ffmpeg` on the server and set `YT_DLP_BINARY_PATH` when needed.

2. Configure the Next.js app and local API with the same shared secret:

```bash
DOWNLOAD_API_BASE_URL=http://127.0.0.1:3001
DOWNLOAD_API_SHARED_SECRET=replace-with-a-long-random-secret
DOWNLOAD_API_ALLOW_ORIGIN=http://localhost:3000
DOWNLOAD_API_HOST=127.0.0.1
DOWNLOAD_API_PORT=3001
```

Use the public app origin for `DOWNLOAD_API_ALLOW_ORIGIN` in production, for example `https://your-domain.com`.

3. Run the two processes:

```bash
pnpm dev:web
pnpm dev:api
```

For production, run the built Next.js app with `pnpm start` and the local download API with `pnpm start:api` under a process manager such as systemd, PM2, Docker, or your hosting platform's supervisor.

4. Confirm the local API is reachable:

```bash
curl http://127.0.0.1:3001/health
```

If the Next.js app runs on a different host than the download server, set `DOWNLOAD_API_BASE_URL` to the reachable internal URL, such as `http://download-api:3001` on a private Docker network or `https://downloads.your-domain.com` behind a reverse proxy.

## Google Cloud Run Download API

The Next.js app can stay on Vercel while heavy download work runs on Google Cloud Run. The Cloud Run service uses `Dockerfile.api` and exposes the existing `/api/download/inspect`, `/api/download/file`, and `/health` endpoints.

1. Install and authenticate the Google Cloud CLI:

```bash
gcloud auth login
gcloud auth application-default login
```

2. Create secrets for the API shared secret and optional yt-dlp cookies:

```bash
printf '%s' 'replace-with-a-long-random-secret' | gcloud secrets create download-api-shared-secret --data-file=-
printf '%s' "$YT_DLP_COOKIES_BASE64" | gcloud secrets create yt-dlp-cookies-base64 --data-file=-
```

3. Deploy the download API:

```bash
export GOOGLE_CLOUD_PROJECT=your-gcp-project-id
export REGION=us-east1
export DOWNLOAD_API_ALLOW_ORIGIN=https://your-vercel-app.vercel.app
export DOWNLOAD_API_SHARED_SECRET_SECRET=download-api-shared-secret
export YT_DLP_COOKIES_BASE64_SECRET=yt-dlp-cookies-base64
pnpm deploy:download-api:gcp
```

4. Set these environment variables on the Next.js/Vercel app:

```bash
DOWNLOAD_API_BASE_URL=https://your-cloud-run-service-url
DOWNLOAD_API_SHARED_SECRET=replace-with-the-same-secret
```

`DOWNLOAD_API_ALLOW_ORIGIN` should match the public frontend origin. Leave `MIN_INSTANCES=1` for faster first downloads, or set `MIN_INSTANCES=0` before deploy to reduce idle cost.
