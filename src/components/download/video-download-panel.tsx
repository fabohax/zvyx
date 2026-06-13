"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue
} from "@/components/ui/select";
import {
  createDownloadHistoryId,
  formatBytes,
  upsertDownloadHistory,
  type DownloadHistoryItem,
} from "@/lib/download-history";
import type { SavedVideoRecord } from "@/lib/saved-videos";
import { getDictionary, type Locale } from "@/lib/i18n";
import type {
  RequestedDownloadFormat,
  RequestedDownloadQuality,
  VideoRecognitionResult,
} from "@/lib/video-links";

type DownloadPhase = "idle" | "inspecting" | "downloading" | "completed" | "failed";

type DownloadState = {
  phase: DownloadPhase;
  label: string;
  downloadedBytes: number;
  totalBytes: number | null;
  progressPercent: number | null;
};

type PersistCompletedVideoInput = {
  blob: Blob;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
};

type PersistCompletedVideoResult = {
  item: SavedVideoRecord | null;
  archive: { cid: string; ipfsUri?: string; gatewayUrl?: string | null } | null;
};

const initialDownloadState: DownloadState = {
  phase: "idle",
  label: "Paste a video URL to start.",
  downloadedBytes: 0,
  totalBytes: null,
  progressPercent: null,
};

const parseDownloadFileName = (contentDisposition: string | null, fallbackName: string) => {
  const encodedMatch = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];

  if (encodedMatch) {
    return decodeURIComponent(encodedMatch);
  }

  const plainMatch = contentDisposition?.match(/filename="?([^";]+)"?/i)?.[1];

  if (plainMatch) {
    return plainMatch;
  }

  return fallbackName;
};

const readApiPayload = async <T,>(response: Response): Promise<T | null> => {
  const text = await response.text().catch(() => "");

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

const getApiErrorMessage = (
  response: Response,
  payload: { error?: string; message?: string } | null,
  fallbackMessage: string,
) => {
  if (payload?.error && typeof payload.error === "string") {
    return payload.error;
  }

  if (payload?.message && typeof payload.message === "string" && !response.ok) {
    return payload.message;
  }

  if (response.status === 408) {
    return "The downloader service took too long to respond. Please try again in a moment.";
  }

  if (response.status >= 500) {
    return "The downloader service is temporarily unavailable. Please try again in a moment.";
  }

  return fallbackMessage;
};

const persistCompletedVideo = async (
  result: VideoRecognitionResult,
  format: RequestedDownloadFormat,
  quality: RequestedDownloadQuality,
  fileUpload?: PersistCompletedVideoInput,
): Promise<PersistCompletedVideoResult> => {
  const sourceUrl = result.normalizedUrl ?? result.canonicalUrl;
  const canonicalUrl = result.canonicalUrl ?? result.normalizedUrl;

  if (!sourceUrl || !canonicalUrl || !result.title) {
    return { item: null, archive: null };
  }

  let response: Response;

  if (fileUpload) {
    const formData = new FormData();
    formData.append("sourceUrl", sourceUrl);
    formData.append("canonicalUrl", canonicalUrl);
    formData.append("title", result.title);
    formData.append("thumbnailUrl", result.thumbnailUrl ?? "");
    formData.append("authorName", result.authorName ?? "");
    formData.append("provider", result.provider ?? "");
    formData.append("durationLabel", result.durationLabel ?? "");
    formData.append("requestedFormat", result.requestedFormat ?? format);
    formData.append("requestedQuality", result.requestedQuality ?? quality);
    formData.append("fileName", fileUpload.fileName);
    formData.append("fileSizeBytes", String(fileUpload.fileSizeBytes));
    formData.append(
      "file",
      new File([fileUpload.blob], fileUpload.fileName, {
        type: fileUpload.contentType,
      }),
    );

    response = await fetch("/api/videos", {
      method: "POST",
      body: formData,
    });
  } else {
    response = await fetch("/api/videos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceUrl,
        canonicalUrl,
        title: result.title,
        thumbnailUrl: result.thumbnailUrl ?? null,
        authorName: result.authorName ?? null,
        provider: result.provider ?? null,
        durationLabel: result.durationLabel ?? null,
        requestedFormat: result.requestedFormat ?? format,
        requestedQuality: result.requestedQuality ?? quality,
        fileName: result.fileName ?? null,
        fileSizeBytes: null,
      }),
    });
  }

  const payload = await readApiPayload<{
    item?: SavedVideoRecord | null;
    archive?: PersistCompletedVideoResult["archive"];
    error?: string;
  }>(response);

  if (!response.ok) {
    throw new Error(payload?.error ?? "Could not sync the video to Supabase.");
  }

  return {
    item: payload?.item ?? null,
    archive: payload?.archive ?? null,
  };
};

