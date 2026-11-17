import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.png",
        "favicon-32.png",
        "favicon-48.png",
        "icons/icon-180.png",
        "icons/icon-192.png",
        "icons/icon-512.png"
      ],
      manifest: {
        name: "aabanker — Banking Management System",
        short_name: "aabanker",
        description: "Install aabanker on desktop or mobile and use it like a native app.",
        theme_color: "#0b0e14",
        background_color: "#0b0e14",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        lang: "en",
        categories: ["finance", "business"],
        icons: [
          {
            src: "/favicon.png",
            sizes: "1254x1254",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        navigateFallback: "/index.html",
        // App shell JS exceeds Workbox's default 2 MiB precache cap.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,webmanifest}"],
        // Bundled hashed copy is huge; public/favicon.png is the install icon source.
        globIgnores: ["**/favIconBms-*.png"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly"
          }
        ]
      },
      devOptions: {
        enabled: true
      }
    })
  ],
  resolve: {
    alias: {
      // Prefer shared source during local dev so catalog/nav changes apply without a stale dist.
      "@bms/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts")
    }
  },
  server: {
    port: 5174,
    fs: {
      allow: [path.resolve(__dirname, "../..")]
    }
  },
  optimizeDeps: {
    exclude: ["@bms/shared"]
  }
});
