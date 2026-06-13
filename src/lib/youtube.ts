// --- YouTube Data API integration ---
type YouTubeApiVideoDetails = {
  viewCount: number | null;
  publishedAt: string | null;
};

async function fetchYouTubeApiVideoDetails(url: string): Promise<YouTubeApiVideoDetails | null> {
  try {
    const apiKey = process.env.YT_API_KEY?.trim();
    if (!apiKey) return null;

    // Extract video ID from URL
    const match = url.match(/[?&]v=([\w-]{11})/) || url.match(/youtu\.be\/([\w-]{11})/) || url.match(/youtube\.com\/shorts\/([\w-]{11})/);
    const videoId = match ? match[1] : null;
    if (!videoId) return null;

    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${apiKey}`;
    const response = await fetch(apiUrl);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.items || !data.items[0]) return null;
    const item = data.items[0];
    return {
      viewCount: item.statistics?.viewCount ? Number(item.statistics.viewCount) : null,
      publishedAt: item.snippet?.publishedAt ?? null,
    };
  } catch {
    return null;
  }
}
import { execFile, spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { promisify } from "node:util";
import YTDlpWrap from "yt-dlp-wrap";
import type { RequestedDownloadFormat, RequestedDownloadQuality } from "@/lib/video-links";

const execFileAsync = promisify(execFile);
const ytDlpBinaryPath =
  process.env.YT_DLP_BINARY_PATH ||
  resolve(tmpdir(), "z-cache", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const ytDlpCookiesPath =
  process.env.YT_DLP_COOKIE_FILE ||
  resolve(tmpdir(), "z-cache", "youtube-cookies.txt");
const ytDlpBrowserUserAgent =
  process.env.YT_DLP_USER_AGENT?.trim() ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

const ytDlpReleaseAssetName = (() => {
  if (process.platform === "win32") {
    return "yt-dlp.exe";
  }

  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "yt-dlp_macos" : "yt-dlp_macos";
  }

  if (process.platform === "linux") {
    if (process.arch === "arm64") {
      return "yt-dlp_linux_aarch64";
    }

    if (process.arch === "arm") {
      return "yt-dlp_linux_armv7l";
    }

    return "yt-dlp_linux";
  }

  return "yt-dlp";
})();

let ytDlpReady: Promise<string> | null = null;
let ytDlpCookiesReady: Promise<string | null> | null = null;

const hasConfiguredCookies = () => {
  return Boolean(
    process.env.YT_DLP_COOKIE_FILE?.trim() ||
      process.env.YT_DLP_COOKIES?.trim() ||
      process.env.YT_DLP_COOKIES_BASE64?.trim(),
  );
};

const isVercelRuntime = () => {
  return Boolean(process.env.VERCEL || process.env.VERCEL_URL);
};

const getYtDlpExtractorArgs = () => {
  const configuredExtractorArgs = process.env.YT_DLP_EXTRACTOR_ARGS?.trim();

  if (configuredExtractorArgs) {
    return configuredExtractorArgs;
  }

  return hasConfiguredCookies() ? "youtube:player_client=web,web_safari" : "youtube:player_client=android,web";
};

const normalizeCookieText = (value: string) => {
  return value.trim().replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
};

const looksLikeCookiesText = (value: string) => {
  return /#\s*Netscape HTTP Cookie File/i.test(value) || /(^|\n)\.?([a-z0-9-]+\.)?(youtube|google)\.com\t/i.test(value);
};

const decodeCookieEnvValue = (value: string) => {
  const normalized = normalizeCookieText(value)
    .replace(/^data:[^,]+;base64,/i, "")
    .replace(/^base64,/i, "");

  if (looksLikeCookiesText(normalized)) {
    return normalized;
  }

  const decoded = Buffer.from(normalized.replace(/\s+/g, ""), "base64").toString("utf8");

  if (looksLikeCookiesText(decoded)) {
    return normalizeCookieText(decoded);
  }

  throw new Error(
    "The configured `YT_DLP_COOKIES_BASE64` value does not look like a valid exported YouTube `cookies.txt` file.",
  );
};

type YouTubeMetadata = {
  title: string;
  authorName: string | null;
  durationLabel: string | null;
  viewCountLabel: string | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  estimatedSizeBytes: number | null;
  estimatedSizeLabel: string | null;
  downloadAvailable: boolean;
  warningMessage: string | null;
};

type DownloadContext = {
  stream: Readable;
  fileName: string;
  contentType: string;
  metadata: YouTubeMetadata;
};

type YtDlpJsonResponse = {
  title?: string;
  uploader?: string;
  duration?: number;
  view_count?: number;
  upload_date?: string;
  thumbnail?: string;
  filesize?: number;
  filesize_approx?: number;
};

const qualityCeilings: Record<RequestedDownloadQuality, number> = {
  "best": Infinity,
  "1080p": 1080,
  "720p": 720,
  "480p": 480,
};

const sanitizeFilename = (value: string) => {
  return value
    .replace(/[^a-zA-Z0-9._ -]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
};

const formatDuration = (totalSeconds?: number) => {
  if (!Number.isFinite(totalSeconds) || !totalSeconds || totalSeconds <= 0) {
    return null;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  }

  return [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
};

const formatViews = (views?: number) => {
  if (!Number.isFinite(views) || !views || views <= 0) {
    return null;
  }

  return `${new Intl.NumberFormat("en-US").format(views)} views`;
};

const formatSize = (bytes?: number) => {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;

  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const formatUploadDate = (rawDate?: string) => {
  if (!rawDate || rawDate.length !== 8) {
    return null;
  }

  return `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
};

const toMetadata = (info: YtDlpJsonResponse): YouTubeMetadata => {
  const estimatedSizeBytes = info.filesize ?? info.filesize_approx ?? null;

  return {
    title: info.title ?? "YouTube video",
    authorName: info.uploader ?? null,
    durationLabel: formatDuration(info.duration),
    viewCountLabel: formatViews(info.view_count),
    publishedAt: formatUploadDate(info.upload_date),
    thumbnailUrl: info.thumbnail ?? null,
    estimatedSizeBytes,
    estimatedSizeLabel: formatSize(estimatedSizeBytes ?? undefined),
    downloadAvailable: true,
    warningMessage: null,
  };
};

const getBotCheckMessage = () => {
  if (hasConfiguredCookies()) {
    if (isVercelRuntime()) {
      return "YouTube is still blocking the Vercel runtime for this video. Your cookies were loaded, but some downloads remain challenged on cloud/serverless IPs. Try a fresh `cookies.txt` export, a different region, or a self-hosted backend.";
    }

    return "This video still needs a valid signed-in YouTube session. Refresh your exported `cookies.txt`, update `YT_DLP_COOKIES_BASE64`, and try again.";
  }

  return "This video needs a signed-in YouTube session. Add `YT_DLP_COOKIES_BASE64` in Vercel or `.env.local` to unlock restricted downloads.";
};

const getInvalidCookiesMessage = () => {
  return "`YT_DLP_COOKIES_BASE64` is set, but it does not look like a valid exported YouTube `cookies.txt` file. Re-export the cookies, paste the base64 value, and redeploy.";
};

const getFormatUnavailableMessage = () => {
  return "The selected format or quality is not available for this video. Try `Best available` or a lower quality like 480p.";
};

const isBotChallengeError = (message: string) => {
  return /confirm you.?re not a bot|cookies-from-browser|cookies for the authentication|signed-in session/i.test(
    message,
  );
};

const isInvalidCookiesConfigError = (message: string) => {
  return /does not look like a valid exported YouTube `cookies\.txt` file/i.test(message);
};

const isFormatUnavailableError = (message: string) => {
  return /requested format is not available|selected format or quality is not available|no video formats found/i.test(
    message,
  );
};

const formatYtDlpError = (errorText: string) => {
  if (isInvalidCookiesConfigError(errorText)) {
    return getInvalidCookiesMessage();
  }

  if (isBotChallengeError(errorText)) {
    return getBotCheckMessage();
  }

  if (isFormatUnavailableError(errorText)) {
    return getFormatUnavailableMessage();
  }

  return errorText.trim() || "yt-dlp failed to fetch this YouTube video.";
};

async function ensureYtDlpCookiesFile() {
  if (!ytDlpCookiesReady) {
    ytDlpCookiesReady = (async () => {
      const configuredCookieFile = process.env.YT_DLP_COOKIE_FILE?.trim();

      if (configuredCookieFile) {
        return configuredCookieFile;
      }

      const inlineCookies = process.env.YT_DLP_COOKIES?.trim();
      const base64Cookies = process.env.YT_DLP_COOKIES_BASE64?.trim();

      if (!inlineCookies && !base64Cookies) {
        return null;
      }

      await mkdir(dirname(ytDlpCookiesPath), { recursive: true });

      const cookieText = inlineCookies ? normalizeCookieText(inlineCookies) : decodeCookieEnvValue(base64Cookies!);
      await writeFile(ytDlpCookiesPath, cookieText, "utf8");

      if (process.platform !== "win32") {
        await chmod(ytDlpCookiesPath, 0o600).catch(() => undefined);
      }

      return ytDlpCookiesPath;
    })();
  }

  return ytDlpCookiesReady;
}

async function fetchYouTubeOEmbedMetadata(
  url: string,
  options?: { downloadAvailable?: boolean; warningMessage?: string | null },
): Promise<YouTubeMetadata | null> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      {
        next: { revalidate: 3600 },
      },
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };

    return {
      title: data.title ?? "YouTube video",
      authorName: data.author_name ?? null,
      durationLabel: null,
      viewCountLabel: null,
      publishedAt: null,
      thumbnailUrl: data.thumbnail_url ?? null,
      estimatedSizeBytes: null,
      estimatedSizeLabel: null,
      downloadAvailable: options?.downloadAvailable ?? false,
      warningMessage: options?.warningMessage ?? getBotCheckMessage(),
    };
  } catch {
    return null;
  }
}

