import type { MetadataRoute } from "next";
import { LOCALE_META } from "@/lib/i18n/config";
import { getLocale, tFor } from "@/lib/i18n/server";

// 清单按访客语言输出（D70）。
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const locale = await getLocale();
  const t = tFor(locale, "meta");
  return {
    name: "SEEN.",
    short_name: "SEEN.",
    description: t("manifestDescription"),
    start_url: "/",
    display: "standalone",
    background_color: "#0b0d10",
    theme_color: "#0b0d10",
    lang: LOCALE_META[locale].htmlLang,
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
