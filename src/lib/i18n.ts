export type Locale = "en" | "es";

export const defaultLocale: Locale = "en";

export const locales: Locale[] = ["en", "es"];

const en = {
  // Nav
  paste: "Paste",
  feed: "Feed",

  // Hero
  badge: "Fast video downloading and sharing",
  heroTitle: "Download Any Video & Share",
  heroDescription:
    "Paste a link, save the file you need, and share it anywhere with a clean, fast, minimal flow.",
  howItWorksTitle: "How ZVYX works",
  howItWorksDescription:
    "ZVYX turns supported social video links into ready-to-save files while keeping the interface focused on one job: paste, inspect, download.",
  howItWorksStepOneTitle: "Paste a supported link",
  howItWorksStepOneDescription:
    "Drop in a URL from YouTube, TikTok, Instagram, X, Facebook, Vimeo, Reddit, or Redgifs.",
  howItWorksStepTwoTitle: "ZVYX reads the source",
  howItWorksStepTwoDescription:
    "The app checks the provider, loads video details, and prepares the best available download stream.",
  howItWorksStepThreeTitle: "Save and replay",
  howItWorksStepThreeDescription:
    "Download the file to your device, then keep successful saves available in the shared gallery for quick playback.",
  footerTagline: "ZVYX is open source video tooling for fast personal archiving.",
  openSource: "OSS",
  githubRepository: "GitHub repository",

  // Download panel
  instantDownload: "Instant download",
  pasteVideoUrl: "Paste video URL",
  pasteVideoUrlDescription:
    "Paste a video link and download it fast.",
  pasteVideoPlaceholder: "Video link here...",
  downloadVideo: "Download",
  checkingLink: "Checking link...",
  downloading: "Downloading...",
  downloadingPercent: (pct: number) => `Downloading ${pct}%`,
  previewSource: "Preview source",
  live: "Live",
  couldNotProcess: "Could not process that link",
  directDownloadLink: "Direct download link",
  providerVideoId: (provider: string, videoId: string) =>
    `Provider: ${provider} • Video ID: ${videoId}`,
  unsupportedPlatform:
    "Only YouTube, X, TikTok, Instagram, and Facebook video links are supported right now.",
  pasteUrlToStart: "Paste a video URL to start.",
  startingDownload: "Starting download...",
  checkingLinkLoading: "Checking the link and loading video details...",
  downloadStreamUnavailable: "The download stream is unavailable right now.",
  downloadFinishedEmpty:
    "The download finished without any file data. Please try again.",
  savedToDevice: (size: string) =>
    `Saved to your device. Syncing ${size} to the shared gallery...`,
  downloadComplete: (size: string) =>
    `Download complete. ${size} saved to your device.`,
  downloadCompleteSynced: (size: string) =>
    `Download complete. ${size} saved and synced to the shared gallery.`,
  downloadCompleteLocalOnly:
    "Download complete. Saved locally, but gallery sync failed.",
  somethingWentWrong: "Something went wrong.",
  videoRecognized: "Video recognized. Preparing download...",
  downloadInProgress: "Download in progress.",

  // TV / Feed
  tv: "tv",
  noSavedVideos: "No saved videos yet",
  noSavedVideosDescription:
    "Download a video first, then it will show up here for instant replay.",
  home: "← Home",
  currentVideo: "Current video",
  details: "Details",
  titleLabel: "Title",
  creatorLabel: "Creator",
  providerLabel: "Provider",
  durationLabel: "Duration",
  formatLabel: "Format",
  qualityLabel: "Quality",
  savedLabel: "Saved",
  sourceUrlLabel: "Source URL",
  unknown: "Unknown",

  // Video page
  back: "← Back",
  allSaved: "All saved",
  openSourceLink: "Open source link",
  download: "Download",
  previous: "← Previous",
  next: "Next →",
  savedVideo: "Saved video",

  // Login
  backToLanding: "← Back to landing page",

  // Gallery strip
  savedVideoGallery: "Saved video gallery",
  recentDownloads: "Recent downloads, ready to swipe through",
  successfulVideos:
    "Successful videos are saved here. Tap any card to open its own player page.",
  finishDownload:
    "Finish a YouTube download above and it will appear here for replay.",
  playable: "Playable",
  openPage: "Open page",
  noPreview: "No preview",
  readyToPlay: "Ready to play",
  noPlayableUrl: "No playable URL is stored for this video yet.",
} as const;

