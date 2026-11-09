import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dose",
    short_name: "Dose",
    description: "Record a morning, afternoon, or night dose and keep the pill count.",
    start_url: "/",
    display: "standalone",
    background_color: "#e7e1d6",
    theme_color: "#e7e1d6",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
