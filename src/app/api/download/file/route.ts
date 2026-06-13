import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getGenericDownloadContext, getYouTubeDownloadContext } from "@/lib/youtube";
import { saveVideoRecord } from "@/lib/saved-videos";
import { hashIp } from "@/lib/ip-hash";
// Helper to get client IP from request headers
function getClientIp(request: Request): string | null {
  // Try standard headers first
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0].trim();
  }
  // Fallback to remote address (Node.js only)
  // @ts-expect-error: Node.js request.socket is not standard in fetch API
  if (request.socket && request.socket.remoteAddress) {
    // @ts-expect-error: Node.js request.socket is not standard in fetch API
    return request.socket.remoteAddress;
  }
  return null;
}
import {
  isRequestedDownloadFormat,
  isRequestedDownloadQuality,
} from "@/lib/video-links";
import { recognizeVideoUrlAsync } from "@/lib/video-links-async";

const downloadApiBaseUrl = process.env.DOWNLOAD_API_BASE_URL?.trim();
const downloadApiSharedSecret = process.env.DOWNLOAD_API_SHARED_SECRET?.trim();
const isVercelRuntime = Boolean(process.env.VERCEL || process.env.VERCEL_URL);
const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();

const parseProxyErrorMessage = (rawText: string, status: number) => {
  if (!rawText.trim()) {
    return `The external download API returned ${status} without a response body.`;
  }

  try {
    const parsed = JSON.parse(rawText) as { error?: string; message?: string };

    if (typeof parsed.error === "string") {
      return parsed.error;
    }

    if (typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch {
    // fall back to the raw text below
  }

  return rawText.trim();
};

export const runtime = "nodejs";

export async function GET(request: Request) {
  // --- IP download limit logic ---
  const clientIp = getClientIp(request);
  const ipHash = clientIp ? hashIp(clientIp) : null;
  let limitRows: Array<{ download_count?: number }> = [];

  if (ipHash && supabaseUrl && supabaseServiceKey) {
    try {
      const limitRes = await fetch(`${supabaseUrl}/rest/v1/download_limits?ip_hash=eq.${ipHash}`, {
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        cache: "no-store",
      });

      if (limitRes.ok) {
        const rows = await limitRes.json();
        limitRows = Array.isArray(rows) ? rows : [];
      }
    } catch {
      limitRows = [];
    }
  }

  if (limitRows[0]?.download_count && limitRows[0].download_count >= 5) {
    return NextResponse.json({ error: "Download limit reached for your IP. Please try again later." }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);

  if (downloadApiBaseUrl) {
    try {
      const currentOrigin = new URL(request.url).origin;
      const targetOrigin = new URL(downloadApiBaseUrl).origin;

      if (targetOrigin !== currentOrigin) {
        const proxyUrl = new URL("/api/download/file", downloadApiBaseUrl);
        proxyUrl.search = searchParams.toString();
        const proxyHeaders: Record<string, string> = {};
        if (downloadApiSharedSecret) proxyHeaders["X-Download-Api-Secret"] = downloadApiSharedSecret;
        const rangeHeader = request.headers.get("range");
        if (rangeHeader) proxyHeaders["Range"] = rangeHeader;
        const response = await fetch(proxyUrl, {
          cache: "no-store",
          headers: proxyHeaders,
        });

        if (response.ok || response.status === 206) {
          const headers = new Headers();

          for (const [key, value] of response.headers.entries()) {
            if (
              [
                "content-type",
                "content-disposition",
                "cache-control",
                "content-length",
                "content-range",
                "accept-ranges",
                "x-file-name",
                "x-estimated-size",
              ].includes(key.toLowerCase())
            ) {
              headers.set(key, value);
            }
          }

          return new NextResponse(response.body, {
            status: response.status,
            headers,
          });
        }

        if (isVercelRuntime) {
          const responseText = await response.text();

          return NextResponse.json(
            {
              error: parseProxyErrorMessage(responseText, response.status),
            },
            { status: response.status === 408 ? 502 : response.status },
          );
        }
      }
    } catch (error) {
      if (isVercelRuntime) {
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? `The external download API is unavailable: ${error.message}`
                : "The external download API is unavailable.",
          },
          { status: 502 },
        );
      }
    }
  }

  const rawUrl = searchParams.get("url");
  const requestedFormat = searchParams.get("format");
  const requestedQuality = searchParams.get("quality");
  const mode = searchParams.get("mode");
  const format = isRequestedDownloadFormat(requestedFormat) ? requestedFormat : "mp4";
  const quality = isRequestedDownloadQuality(requestedQuality) ? requestedQuality : "1080p";

  if (!rawUrl) {
    return NextResponse.json(
      {
        error: "A video URL is required.",
      },
      { status: 400 },
    );
  }

  const result = await recognizeVideoUrlAsync(rawUrl);

  if (!result.recognized || !result.canonicalUrl) {
    return NextResponse.json(
      {
        error: "Only recognized YouTube, X/Twitter, TikTok, Instagram, Facebook, Vimeo, and RedGifs video links can be downloaded right now.",
      },
      { status: 400 },
    );
  }

  // Treat non-YouTube providers as generic yt-dlp downloads.
  const useGeneric = ["x", "tiktok", "instagram", "facebook", "vimeo", "redgifs", "reddit", "pornhub"].includes(result.provider ?? "");

  try {
    let stream, fileName, contentType, metadata;
    if (useGeneric) {
      ({ stream, fileName, contentType, metadata } = await getGenericDownloadContext({ url: result.canonicalUrl, format, quality }));
    } else {
      ({ stream, fileName, contentType, metadata } = await getYouTubeDownloadContext({ url: result.canonicalUrl, format, quality }));
    }

    // --- Increment download count for this IP hash ---
    if (ipHash && supabaseUrl && supabaseServiceKey) {
      // Upsert row: if exists, increment; else, insert
      await fetch(`${supabaseUrl}/rest/v1/download_limits`, {
        method: "POST",
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          ip_hash: ipHash,
          download_count: (limitRows[0]?.download_count || 0) + 1,
          last_download_at: new Date().toISOString(),
        }),
      });
    }

    // Save video record to Supabase
    try {
      await saveVideoRecord({
        sourceUrl: result.normalizedUrl ?? result.canonicalUrl ?? rawUrl,
        canonicalUrl: result.canonicalUrl ?? rawUrl,
        title: metadata.title ?? fileName,
        thumbnailUrl: metadata.thumbnailUrl ?? null,
        authorName: metadata.authorName ?? null,
        provider: result.provider ?? null,
        durationLabel: metadata.durationLabel ?? null,
        requestedFormat: format,
        requestedQuality: quality,
        fileName,
        storagePath: null,
        videoUrl: null,
        fileSizeBytes: metadata.estimatedSizeBytes ?? null,
        viewCount: null,
        publishDate: null,
      });
    } catch {
      // Ignore Supabase errors for download flow
    }

    const contentDispositionType = mode === "play" ? "inline" : "attachment";

    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Disposition": `${contentDispositionType}; filename="${fileName}"`,
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-File-Name": encodeURIComponent(fileName),
        "X-Estimated-Size": metadata.estimatedSizeBytes ? String(metadata.estimatedSizeBytes) : "",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Download is unavailable right now.",
      },
      { status: 502 },
    );
  }
}