type DictionaryShape = {
  [K in keyof typeof en]: (typeof en)[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : string;
};

const es: DictionaryShape = {
  // Nav
  paste: "Pegar",
  feed: "Galería",

  // Hero
  badge: "Descarga y comparte videos rápidamente",
  heroTitle: "Descarga Videos & Comparte",
  heroDescription:
    "Pega un enlace, guarda el archivo que necesitas y compártelo donde quieras de forma limpia, rápida y sencilla.",
  howItWorksTitle: "Cómo funciona ZVYX",
  howItWorksDescription:
    "ZVYX convierte enlaces de video social compatibles en archivos listos para guardar, con una interfaz enfocada en una sola tarea: pegar, revisar y descargar.",
  howItWorksStepOneTitle: "Pega un enlace compatible",
  howItWorksStepOneDescription:
    "Usa una URL de YouTube, TikTok, Instagram, X, Facebook, Vimeo, Reddit o Redgifs.",
  howItWorksStepTwoTitle: "ZVYX lee la fuente",
  howItWorksStepTwoDescription:
    "La app verifica el proveedor, carga los detalles del video y prepara la mejor transmisión de descarga disponible.",
  howItWorksStepThreeTitle: "Guarda y reproduce",
  howItWorksStepThreeDescription:
    "Descarga el archivo a tu dispositivo y conserva las descargas exitosas en la galería compartida para reproducirlas rápido.",
  footerTagline: "ZVYX es tooling open source para archivar videos personales con rapidez.",
  openSource: "OSS",
  githubRepository: "Repositorio de GitHub",

  // Download panel
  instantDownload: "Descarga instantánea",
  pasteVideoUrl: "Pega la URL del video",
  pasteVideoUrlDescription:
    "Pega un enlace de video y descárgalo rápido.",
  pasteVideoPlaceholder: "Pega el enlace del video aquí...",
  downloadVideo: "Descargar video",
  checkingLink: "Verificando enlace...",
  downloading: "Descargando...",
  downloadingPercent: (pct: number) => `Descargando ${pct}%`,
  previewSource: "Ver fuente",
  live: "En vivo",
  couldNotProcess: "No se pudo procesar ese enlace",
  directDownloadLink: "Enlace de descarga directa",
  providerVideoId: (provider: string, videoId: string) =>
    `Proveedor: ${provider} • ID del video: ${videoId}`,
  unsupportedPlatform:
    "Solo se admiten enlaces de video de YouTube, X, TikTok, Instagram y Facebook por ahora.",
  pasteUrlToStart: "Pega una URL de video para comenzar.",
  startingDownload: "Iniciando descarga...",
  checkingLinkLoading: "Verificando el enlace y cargando detalles del video...",
  downloadStreamUnavailable:
    "La transmisión de descarga no está disponible en este momento.",
  downloadFinishedEmpty:
    "La descarga finalizó sin datos. Por favor intenta de nuevo.",
  savedToDevice: (size: string) =>
    `Guardado en tu dispositivo. Sincronizando ${size} a la galería compartida...`,
  downloadComplete: (size: string) =>
    `Descarga completa. ${size} guardado en tu dispositivo.`,
  downloadCompleteSynced: (size: string) =>
    `Descarga completa. ${size} guardado y sincronizado con la galería compartida.`,
  downloadCompleteLocalOnly:
    "Descarga completa. Guardado localmente, pero la sincronización con la galería falló.",
  somethingWentWrong: "Algo salió mal.",
  videoRecognized: "Video reconocido. Preparando descarga...",
  downloadInProgress: "Descarga en progreso.",

  // TV / Feed
  tv: "tv",
  noSavedVideos: "Aún no hay videos guardados",
  noSavedVideosDescription:
    "Descarga un video primero, luego aparecerá aquí para reproducción instantánea.",
  home: "← Inicio",
  currentVideo: "Video actual",
  details: "Detalles",
  titleLabel: "Título",
  creatorLabel: "Creador",
  providerLabel: "Proveedor",
  durationLabel: "Duración",
  formatLabel: "Formato",
  qualityLabel: "Calidad",
  savedLabel: "Guardado",
  sourceUrlLabel: "URL de origen",
  unknown: "Desconocido",

  // Video page
  back: "← Volver",
  allSaved: "Todos los guardados",
  openSourceLink: "Abrir enlace original",
  download: "Descargar",
  previous: "← Anterior",
  next: "Siguiente →",
  savedVideo: "Video guardado",

  // Login
  backToLanding: "← Volver a la página principal",

  // Gallery strip
  savedVideoGallery: "Galería de videos guardados",
  recentDownloads: "Descargas recientes, listas para explorar",
  successfulVideos:
    "Los videos exitosos se guardan aquí. Toca cualquier tarjeta para abrir su propia página de reproducción.",
  finishDownload:
    "Descarga un video de YouTube arriba y aparecerá aquí para reproducción.",
  playable: "Reproducible",
  openPage: "Abrir página",
  noPreview: "Sin vista previa",
  readyToPlay: "Listo para reproducir",
  noPlayableUrl: "No hay una URL reproducible almacenada para este video aún.",
};

const dictionaries: Record<Locale, DictionaryShape> = { en, es };

export type Dictionary = DictionaryShape;

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? dictionaries[defaultLocale];
}

export function getLocaleFromPathname(pathname: string): Locale {
  if (pathname === "/es" || pathname.startsWith("/es/")) {
    return "es";
  }
  return "en";
}

/** Return the locale-prefixed path (no prefix for English) */
export function localePath(locale: Locale, path: string): string {
  if (locale === "en") return path;
  // Avoid double /es prefix
  if (path.startsWith("/es")) return path;
  return `/es${path}`;
}
