import { recognizeVideoUrl, parseFacebookUrl } from "./video-links";

export const recognizeVideoUrlAsync = async (rawUrl: string) => {
  const normalizedResult = recognizeVideoUrl(rawUrl);

  if (!normalizedResult.normalizedUrl) {
    return normalizedResult;
  }

  const url = new URL(normalizedResult.normalizedUrl);
  // Facebook share/v link resolution
  const facebookMatch = parseFacebookUrl(url);
  if (facebookMatch && facebookMatch.kind === "share" && facebookMatch.needsResolve) {
    const { resolveFacebookShareUrl } = await import("./fb-redirect");
    const resolved = await resolveFacebookShareUrl(facebookMatch.originalUrl);
    if (resolved) {
      // Re-run recognition on the resolved URL
      return recognizeVideoUrl(resolved);
    } else {
      return {
        recognized: false,
        provider: "facebook",
        normalizedUrl: rawUrl,
        canonicalUrl: null,
        videoId: null,
        kind: null,
        thumbnailUrl: null,
        message: "Could not resolve Facebook share link to a valid reel.",
      };
    }
  }
  // Fallback to original sync logic
  return normalizedResult;
};
