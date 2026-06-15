"use client";

import Link from "next/link";
import { useCallback, useState, useEffect } from "react";
import Image from "next/image";
import { VideoDownloadPanel } from "@/components/download/video-download-panel";
import { getDictionary, localePath, type Locale } from "@/lib/i18n";
import { recognizeVideoUrl } from "@/lib/video-links";
import { SocialLoginButtons } from "@/components/auth/social-login-buttons";


const platforms = ["YouTube", "TikTok", "Instagram", "X", "Facebook", "Vimeo", "Reddit", "Redgifs"];

export default function HomeContent({ locale = "en" }: { locale?: Locale }) {
  const t = getDictionary(locale);
  const [pastedUrl, setPastedUrl] = useState<string | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);

  const howItWorks = [
    {
      title: t.howItWorksStepOneTitle,
      description: t.howItWorksStepOneDescription,
    },
    {
      title: t.howItWorksStepTwoTitle,
      description: t.howItWorksStepTwoDescription,
    },
    {
      title: t.howItWorksStepThreeTitle,
      description: t.howItWorksStepThreeDescription,
    },
  ];

  // When a new valid link is pasted, always replace the previous input
  const handlePasteUrl = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text?.trim();
      if (!trimmed) return;
      const result = recognizeVideoUrl(trimmed);
      if (result.recognized) {
        // Always replace previous input
        setPastedUrl(trimmed);
      } else {
        document.getElementById("download")?.scrollIntoView({ behavior: "smooth" });
      }
    } catch {
      alert("Clipboard access failed. Please make sure your browser allows clipboard access and you are using HTTPS or localhost. You can also paste manually.");
      document.getElementById("download")?.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  // Allow CTRL+V to paste clipboard as video URL
  useEffect(() => {
    const onPaste = async (event: ClipboardEvent) => {
      // Only handle if not in an input/textarea
      const target = event.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const pasted = event.clipboardData?.getData("text");
      if (pasted) {
        const trimmed = pasted.trim();
        if (!trimmed) return;
        const result = recognizeVideoUrl(trimmed);
        if (result.recognized) {
          // Always replace previous input
          setPastedUrl(trimmed);
          event.preventDefault();
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  return (
    <>
      {showProfileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-neutral-900 rounded-xl shadow-xl p-6 w-full max-w-xs relative">
            <button
              className="absolute top-2 right-2 text-white/60 hover:text-white text-xl cursor-pointer"
              onClick={() => setShowProfileModal(false)}
              aria-label="Close"
            >
              ×
            </button>
            <SocialLoginButtons />
          </div>
        </div>
      )}
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-3 sm:px-10 lg:px-12">
        <nav className="mb-3 flex items-center justify-between rounded-full border-none px-2 py-0 backdrop-blur sm:px-6">
          <div>
            <Link href={localePath(locale, "/")}>
            <Image src="/z.svg" alt="ZVYX logo" className="h-6 w-auto" width={24} height={24} />
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePasteUrl}
              className="cursor-pointer rounded-full border border-white/10 p-2 text-sm font-medium text-slate-100 transition hover:bg-white/5"
            >
              <Image src="/paste.svg" alt={t.paste} className="h-5 w-5 " width={20} height={20} />
            </button>
          </div>
        </nav>

        <section className="relative space-y-8 pt-8 rounded-lg">
        <div
          className="pointer-events-none rounded-lg absolute inset-0 -z-10 bg-cover bg-center bg-no-repeat opacity-50"
          aria-hidden="true"
        />
        <div className="space-y-6 text-center">
          <div className="inline-flex rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200">
            {t.badge}
          </div>

          <div className="space-y-4">
            <h1 className="mx-auto max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
              {t.heroTitle}
            </h1>
            <p className="mx-auto max-w-2xl text-base text-slate-300 sm:text-lg">
              {t.heroDescription}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {platforms.map((platform) => (
              <span
                key={platform}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200"
              >
                {platform}
              </span>
            ))}
          </div>

        </div>

        <VideoDownloadPanel locale={locale} pastedUrl={pastedUrl} onPastedUrlConsumed={() => setPastedUrl(null)} />
      </section>

      <section className="mt-14 border-t border-white/10 pt-10">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.4fr] lg:items-start">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
              ZVYX
            </p>
            <h2 className="text-2xl font-semibold text-white sm:text-3xl">
              {t.howItWorksTitle}
            </h2>
            <p className="max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
              {t.howItWorksDescription}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {howItWorks.map((item, index) => (
              <article
                key={item.title}
                className="rounded-lg border border-white/10 bg-white/[0.03] p-4"
              >
                <div className="mb-4 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/10 text-sm font-semibold text-emerald-200">
                  {index + 1}
                </div>
                <h3 className="text-sm font-semibold text-white">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="mt-auto flex flex-col gap-4 border-t border-white/10 py-8 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <p>{t.footerTagline}</p>
        <div className="flex flex-wrap items-center gap-4">
          <a
            href="https://github.com/zuyux/zvyx"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-slate-200 transition hover:text-emerald-200"
          >
            {t.openSource}
          </a>
        </div>
      </footer>


      {/* Absolutely positioned +18 switch for the whole app */}
      <div className="fixed left-4 bottom-4 z-50">
        {/* The NSFW switch UI will be rendered here by DownloadHistoryStrip, so remove it from the strip and render it here instead if you want only one global switch. */}
      </div>

    </main>
    </>
  );
}