async function getYtDlpBaseArgs(options?: { includeExtractorArgs?: boolean }) {
  const args = ["--ignore-config", "--no-playlist", "--no-warnings", "--extractor-retries", "2"];
  const extractorArgs = getYtDlpExtractorArgs();

  if (options?.includeExtractorArgs !== false && extractorArgs) {
    args.push("--extractor-args", extractorArgs);
  }

  const cookiesFile = await ensureYtDlpCookiesFile();

  if (cookiesFile) {
    args.push(
      "--cookies",
      cookiesFile,
      "--user-agent",
      ytDlpBrowserUserAgent,
      "--add-header",
      "Accept-Language:en-US,en;q=0.9",
      "--add-header",
      "Origin:https://www.youtube.com",
      "--add-header",
      "Referer:https://www.youtube.com/",
    );
  }

  return args;
}

const getFormatSelector = (format: RequestedDownloadFormat, quality: RequestedDownloadQuality) => {
  const ceiling = qualityCeilings[quality];

  if (format === "mp3") {
    return "bestaudio[ext=m4a]/bestaudio";
  }

  if (quality === "best") {
    return "best[ext=mp4]/22/18/bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/best/b";
  }

  // Prefer combined format, then merge best video+audio (DASH sources like Reddit), then any single best
  return `best[ext=mp4][height<=${ceiling}]/22/18/best[height<=${ceiling}]/bv*[ext=mp4][height<=${ceiling}]+ba[ext=m4a]/bv*[height<=${ceiling}]+ba/best/b`;
};

