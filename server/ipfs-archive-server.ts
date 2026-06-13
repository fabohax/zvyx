import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

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

const port = Number.parseInt(process.env.IPFS_ARCHIVE_PORT ?? process.env.PORT ?? "3000", 10);
const host = process.env.IPFS_ARCHIVE_HOST?.trim() || "0.0.0.0";
const ipfsApiUrl = process.env.IPFS_API_URL?.trim() || "http://127.0.0.1:5001";
const ipfsGatewayUrl = process.env.IPFS_GATEWAY_URL?.trim() || "https://ipfs.io/ipfs";
const sharedSecret = process.env.VIDEO_ARCHIVE_SHARED_SECRET?.trim() || null;
const configuredAllowedOrigins =
  process.env.IPFS_ARCHIVE_ALLOW_ORIGIN
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? ["https://z-xyz.vercel.app", "http://192.168.18.82:3000", "http://localhost:3000"];
const allowedOrigin = configuredAllowedOrigins[0] ?? "*";

type IpfsAddResponse = {
  Name?: string;
  Hash?: string;
  Size?: string;
};

const isOriginAllowed = (origin?: string | null) => {
  if (!origin) {
    return true;
  }

  return configuredAllowedOrigins.includes("*") || configuredAllowedOrigins.includes(origin);
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
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Z-Source-Url, X-Z-Canonical-Url, X-Z-Title, X-Z-Thumbnail-Url, X-Z-Author-Name, X-Z-Provider, X-Z-Duration-Label, X-Z-Requested-Format, X-Z-Requested-Quality, X-Z-File-Name, X-Z-File-Size-Bytes");
};

const sendJson = (response: ServerResponse, status: number, payload: unknown, requestOrigin?: string | null) => {
  setCorsHeaders(response, requestOrigin);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
};

const rejectDisallowedOrigin = (request: IncomingMessage, response: ServerResponse) => {
  const requestOrigin = request.headers.origin?.trim();

  if (!requestOrigin || isOriginAllowed(requestOrigin)) {
    return false;
  }

  sendJson(
    response,
    403,
    {
      error: `Archive requests are restricted to: ${configuredAllowedOrigins.join(", ")}.`,
    },
    requestOrigin,
  );
  return true;
};

const rejectUnauthorizedRequest = (request: IncomingMessage, response: ServerResponse) => {
  if (!sharedSecret) {
    return false;
  }

  const authHeader = request.headers.authorization?.trim();

  if (authHeader === `Bearer ${sharedSecret}`) {
    return false;
  }

  sendJson(
    response,
    401,
    {
      error: "This archive server requires a valid shared secret.",
    },
    request.headers.origin?.trim(),
  );
  return true;
};

const readRequestBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks);
};

const getHeader = (request: IncomingMessage, headerName: string) => {
  const value = request.headers[headerName.toLowerCase()];
  const rawValue = Array.isArray(value) ? value[0] : value;

  return typeof rawValue === "string" && rawValue.trim() ? rawValue.trim() : null;
};

const decodeFileName = (value: string | null) => {
  if (!value) {
    return "video";
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const parseIpfsAddResponse = async (response: Response) => {
  const rawText = await response.text();
  const rows = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as IpfsAddResponse);

  return rows.at(-1) ?? null;
};

const addVideoToIpfs = async (request: IncomingMessage) => {
  const fileBuffer = await readRequestBody(request);

  if (fileBuffer.length === 0) {
    throw new Error("No video file bytes were received.");
  }

  const fileName = decodeFileName(getHeader(request, "x-z-file-name"));
  const contentType = getHeader(request, "content-type") ?? "application/octet-stream";
  const formData = new FormData();

  formData.append("file", new Blob([fileBuffer], { type: contentType }), fileName);

  const addUrl = new URL("/api/v0/add", ipfsApiUrl);
  addUrl.searchParams.set("pin", "true");
  addUrl.searchParams.set("cid-version", "1");

  const response = await fetch(addUrl, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const rawText = await response.text().catch(() => "");
    throw new Error(rawText.trim() || `IPFS add failed with status ${response.status}.`);
  }

  const payload = await parseIpfsAddResponse(response);
  const cid = payload?.Hash;

  if (!cid) {
    throw new Error("IPFS did not return a CID.");
  }

  return {
    cid,
    ipfsUri: `ipfs://${cid}`,
    gatewayUrl: ipfsGatewayUrl ? `${ipfsGatewayUrl.replace(/\/+$/, "")}/${cid}` : null,
    fileName: payload?.Name ?? fileName,
    size: Number.parseInt(payload?.Size ?? String(fileBuffer.length), 10) || fileBuffer.length,
    metadata: {
      sourceUrl: getHeader(request, "x-z-source-url"),
      canonicalUrl: getHeader(request, "x-z-canonical-url"),
      title: getHeader(request, "x-z-title"),
      thumbnailUrl: getHeader(request, "x-z-thumbnail-url"),
      authorName: getHeader(request, "x-z-author-name"),
      provider: getHeader(request, "x-z-provider"),
      durationLabel: getHeader(request, "x-z-duration-label"),
      requestedFormat: getHeader(request, "x-z-requested-format"),
      requestedQuality: getHeader(request, "x-z-requested-quality"),
      fileSizeBytes: getHeader(request, "x-z-file-size-bytes"),
    },
  };
};

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

  if (request.method === "OPTIONS") {
    if (rejectDisallowedOrigin(request, response)) {
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
      service: "ipfs-archive",
      ipfsApiUrl,
      allowedOrigins: configuredAllowedOrigins,
    });
  }

  if (requestUrl.pathname === "/api/ipfs/videos" && rejectDisallowedOrigin(request, response)) {
    return;
  }

  if (requestUrl.pathname === "/api/ipfs/videos" && rejectUnauthorizedRequest(request, response)) {
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/ipfs/videos") {
    try {
      const result = await addVideoToIpfs(request);
      return sendJson(response, 200, result, request.headers.origin?.trim());
    } catch (error) {
      return sendJson(
        response,
        502,
        {
          error: error instanceof Error ? error.message : "Could not add the video to IPFS.",
        },
        request.headers.origin?.trim(),
      );
    }
  }

  return sendJson(response, 404, {
    error: "Not found.",
  });
});

server.on("error", (error) => {
  const nodeError = error as NodeJS.ErrnoException;

  if (nodeError.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Stop the other process or set \`IPFS_ARCHIVE_PORT\` to a different port.`,
    );
    process.exit(1);
    return;
  }

  console.error(error);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`IPFS archive server listening on http://${host}:${port}`);
  console.log(`Forwarding uploaded videos to IPFS API ${ipfsApiUrl}`);
});
