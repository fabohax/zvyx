import type { SupportedVideoProvider } from "@/lib/video-links";

export type ArchiveVideoInput = {
  sourceUrl: string;
  canonicalUrl: string;
  title: string;
  thumbnailUrl: string | null;
  authorName: string | null;
  provider: SupportedVideoProvider | null;
  durationLabel: string | null;
  requestedFormat: string;
  requestedQuality: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number | null;
  fileBytes: ArrayBuffer;
};

export type ArchiveVideoResult = {
  cid: string;
  ipfsUri: string;
  gatewayUrl: string | null;
  fileName: string;
  size: number | null;
};

const archiveBaseUrl = process.env.VIDEO_ARCHIVE_SERVER_URL?.trim() || null;
const archiveSharedSecret = process.env.VIDEO_ARCHIVE_SHARED_SECRET?.trim() || null;

const metadataHeader = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
};

const readArchiveError = async (response: Response) => {
  const rawText = await response.text().catch(() => "");

  if (!rawText.trim()) {
    return `Archive server returned ${response.status}.`;
  }

  try {
    const payload = JSON.parse(rawText) as { error?: string; message?: string };
    return payload.error ?? payload.message ?? rawText.trim();
  } catch {
    return rawText.trim();
  }
};

export const isVideoArchiveConfigured = () => {
  return Boolean(archiveBaseUrl);
};

export async function uploadVideoToIpfsArchive(input: ArchiveVideoInput): Promise<ArchiveVideoResult | null> {
  if (!archiveBaseUrl) {
    return null;
  }

  const requestUrl = new URL("/api/ipfs/videos", archiveBaseUrl);
  const headers: Record<string, string> = {
    "Content-Type": input.contentType || "application/octet-stream",
    "X-Z-Source-Url": metadataHeader(input.sourceUrl),
    "X-Z-Canonical-Url": metadataHeader(input.canonicalUrl),
    "X-Z-Title": metadataHeader(input.title),
    "X-Z-Thumbnail-Url": metadataHeader(input.thumbnailUrl),
    "X-Z-Author-Name": metadataHeader(input.authorName),
    "X-Z-Provider": metadataHeader(input.provider),
    "X-Z-Duration-Label": metadataHeader(input.durationLabel),
    "X-Z-Requested-Format": metadataHeader(input.requestedFormat),
    "X-Z-Requested-Quality": metadataHeader(input.requestedQuality),
    "X-Z-File-Name": encodeURIComponent(input.fileName),
    "X-Z-File-Size-Bytes": metadataHeader(input.fileSizeBytes),
  };

  if (archiveSharedSecret) {
    headers.Authorization = `Bearer ${archiveSharedSecret}`;
  }

  const response = await fetch(requestUrl, {
    method: "POST",
    headers,
    body: Buffer.from(input.fileBytes),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readArchiveError(response));
  }

  const payload = (await response.json().catch(() => null)) as
    | { cid?: string; ipfsUri?: string; gatewayUrl?: string | null; fileName?: string; size?: number | null }
    | null;

  if (!payload?.cid) {
    throw new Error("Archive server did not return an IPFS CID.");
  }

  return {
    cid: payload.cid,
    ipfsUri: payload.ipfsUri ?? `ipfs://${payload.cid}`,
    gatewayUrl: payload.gatewayUrl ?? null,
    fileName: payload.fileName ?? input.fileName,
    size: typeof payload.size === "number" ? payload.size : input.fileSizeBytes,
  };
}