const createHistoryEntry = (
  id: string,
  result: VideoRecognitionResult,
  format: RequestedDownloadFormat,
  quality: RequestedDownloadQuality,
): DownloadHistoryItem => {
  const timestamp = new Date().toISOString();

  return {
    id,
    title: result.title ?? result.videoId ?? "Untitled download",
    canonicalUrl: result.canonicalUrl ?? null,
    thumbnailUrl: result.thumbnailUrl ?? null,
    provider: result.provider ?? null,
    authorName: result.authorName ?? null,
    durationLabel: result.durationLabel ?? null,
    fileName: result.fileName ?? null,
    format: result.requestedFormat ?? format,
    quality: result.requestedQuality ?? quality,
    status: "queued",
    progressPercent: 0,
    downloadedBytes: 0,
    totalBytes: result.estimatedSizeBytes ?? null,
    message: result.message,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

type VideoDownloadPanelProps = {
  locale?: Locale;
  pastedUrl?: string | null;
  onPastedUrlConsumed?: () => void;
};

export function VideoDownloadPanel({ locale = "en", pastedUrl, onPastedUrlConsumed }: VideoDownloadPanelProps) {
  const t = getDictionary(locale);
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<RequestedDownloadFormat>("mp4");
  const [quality, setQuality] = useState<RequestedDownloadQuality>("best");
  const [result, setResult] = useState<VideoRecognitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [downloadState, setDownloadState] = useState<DownloadState>(initialDownloadState);
  const isLoadingRef = useRef(false);

  useEffect(() => {
    if (pastedUrl && !isLoadingRef.current) {
      setUrl(pastedUrl);
      onPastedUrlConsumed?.();
      document.getElementById("download")?.scrollIntoView({ behavior: "smooth" });
      executeDownload(pastedUrl);
    }
  }, [pastedUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const startTrackedDownload = async (
    data: VideoRecognitionResult,
    historyId: string,
    createdAt: string,
  ) => {
    if (!data.downloadUrl) {
      return;
    }

    setDownloadState({
      phase: "downloading",
      label: "Starting download...",
      downloadedBytes: 0,
      totalBytes: data.estimatedSizeBytes ?? null,
      progressPercent: 0,
    });

    const response = await fetch(data.downloadUrl);
    const responseError = !response.ok ? await readApiPayload<{ error?: string; message?: string }>(response) : null;

    if (!response.ok) {
      throw new Error(getApiErrorMessage(response, responseError, "The download could not be started."));
    }

    if (!response.body) {
      throw new Error("The download stream is unavailable right now.");
    }

    const totalBytesFromHeader = Number(
      response.headers.get("Content-Length") ?? response.headers.get("X-Estimated-Size") ?? 0,
    );
    const totalBytes =
      (Number.isFinite(totalBytesFromHeader) && totalBytesFromHeader > 0 ? totalBytesFromHeader : null) ??
      data.estimatedSizeBytes ??
      null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let downloadedBytes = 0;
    let lastSavedProgress = -1;

    upsertDownloadHistory({
      ...createHistoryEntry(historyId, data, format, quality),
      createdAt,
      updatedAt: new Date().toISOString(),
      status: "downloading",
      totalBytes,
      message: "Download in progress.",
    });

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      chunks.push(value);
      downloadedBytes += value.byteLength;

      const progressPercent = totalBytes ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)) : null;
      const progressLabel = totalBytes
        ? `Downloading... ${progressPercent}% (${formatBytes(downloadedBytes) ?? "0 B"} / ${formatBytes(totalBytes)})`
        : `Downloading... ${formatBytes(downloadedBytes) ?? "0 B"} received`;

      setDownloadState({
        phase: "downloading",
        label: progressLabel,
        downloadedBytes,
        totalBytes,
        progressPercent,
      });

      if (progressPercent !== lastSavedProgress) {
        upsertDownloadHistory({
          ...createHistoryEntry(historyId, data, format, quality),
          createdAt,
          updatedAt: new Date().toISOString(),
          status: "downloading",
          downloadedBytes,
          totalBytes,
          progressPercent,
          message: progressLabel,
        });
        lastSavedProgress = progressPercent ?? lastSavedProgress;
      }
    }

    const fallbackName = `${data.title ?? "video"}.${format === "mp3" ? "m4a" : "mp4"}`;
    const fileName = parseDownloadFileName(response.headers.get("Content-Disposition"), fallbackName);
    const contentType = response.headers.get("Content-Type") ?? data.contentType ?? "application/octet-stream";
    const blobParts = chunks.map((chunk) => Uint8Array.from(chunk));
    const blob = new Blob(blobParts, { type: contentType });

    if (downloadedBytes <= 0 || blob.size <= 0) {
      throw new Error("The download finished without any file data. Please try again.");
    }

    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1_000);

    const finalTotalBytes = totalBytes ?? downloadedBytes;
    const syncingMessage = `Saved to your device. Syncing ${formatBytes(downloadedBytes) ?? "the file"} to the shared gallery...`;

    setDownloadState({
      phase: "completed",
      label: syncingMessage,
      downloadedBytes,
      totalBytes: finalTotalBytes,
      progressPercent: 100,
    });

    upsertDownloadHistory({
      ...createHistoryEntry(historyId, data, format, quality),
      createdAt,
      updatedAt: new Date().toISOString(),
      status: "completed",
      fileName,
      downloadedBytes,
      totalBytes: finalTotalBytes,
      progressPercent: 100,
      message: syncingMessage,
    });


    let savedItem: SavedVideoRecord | null = null;
    let archivedCid: string | null = null;
    let completionMessage = `Download complete. ${formatBytes(downloadedBytes) ?? "File"} saved to your device.`;

    try {
      const persistedVideo = await persistCompletedVideo(
        {
          ...data,
          fileName,
        },
        format,
        quality,
        {
          blob,
          fileName,
          contentType,
          fileSizeBytes: downloadedBytes,
        },
      );
      savedItem = persistedVideo.item;
      archivedCid = persistedVideo.archive?.cid ?? null;

      if (savedItem?.videoUrl) {
        completionMessage = `Download complete. ${formatBytes(downloadedBytes) ?? "File"} saved and synced to the shared gallery.`;
      } else if (archivedCid) {
        completionMessage = `Download complete. ${formatBytes(downloadedBytes) ?? "File"} saved to your device and archived to IPFS.`;
      }

      // Dynamically notify DownloadHistoryStrip to add the new video
      if (savedItem) {
        window.dispatchEvent(new CustomEvent("z:video-downloaded", { detail: savedItem }));
      }
    } catch (syncError) {
      completionMessage =
        syncError instanceof Error
          ? `Download complete. Saved locally, but gallery sync failed: ${syncError.message}`
          : "Download complete. Saved locally, but gallery sync failed.";
    }

    setDownloadState({
      phase: "completed",
      label: completionMessage,
      downloadedBytes,
      totalBytes: finalTotalBytes,
      progressPercent: 100,
    });

    upsertDownloadHistory({
      ...createHistoryEntry(historyId, data, format, quality),
      createdAt,
      updatedAt: new Date().toISOString(),
      status: "completed",
      fileName,
      videoUrl: savedItem?.videoUrl ?? null,
      storagePath: savedItem?.storagePath ?? null,
      downloadedBytes,
      totalBytes: finalTotalBytes,
      progressPercent: 100,
      message: completionMessage,
    });
  };

  const executeDownload = async (targetUrl: string) => {
    setIsLoading(true);
    isLoadingRef.current = true;
    setError(null);
    setResult(null);
    setDownloadState({
      phase: "inspecting",
      label: "Checking the link and loading video details...",
      downloadedBytes: 0,
      totalBytes: null,
      progressPercent: 8,
    });

    const historyId = createDownloadHistoryId();
    const createdAt = new Date().toISOString();
    let currentResult: VideoRecognitionResult | null = null;

    try {
      const response = await fetch("/api/download/inspect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: targetUrl, format, quality }),
      });

      const data = await readApiPayload<VideoRecognitionResult & { error?: string; message?: string }>(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(response, data, "Unable to inspect that video link."));
      }

      if (!data) {
        throw new Error("The downloader service returned an empty response. Please try again.");
      }

      currentResult = data;
      setResult(data);

      if (!data.recognized) {
        upsertDownloadHistory({
          ...createHistoryEntry(historyId, data, format, quality),
          createdAt,
          updatedAt: new Date().toISOString(),
          status: "failed",
          progressPercent: null,
          message: data.message,
        });
        setDownloadState({
          phase: "failed",
          label: data.message,
          downloadedBytes: 0,
          totalBytes: null,
          progressPercent: null,
        });
        return;
      }

      if (data.downloadAvailable === false || !data.downloadUrl) {
        const warningMessage = data.warningMessage ?? data.message;

        upsertDownloadHistory({
          ...createHistoryEntry(historyId, data, format, quality),
          createdAt,
          updatedAt: new Date().toISOString(),
          status: "failed",
          progressPercent: null,
          message: warningMessage,
        });
        setDownloadState({
          phase: "failed",
          label: warningMessage,
          downloadedBytes: 0,
          totalBytes: data.estimatedSizeBytes ?? null,
          progressPercent: null,
        });
        return;
      }

      upsertDownloadHistory({
        ...createHistoryEntry(historyId, data, format, quality),
        createdAt,
        updatedAt: new Date().toISOString(),
        status: "queued",
        progressPercent: 12,
        message: "Video recognized. Preparing download...",
      });

      await startTrackedDownload(data, historyId, createdAt);
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : "Something went wrong.";
      setResult(null);
      setError(message);
      upsertDownloadHistory({
        id: historyId,
        title: currentResult?.title ?? targetUrl,
        canonicalUrl: currentResult?.canonicalUrl ?? null,
        thumbnailUrl: currentResult?.thumbnailUrl ?? null,
        provider: currentResult?.provider ?? null,
        authorName: currentResult?.authorName ?? null,
        durationLabel: currentResult?.durationLabel ?? null,
        fileName: currentResult?.fileName ?? null,
        format,
        quality,
        status: "failed",
        progressPercent: null,
        downloadedBytes: 0,
        totalBytes: currentResult?.estimatedSizeBytes ?? null,
        message,
        createdAt,
        updatedAt: new Date().toISOString(),
      });
      setDownloadState({
        phase: "failed",
        label: message,
        downloadedBytes: 0,
        totalBytes: null,
        progressPercent: null,
      });
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    executeDownload(url);
  };

  const buttonLabel = isLoading
    ? downloadState.phase === "downloading"
      ? downloadState.progressPercent !== null
        ? t.downloadingPercent(downloadState.progressPercent)
        : t.downloading
      : t.checkingLink
    : t.downloadVideo;

  return (
    <section
      id="download"
      className="rounded-[28px] border border-white/10 bg-slate-950/60 p-4 shadow-2xl shadow-sky-950/20 backdrop-blur sm:p-5"
    >
      <form className="space-y-3" onSubmit={handleSubmit}>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-2 sm:p-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex flex-row items-center gap-2 flex-1">
              <button
                type="button"
                onClick={async () => {
                  if (navigator.clipboard) {
                    const text = await navigator.clipboard.readText();
                    setUrl(text);
                  }
                }}
                className="cursor-pointer rounded-full bg-dark-800 px-4 py-3 text-sm font-semibold text-white border border-white/10 transition hover:bg-slate-900"
                style={{ minWidth: 0 }}
                tabIndex={-1}
              >
                Paste
              </button>
              <Input
                type="url"
                name="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t.pasteVideoPlaceholder}
                required
                className="min-w-0 flex-1 border-none outline-0"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row lg:flex-row mt-2 lg:mt-0">
                <Select value={format} onValueChange={v => setFormat(v as RequestedDownloadFormat)}>
                  <SelectTrigger className="my-2 w-20 border-none cursor-pointer text-right">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mp4">MP4</SelectItem>
                    <SelectItem value="mp3">Audio</SelectItem>
                    <SelectItem value="best">Best</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={quality} onValueChange={v => setQuality(v as RequestedDownloadQuality)}>
                  <SelectTrigger className="my-2 w-32 border-none cursor-pointer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="best">Highest</SelectItem>
                    <SelectItem value="1080p">1080p</SelectItem>
                    <SelectItem value="720p">720p</SelectItem>
                    <SelectItem value="480p">480p</SelectItem>
                  </SelectContent>
                </Select>

              <button
                type="submit"
                disabled={isLoading}
                className="rounded-full bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
              >
                {buttonLabel}
              </button>
            </div>
          </div>
        </div>

        {result?.canonicalUrl ? (
          <div className="text-center">
            <a
              href={result.canonicalUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-sky-200 transition hover:text-sky-100"
            >
              {t.previewSource}
            </a>
          </div>
        ) : null}
      </form>

      {downloadState.phase !== "idle" ? (
        <div className="mt-4 rounded-2xl border border-sky-400/20 bg-sky-500/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">{downloadState.label}</p>
            <span className="text-xs font-medium text-sky-100">
              {downloadState.progressPercent !== null ? `${downloadState.progressPercent}%` : t.live}
            </span>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${downloadState.phase === "failed" ? "bg-rose-400" : downloadState.phase === "completed" ? "bg-emerald-400" : "bg-sky-400"}`}
              style={{ width: `${downloadState.progressPercent ?? (downloadState.phase === "inspecting" ? 12 : 28)}%` }}
            />
          </div>

          <p className="mt-2 text-xs text-slate-300">
            {formatBytes(downloadState.downloadedBytes) ?? "0 B"}
            {downloadState.totalBytes ? ` / ${formatBytes(downloadState.totalBytes)}` : ""}
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4">
          <p className="text-sm font-semibold text-rose-100">{t.couldNotProcess}</p>
          <p className="mt-1 text-sm text-rose-100/90">{error}</p>
        </div>
      ) : null}

      {result ? (
        <div
          className={`mt-4 rounded-2xl border p-4 ${
            result.recognized
              ? "border-emerald-400/30 bg-emerald-500/10"
              : "border-amber-400/30 bg-amber-500/10"
          }`}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">{result.message}</p>
              <p className="mt-1 text-xs text-slate-200">
                {result.recognized
                  ? t.providerVideoId(result.provider ?? "", result.videoId ?? "")
                  : t.unsupportedPlatform}
              </p>

              {result.title ? <p className="mt-3 text-base font-semibold text-white">{result.title}</p> : null}

              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-100">
                {result.authorName ? (
                  <span className="rounded-full border border-white/10 px-2 py-1">{result.authorName}</span>
                ) : null}
                {result.durationLabel ? (
                  <span className="rounded-full border border-white/10 px-2 py-1">{result.durationLabel}</span>
                ) : null}
                {result.viewCountLabel ? (
                  <span className="rounded-full border border-white/10 px-2 py-1">{result.viewCountLabel}</span>
                ) : null}
                {result.requestedFormat ? (
                  <span className="rounded-full border border-white/10 px-2 py-1">
                    {result.requestedFormat.toUpperCase()}
                  </span>
                ) : null}
                {result.estimatedSizeLabel ? (
                  <span className="rounded-full border border-white/10 px-2 py-1">~{result.estimatedSizeLabel}</span>
                ) : null}
              </div>

              {result.canonicalUrl ? (
                <p className="mt-3 break-all text-xs text-sky-100">{result.canonicalUrl}</p>
              ) : null}

              {result.downloadUrl ? (
                <a
                  href={result.downloadUrl}
                  className="mt-3 inline-flex rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/20"
                >
                  {t.directDownloadLink}
                </a>
              ) : null}
            </div>

            {result.thumbnailUrl ? (
              <div className="relative h-24 w-full overflow-hidden rounded-xl sm:w-40">
                <Image
                  src={result.thumbnailUrl}
                  alt={result.title ? `${result.title} thumbnail` : "YouTube preview"}
                  fill
                  sizes="(min-width: 640px) 160px, 100vw"
                  className="object-cover"
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

    </section>
  );
}
