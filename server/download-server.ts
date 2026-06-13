import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { verifyDownloadSignature } from "../src/lib/download-signature";
import { getGenericDirectMediaUrl, getGenericDownloadContext, getGenericMetadata, getYouTubeDirectMediaUrl, getYouTubeDownloadContext, getYouTubeMetadata } from "../src/lib/youtube";
import {
  isRequestedDownloadFormat,
  isRequestedDownloadQuality,
  recognizeVideoUrl,
} from "../src/lib/video-links";

const loadEnvFromFile = (filePath: string) => {
  if (!existsSync(filePath)) {
    return;
  }

  const fileText = readFileSync(filePath, "utf8");

  for (const rawLine of fileText.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = rawLine.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = rawLine.slice(0, equalsIndex).trim();
    let value = rawLine.slice(equalsIndex + 1).trim();

    if (!key) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] ??= value;
  }
};

loadEnvFromFile(".env");
loadEnvFromFile(".env.local");

const port = Number.parseInt(process.env.DOWNLOAD_API_PORT ?? process.env.PORT ?? "3001", 10);
const host = process.env.DOWNLOAD_API_HOST?.trim() || "127.0.0.1";
const sharedSecret = process.env.DOWNLOAD_API_SHARED_SECRET?.trim();
const configuredAllowedOrigins =
  process.env.DOWNLOAD_API_ALLOW_ORIGIN
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? ["*"];
const allowedOrigin = configuredAllowedOrigins[0] ?? "*";

const isOriginAllowed = (origin?: string | null) => {
  if (!origin) {
    return true;
  }

  return configuredAllowedOrigins.includes("*") || configuredAllowedOrigins.includes(origin);
};

const hasValidSignedDownload = (requestUrl: URL) => {
  if (!sharedSecret || requestUrl.pathname !== "/api/download/file") {
    return false;
  }

  const rawUrl = requestUrl.searchParams.get("url");
  const requestedFormat = requestUrl.searchParams.get("format");
  const requestedQuality = requestUrl.searchParams.get("quality");
  const signature = requestUrl.searchParams.get("dl_sig")?.trim() ?? "";
  const expiresAt = Number(requestUrl.searchParams.get("dl_exp") ?? 0);

  if (
    !rawUrl ||
    !Number.isFinite(expiresAt) ||
    !isRequestedDownloadFormat(requestedFormat) ||
    !isRequestedDownloadQuality(requestedQuality)
  ) {
    return false;
  }

  return verifyDownloadSignature(
    {
      url: rawUrl,
      format: requestedFormat,
      quality: requestedQuality,
      expiresAt,
    },
    sharedSecret,
    signature,
  );
};

const isRequestAuthorized = (request: IncomingMessage, requestUrl: URL) => {
  if (!sharedSecret) {
    return true;
  }

  const headerSecret = request.headers["x-download-api-secret"];
  const normalizedHeaderSecret = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;
  const authHeader = request.headers.authorization?.trim();

  return (
    normalizedHeaderSecret === sharedSecret ||
    authHeader === `Bearer ${sharedSecret}` ||
    hasValidSignedDownload(requestUrl)
  );
};

const setCorsHeaders = (response: ServerResponse, requestOrigin?: string | null) => {
  const corsOrigin =
    requestOrigin && isOriginAllowed(requestOrigin)
      ? requestOrigin
      : configuredAllowedOrigins.includes("*")
        ? "*"
        : allowedOrigin;

  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Origin", corsOrigin);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Download-Api-Secret");
  response.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Disposition,Content-Length,Content-Range,Accept-Ranges,Content-Type,X-File-Name,X-Estimated-Size",
  );
};

const sendJson = (response: ServerResponse, status: number, payload: unknown, requestOrigin?: string | null) => {
  setCorsHeaders(response, requestOrigin);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
};

const rejectDisallowedBrowserOrigin = (request: IncomingMessage, response: ServerResponse) => {
  const requestOrigin = request.headers.origin?.trim();

  if (!requestOrigin || isOriginAllowed(requestOrigin)) {
    return false;
  }

  sendJson(
    response,
    403,
    {
      error: `Browser requests are restricted to: ${configuredAllowedOrigins.join(", ")}.`,
    },
    requestOrigin,
  );
  return true;
};

const rejectUnauthorizedRequest = (request: IncomingMessage, requestUrl: URL, response: ServerResponse) => {
  if (isRequestAuthorized(request, requestUrl)) {
    return false;
  }

  sendJson(
    response,
    401,
    {
      error: "This download API requires a valid server secret.",
    },
    request.headers.origin?.trim(),
  );
  return true;
};