async function ensureYtDlpBinary() {
  if (!ytDlpReady) {
    ytDlpReady = (async () => {
      try {
        await mkdir(dirname(ytDlpBinaryPath), { recursive: true });

        if (!existsSync(ytDlpBinaryPath)) {
          const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytDlpReleaseAssetName}`;
          await YTDlpWrap.downloadFile(downloadUrl, ytDlpBinaryPath);
        }

        if (process.platform !== "win32") {
          await chmod(ytDlpBinaryPath, 0o755).catch(() => undefined);
        }

        return ytDlpBinaryPath;
      } catch (error) {
        throw new Error(
          error instanceof Error
            ? `yt-dlp setup failed: ${error.message}`
            : "yt-dlp setup failed in the deployment environment.",
        );
      }
    })();
  }

  return ytDlpReady;
}

async function runYtDlpInfoQuery(url: string, includeExtractorArgs: boolean) {
  const binaryPath = await ensureYtDlpBinary();

  return execFileAsync(binaryPath, [...(await getYtDlpBaseArgs({ includeExtractorArgs })), "--dump-single-json", url], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function getYtDlpInfo(url: string): Promise<YtDlpJsonResponse> {
  try {
    const { stdout } = await runYtDlpInfoQuery(url, true);

    return JSON.parse(stdout) as YtDlpJsonResponse;
  } catch (error) {
    const stderr =
      typeof error === "object" && error && "stderr" in error ? String((error as { stderr?: string }).stderr ?? "") : "";
    const message = error instanceof Error ? error.message : "yt-dlp failed to fetch this YouTube video.";
    const fullMessage = [message, stderr].filter(Boolean).join("\n");

    if (getYtDlpExtractorArgs()) {
      try {
        const { stdout } = await runYtDlpInfoQuery(url, false);

        return JSON.parse(stdout) as YtDlpJsonResponse;
      } catch {
        // keep the original error below for the clearest message
      }
    }

    throw new Error(formatYtDlpError(fullMessage));
  }
}

export async function getYouTubeMetadata(url: string) {
  try {
    const info = await getYtDlpInfo(url);
    const metadata = toMetadata(info);

    // Try to fetch view count and published date from YouTube Data API if API key is set
    const apiDetails = await fetchYouTubeApiVideoDetails(url);
    if (apiDetails) {
      if (apiDetails.viewCount !== null) {
        metadata.viewCountLabel = formatViews(apiDetails.viewCount);
      }
      if (apiDetails.publishedAt) {
        // Convert ISO date to yyyy-mm-dd
        const d = new Date(apiDetails.publishedAt);
        metadata.publishedAt = !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : metadata.publishedAt;
      }
    }
    return metadata;
  } catch (error) {
    const message = error instanceof Error ? error.message : "yt-dlp failed to fetch this YouTube video.";

    if (isBotChallengeError(message) || isInvalidCookiesConfigError(message)) {
      const fallbackMetadata = await fetchYouTubeOEmbedMetadata(url, {
        downloadAvailable: false,
        warningMessage: isInvalidCookiesConfigError(message) ? getInvalidCookiesMessage() : getBotCheckMessage(),
      });

      if (fallbackMetadata) {
        return fallbackMetadata;
      }
    }

    if (isFormatUnavailableError(message)) {
      const fallbackMetadata = await fetchYouTubeOEmbedMetadata(url, {
        downloadAvailable: false,
        warningMessage: getFormatUnavailableMessage(),
      });

      if (fallbackMetadata) {
        return fallbackMetadata;
      }
    }

    throw error;
  }
}

export async function getYouTubeDirectMediaUrl({
  url,
  format,
  quality,
}: {
  url: string;
  format: RequestedDownloadFormat;
  quality: RequestedDownloadQuality;
}) {
  const binaryPath = await ensureYtDlpBinary();

  const resolveDirectUrl = async (includeExtractorArgs: boolean) => {
    const { stdout } = await execFileAsync(
      binaryPath,
      [...(await getYtDlpBaseArgs({ includeExtractorArgs })), "-g", "-f", getFormatSelector(format, quality), url],
      {
        maxBuffer: 1024 * 1024,
      },
    );

    return stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
  };

  try {
    let urls = await resolveDirectUrl(true);

    if (urls.length === 0 && getYtDlpExtractorArgs()) {
      urls = await resolveDirectUrl(false);
    }

    if (format === "mp3") {
      return urls[0] ?? null;
    }

    return urls.length === 1 ? urls[0] : null;
  } catch (error) {
    if (getYtDlpExtractorArgs()) {
      try {
        const urls = await resolveDirectUrl(false);

        if (format === "mp3") {
          return urls[0] ?? null;
        }

        return urls.length === 1 ? urls[0] : null;
      } catch {
        // keep the original error below for the clearest message
      }
    }

    const stderr =
      typeof error === "object" && error && "stderr" in error ? String((error as { stderr?: string }).stderr ?? "") : "";
    const message = error instanceof Error ? error.message : "yt-dlp failed to resolve a direct download URL.";
    throw new Error(formatYtDlpError([message, stderr].filter(Boolean).join("\n")));
  }
}

export async function getYouTubeDownloadContext({
  url,
  format,
  quality,
}: {
  url: string;
  format: RequestedDownloadFormat;
  quality: RequestedDownloadQuality;
}): Promise<DownloadContext> {
  const binaryPath = await ensureYtDlpBinary();
  const metadata = await getYouTubeMetadata(url);
  const args = [
    ...(await getYtDlpBaseArgs()),
    "--quiet",
    "-f",
    getFormatSelector(format, quality),
    "-o",
    "-",
    url,
  ];

  const child = spawn(binaryPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderrOutput = "";
  child.stderr?.on("data", (chunk) => {
    stderrOutput += chunk.toString();
    stderrOutput = stderrOutput.slice(-4000);
  });

  child.on("error", (error) => {
    child.stdout?.destroy(error);
  });

  child.on("close", (code) => {
    if (code && code !== 0) {
      child.stdout?.destroy(new Error(formatYtDlpError(stderrOutput.trim() || "yt-dlp failed to start the download.")));
    }
  });

  const baseName = sanitizeFilename(metadata.title || "video") || "video";
  const extension = format === "mp3" ? "m4a" : "mp4";
  const fileName = `${baseName}.${extension}`;
  const contentType = format === "mp3" ? "audio/mp4" : "video/mp4";

  return {
    stream: child.stdout as Readable,
    fileName,
    contentType,
    metadata,
  };
}

// ---------------------------------------------------------------------------
// Generic yt-dlp helpers for non-YouTube providers (TikTok, etc.)
// ---------------------------------------------------------------------------

type GenericVideoMetadata = {
  title: string;
  authorName: string | null;
  durationLabel: string | null;
  viewCountLabel: string | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  estimatedSizeBytes: number | null;
  estimatedSizeLabel: string | null;
  downloadAvailable: boolean;
  warningMessage: string | null;
};

type GenericDownloadContext = {
  stream: Readable;
  fileName: string;
  contentType: string;
  metadata: GenericVideoMetadata;
};

const toGenericMetadata = (info: YtDlpJsonResponse): GenericVideoMetadata => {
  const estimatedSizeBytes = info.filesize ?? info.filesize_approx ?? null;

  return {
    title: info.title ?? "Video",
    authorName: info.uploader ?? null,
    durationLabel: formatDuration(info.duration),
    viewCountLabel: formatViews(info.view_count),
    publishedAt: formatUploadDate(info.upload_date),
    thumbnailUrl: info.thumbnail ?? null,
    estimatedSizeBytes,
    estimatedSizeLabel: formatSize(estimatedSizeBytes ?? undefined),
    downloadAvailable: true,
    warningMessage: null,
  };
};

async function getGenericYtDlpBaseArgs() {

  const args = ["--ignore-config", "--no-playlist", "--no-warnings", "--extractor-retries", "3"];

  // Use provider-specific cookies when present, but do not force unrelated
  // cookie files for providers such as X/Twitter that can often work without them.
  const genericCookiesFile =
    process.env.YT_DLP_COOKIE_FILE?.trim() ||
    process.env.YT_DLP_COOKIES_FILE?.trim() ||
    process.env.INSTAGRAM_COOKIES_FILE?.trim() ||
    null;

  function getCookiesFileForUrl(url: string) {
    try {
      if (/facebook\.com/.test(url) && existsSync("./fb-cookies.txt")) {
        return "./fb-cookies.txt";
      }
      if (/reddit\.com/.test(url) && existsSync("./reddit-cookies.txt")) {
        return "./reddit-cookies.txt";
      }
      if (/pornhub\.com/.test(url) && existsSync("./ph-cookies.txt")) {
        return "./ph-cookies.txt";
      }
      if (/instagram\.com/.test(url) && existsSync("./instagram-cookies.txt")) {
        return "./instagram-cookies.txt";
      }
    } catch {}
    return genericCookiesFile && existsSync(genericCookiesFile) ? genericCookiesFile : null;
  }

  // Help yt-dlp find ffmpeg in common locations
  const ffmpegLocations = [
    process.env.FFMPEG_PATH,
    "/usr/local/bin",
    "/usr/bin",
    join(process.env.HOME || "", ".local", "bin"),
  ].filter(Boolean) as string[];

  for (const loc of ffmpegLocations) {
    const ffmpegPath = loc.endsWith("ffmpeg") ? loc : join(loc, "ffmpeg");
    if (existsSync(ffmpegPath)) {
      const dir = loc.endsWith("ffmpeg") ? dirname(ffmpegPath) : loc;
      args.push("--ffmpeg-location", dir);
      break;
    }
  }

  return { args, getCookiesFileForUrl };
}


async function getGenericYtDlpInfo(url: string): Promise<YtDlpJsonResponse> {
  const binaryPath = await ensureYtDlpBinary();
  const { args, getCookiesFileForUrl } = await getGenericYtDlpBaseArgs();
  const cookiesFile = getCookiesFileForUrl(url);
  const ytArgs = [...args, ...(cookiesFile ? ["--cookies", cookiesFile] : []), "--dump-single-json", url];


  try {
    const { stdout } = await execFileAsync(binaryPath, ytArgs, {
      maxBuffer: 10 * 1024 * 1024,
    });

    return JSON.parse(stdout) as YtDlpJsonResponse;
  } catch (error) {
    const stderr =
      typeof error === "object" && error && "stderr" in error ? String((error as { stderr?: string }).stderr ?? "") : "";
    const message = error instanceof Error ? error.message : "yt-dlp failed to fetch this video.";
    throw new Error([message, stderr].filter(Boolean).join("\n").trim() || "yt-dlp failed to fetch this video.");
  }
}

export async function getGenericMetadata(url: string): Promise<GenericVideoMetadata> {
  try {
    const info = await getGenericYtDlpInfo(url);
    return toGenericMetadata(info);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch video metadata.";
    throw new Error(message);
  }
}

export async function getGenericDirectMediaUrl({
  url,
  format,
  quality,
}: {
  url: string;
  format: RequestedDownloadFormat;
  quality: RequestedDownloadQuality;
}): Promise<string | null> {

  const binaryPath = await ensureYtDlpBinary();
  const { args } = await getGenericYtDlpBaseArgs();
  const ytArgs = [
    ...args,
    "-g",
    "-f",
    getFormatSelector(format, quality),
    url,
  ];

  try {
    const { stdout } = await execFileAsync(binaryPath, ytArgs, {
      maxBuffer: 1024 * 1024,
    });

    const urls = stdout.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);

    if (format === "mp3") {
      return urls[0] ?? null;
    }

    return urls.length === 1 ? urls[0] : null;
  } catch {
    return null;
  }
}


export async function getGenericDownloadContext({
  url,
  format,
  quality,
}: {
  url: string;
  format: RequestedDownloadFormat;
  quality: RequestedDownloadQuality;
}): Promise<GenericDownloadContext> {
  const binaryPath = await ensureYtDlpBinary();
  const metadata = await getGenericMetadata(url);
  const baseName = sanitizeFilename(metadata.title || "video") || "video";
  const extension = format === "mp3" ? "m4a" : "mp4";
  const fileName = `${baseName}.${extension}`;
  const contentType = format === "mp3" ? "audio/mp4" : "video/mp4";

  // Always use temp file download/merge for HLS/DASH (e.g., Pornhub)
  const tmpDir = join(tmpdir(), "z-downloads");
  await mkdir(tmpDir, { recursive: true });
  const tmpFile = join(tmpDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);

  const { args, getCookiesFileForUrl } = await getGenericYtDlpBaseArgs();
  const cookiesFile = getCookiesFileForUrl(url);
  const fileArgs = [
    ...args,
    ...(cookiesFile ? ["--cookies", cookiesFile] : []),
    "--quiet",
    "-f",
    getFormatSelector(format, quality),
    "--merge-output-format",
    "mp4",
    "-o",
    tmpFile,
    url,
  ];

  await new Promise<void>((resolve, reject) => {
    const dlChild = spawn(binaryPath, fileArgs, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderrOutput = "";
    dlChild.stderr?.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
      stderrOutput = stderrOutput.slice(-4000);
    });

    dlChild.on("error", reject);
    dlChild.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderrOutput.trim() || "yt-dlp download failed"));
    });
  });

  const fileStream = createReadStream(tmpFile);
  fileStream.on("end", () => unlink(tmpFile).catch(() => {}));
  fileStream.on("error", () => unlink(tmpFile).catch(() => {}));

  return { stream: fileStream as Readable, fileName, contentType, metadata };
}
