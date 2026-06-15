export async function resolveFacebookShareUrl(shareUrl: string): Promise<string | null> {
  try {
    const response = await fetch(shareUrl, {
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0",
      },
      signal: AbortSignal.timeout(10_000),
    });

    const resolvedUrl = response.url || shareUrl;
    const resolvedMatch = extractFacebookVideoUrl(resolvedUrl);

    if (resolvedMatch) {
      return resolvedMatch;
    }

    const html = await response.text().catch(() => "");
    return extractFacebookVideoUrl(html);
  } catch {
    return null;
  }
}

const extractFacebookVideoUrl = (value: string) => {
  const decodedValue = decodeHtmlEntities(value);
  const reelMatch = decodedValue.match(/https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/reels?\/(\d+)/i);

  if (reelMatch?.[1]) {
    return `https://www.facebook.com/reel/${reelMatch[1]}`;
  }

  const watchMatch = decodedValue.match(/https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/watch\/?\?v=(\d+)/i);

  if (watchMatch?.[1]) {
    return `https://www.facebook.com/watch/?v=${watchMatch[1]}`;
  }

  const videoMatch = decodedValue.match(/https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/[^"'<> ]+\/videos\/(\d+)/i);

  if (videoMatch?.[1]) {
    return `https://www.facebook.com/watch/?v=${videoMatch[1]}`;
  }

  return null;
};

const decodeHtmlEntities = (value: string) => {
  return value
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'");
};