const checkExistingServerHealth = async () => {
  try {
    const response = await fetch(`http://${host}:${port}/health`, {
      signal: AbortSignal.timeout(1_000),
    });

    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as { service?: string };
    return data.service === "download-api";
  } catch {
    return false;
  }
};

const readJsonBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return null;
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(rawBody) as { url?: string; format?: string; quality?: string };
};

const handleInspect = async (request: IncomingMessage, response: ServerResponse) => {
  const requestOrigin = request.headers.origin?.trim();
  const body = (await readJsonBody(request).catch(() => null)) as {
    url?: string;
    format?: string;
    quality?: string;
  } | null;

  if (!body || typeof body.url !== "string") {
    return sendJson(
      response,
      400,
      {
        error: "Please provide a video URL.",
      },
      requestOrigin,
    );
  }

  const requestedFormat = isRequestedDownloadFormat(body.format) ? body.format : "mp4";
  const requestedQuality = isRequestedDownloadQuality(body.quality) ? body.quality : "1080p";
  const result = recognizeVideoUrl(body.url);

  if (!result.normalizedUrl && !result.recognized) {
    return sendJson(
      response,
      400,
      {
        ...result,
        error: result.message,
      },
      requestOrigin,
    );
  }

  if (result.recognized && result.canonicalUrl) {
    const providerLabels: Record<string, string> = { x: "X", tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", facebook: "Facebook", vimeo: "Vimeo", redgifs: "RedGifs", reddit: "Reddit" };
    try {
      const useGeneric = result.provider === "x" || result.provider === "tiktok" || result.provider === "instagram" || result.provider === "facebook" || result.provider === "vimeo" || result.provider === "redgifs" || result.provider === "reddit" || result.provider === "pornhub";
      const metadata = useGeneric
        ? await getGenericMetadata(result.canonicalUrl)
        : await getYouTubeMetadata(result.canonicalUrl);
      const downloadAvailable = metadata.downloadAvailable !== false;
      const downloadUrl = downloadAvailable
        ? `/api/download/file?${new URLSearchParams({
            url: result.canonicalUrl,
            format: requestedFormat,
            quality: requestedQuality,
          }).toString()}`
        : null;
      const providerLabel = providerLabels[result.provider ?? ""] ?? "Video";

      return sendJson(
        response,
        200,
        {
          ...result,
          ...metadata,
          requestedFormat,
          requestedQuality,
          downloadAvailable,
          downloadUrl,
          message: metadata.warningMessage ?? `${providerLabel} video recognized and ready to download.`,
        },
        requestOrigin,
      );
    } catch (error) {
      const providerLabel = providerLabels[result.provider ?? ""] ?? "video";

      return sendJson(
        response,
        502,
        {
          ...result,
          requestedFormat,
          requestedQuality,
          error:
            error instanceof Error
              ? error.message
              : `The ${providerLabel} link was recognized, but metadata could not be fetched right now.`,
        },
        requestOrigin,
      );
    }
  }

  return sendJson(
    response,
    200,
    {
      ...result,
      requestedFormat,
      requestedQuality,
    },
    requestOrigin,
  );
};

const handleDownload = async (request: IncomingMessage, requestUrl: URL, response: ServerResponse) => {
  const requestOrigin = request.headers.origin?.trim();
  const rawUrl = requestUrl.searchParams.get("url");
  const requestedFormat = requestUrl.searchParams.get("format");
  const requestedQuality = requestUrl.searchParams.get("quality");
  const mode = requestUrl.searchParams.get("mode");
  const format = isRequestedDownloadFormat(requestedFormat) ? requestedFormat : "mp4";
  const quality = isRequestedDownloadQuality(requestedQuality) ? requestedQuality : "1080p";

  if (!rawUrl) {
    return sendJson(
      response,
      400,
      {
        error: "A video URL is required.",
      },
      requestOrigin,
    );
  }

  const result = recognizeVideoUrl(rawUrl);

  if (!result.recognized || !result.canonicalUrl) {
    return sendJson(
      response,
      400,
      {
        error: "Only recognized YouTube, X/Twitter, TikTok, Instagram, Facebook, Vimeo, Reddit, and RedGifs video links can be downloaded right now.",
      },
      requestOrigin,
    );
  }

  const useGeneric = result.provider === "x" || result.provider === "tiktok" || result.provider === "instagram" || result.provider === "facebook" || result.provider === "vimeo" || result.provider === "redgifs" || result.provider === "reddit" || result.provider === "pornhub";

  try {
    const directMediaUrl = useGeneric
      ? await getGenericDirectMediaUrl({ url: result.canonicalUrl, format, quality }).catch(() => null)
      : await getYouTubeDirectMediaUrl({ url: result.canonicalUrl, format, quality }).catch(() => null);

    if (directMediaUrl) {
      // For playback, redirect the browser directly to the CDN URL
      if (mode === "play") {
        setCorsHeaders(response, requestOrigin);
        response.writeHead(302, {
          Location: directMediaUrl,
          "Cache-Control": "private, max-age=3600",
        });
        response.end();
        return;
      }

      const directFetchHeaders: Record<string, string> = {};
      const rangeHeader = request.headers.range;
      if (rangeHeader) directFetchHeaders["Range"] = rangeHeader;

      const directResponse = await fetch(directMediaUrl, {
        cache: "no-store",
        headers: Object.keys(directFetchHeaders).length > 0 ? directFetchHeaders : undefined,
      }).catch(() => null);

      if (directResponse && (directResponse.ok || directResponse.status === 206) && directResponse.body) {
        const resHeaders: Record<string, string> = {
          "Content-Type": directResponse.headers.get("content-type") ?? (format === "mp3" ? "audio/mp4" : "video/mp4"),
          "Cache-Control": "private, max-age=3600",
        };

        const contentLength = directResponse.headers.get("content-length");
        const contentRange = directResponse.headers.get("content-range");
        const acceptRanges = directResponse.headers.get("accept-ranges");
        if (contentLength) resHeaders["Content-Length"] = contentLength;
        if (contentRange) resHeaders["Content-Range"] = contentRange;
        if (acceptRanges) resHeaders["Accept-Ranges"] = acceptRanges;

        setCorsHeaders(response, requestOrigin);
        response.writeHead(directResponse.status, resHeaders);

        Readable.fromWeb(directResponse.body as WebReadableStream).pipe(response);
        return;
      }
    }

    const { stream, fileName, contentType, metadata } = useGeneric
      ? await getGenericDownloadContext({ url: result.canonicalUrl, format, quality })
      : await getYouTubeDownloadContext({ url: result.canonicalUrl, format, quality });

    const contentDispositionType = mode === "play" ? "inline" : "attachment";

    setCorsHeaders(response, requestOrigin);
    response.writeHead(200, {
      "Content-Disposition": `${contentDispositionType}; filename="${fileName}"`,
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-File-Name": encodeURIComponent(fileName),
      "X-Estimated-Size": metadata.estimatedSizeBytes ? String(metadata.estimatedSizeBytes) : "",
    });

    (stream as Readable).on("error", (error) => {
      response.destroy(error);
    });

    (stream as Readable).pipe(response);
  } catch (error) {
    return sendJson(
      response,
      502,
      {
        error: error instanceof Error ? error.message : "Download is unavailable right now.",
      },
      requestOrigin,
    );
  }
};

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

  if (request.method === "OPTIONS") {
    if (rejectDisallowedBrowserOrigin(request, response)) {
      return;
    }

    setCorsHeaders(response, request.headers.origin);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    return sendJson(response, 200, {
      ok: true,
      service: "download-api",
      port,
    });
  }

  if (requestUrl.pathname.startsWith("/api/download/") && rejectDisallowedBrowserOrigin(request, response)) {
    return;
  }

  if (requestUrl.pathname.startsWith("/api/download/") && rejectUnauthorizedRequest(request, requestUrl, response)) {
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/download/inspect") {
    return handleInspect(request, response);
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/download/file") {
    return handleDownload(request, requestUrl, response);
  }

  return sendJson(response, 404, {
    error: "Not found.",
  });
});

server.on("error", async (error) => {
  const nodeError = error as NodeJS.ErrnoException;

  if (nodeError.code === "EADDRINUSE") {
    const alreadyRunning = await checkExistingServerHealth();

    if (alreadyRunning) {
      console.log(`Download API server is already running on http://${host}:${port}`);
      process.exit(0);
      return;
    }

    console.error(
      `Port ${port} is already in use by another process. Stop it or set \`DOWNLOAD_API_PORT\` to a different port.`,
    );
    process.exit(1);
    return;
  }

  console.error(error);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Download API server listening on http://${host}:${port}`);
});
