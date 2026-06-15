import { NextResponse } from "next/server";
import { createDownloadSignature } from "@/lib/download-signature";
import { getGenericMetadata, getYouTubeMetadata } from "@/lib/youtube";
import {
  isRequestedDownloadFormat,
  isRequestedDownloadQuality,
  type RequestedDownloadFormat,
  type RequestedDownloadQuality,
  type VideoRecognitionResult,
} from "@/lib/video-links";
import { recognizeVideoUrlAsync } from "@/lib/video-links-async";

const downloadApiBaseUrl = process.env.DOWNLOAD_API_BASE_URL?.trim();
const downloadApiSharedSecret = process.env.DOWNLOAD_API_SHARED_SECRET?.trim();
const isVercelRuntime = Boolean(process.env.VERCEL || process.env.VERCEL_URL);
const downloadUrlTtlMs = 15 * 60 * 1000;

const buildSignedExternalDownloadUrl = ({
  url,
  format,
  quality,
}: {
  url: string;
  format: RequestedDownloadFormat;
  quality: RequestedDownloadQuality;
}) => {
  if (!downloadApiBaseUrl || !downloadApiSharedSecret) {
    return null;
  }

  const expiresAt = Date.now() + downloadUrlTtlMs;
  const signature = createDownloadSignature({ url, format, quality, expiresAt }, downloadApiSharedSecret);
  const nextUrl = new URL("/api/download/file", downloadApiBaseUrl);
  nextUrl.search = new URLSearchParams({
    url,
    format,
    quality,
    dl_exp: String(expiresAt),
    dl_sig: signature,
  }).toString();

  return nextUrl.toString();
};

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

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    url?: string;
    format?: string;
    quality?: string;
  } | null;
  const requestedFormat = isRequestedDownloadFormat(body?.format) ? body.format : "mp4";
  const requestedQuality = isRequestedDownloadQuality(body?.quality) ? body.quality : "1080p";

  if (downloadApiBaseUrl) {
    try {
      const currentOrigin = new URL(request.url).origin;
      const targetOrigin = new URL(downloadApiBaseUrl).origin;

      if (targetOrigin !== currentOrigin) {
        const response = await fetch(new URL("/api/download/inspect", downloadApiBaseUrl), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(downloadApiSharedSecret ? { "X-Download-Api-Secret": downloadApiSharedSecret } : {}),
          },
          body: JSON.stringify(body ?? {}),
          cache: "no-store",
        });

        const responseText = await response.text();

        if (response.ok) {
          if (isVercelRuntime && downloadApiSharedSecret) {
            try {
              const payload = JSON.parse(responseText) as VideoRecognitionResult;

              if (payload.downloadAvailable !== false && payload.canonicalUrl) {
                payload.downloadUrl =
                  buildSignedExternalDownloadUrl({
                    url: payload.canonicalUrl,
                    format: requestedFormat,
                    quality: requestedQuality,
                  }) ?? payload.downloadUrl;
              }

              return NextResponse.json(payload, {
                status: response.status,
                headers: {
                  "Cache-Control": "no-store",
                },
              });
            } catch {
              // fall back to the raw proxy response below
            }
          }

          return new NextResponse(responseText, {
            status: response.status,
            headers: {
              "Content-Type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
              "Cache-Control": "no-store",
            },
          });
        }

        if (isVercelRuntime) {
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

  if (!body || typeof body.url !== "string") {
    return NextResponse.json(
      {
        error: "Please provide a video URL.",
      },
      { status: 400 },
    );
  }

  const result = await recognizeVideoUrlAsync(body.url);

  if (!result.normalizedUrl && !result.recognized) {
    return NextResponse.json(
      {
        ...result,
        error: result.message,
      },
      { status: 400 },
    );
  }

  if (result.recognized && result.canonicalUrl) {
    const providerLabels: Record<string, string> = { x: "X", tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", facebook: "Facebook", vimeo: "Vimeo", redgifs: "RedGifs", pornhub: "Pornhub" };
    try {
      const useGeneric = ["x", "tiktok", "instagram", "facebook", "vimeo", "redgifs", "reddit", "pornhub"].includes(result.provider ?? "");
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

      return NextResponse.json({
        ...result,
        ...metadata,
        requestedFormat,
        requestedQuality,
        downloadAvailable,
        downloadUrl,
        message: metadata.warningMessage ?? `${providerLabel} video recognized and ready to download.`,
      });
    } catch (error) {
      const providerLabel = providerLabels[result.provider ?? ""] ?? "video";

      return NextResponse.json(
        {
          ...result,
          requestedFormat,
          requestedQuality,
          error:
            error instanceof Error
              ? error.message
              : `The ${providerLabel} link was recognized, but metadata could not be fetched right now.`,
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({
    ...result,
    requestedFormat,
    requestedQuality,
  });
}
