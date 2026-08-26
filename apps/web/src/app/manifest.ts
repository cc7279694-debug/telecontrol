import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Codex Remote 远程控制",
    short_name: "Codex Remote",
    description: "安全连接 Windows 上的 Codex",
    start_url: "/hosts",
    display: "standalone",
    background_color: "#f4f6f8",
    theme_color: "#f4f6f8",
    lang: "zh-CN",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
