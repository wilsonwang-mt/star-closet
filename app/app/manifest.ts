import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Star Closet",
    short_name: "Star Closet",
    description: "把主理人的一整套穿搭，改成适合你、买得起的那一套。",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f1e8",
    theme_color: "#f6f1e8",
    lang: "zh-CN",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
