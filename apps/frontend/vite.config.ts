import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * PWA setup (Marketplace-style):
 * - Static Web App Manifest: public/manifest.webmanifest (linked from index.html)
 * - Service worker: generated as /sw.js by vite-plugin-pwa + registered in main.tsx
 * - display:standalone + icons → Chrome/Android installable app; iOS Add to Home Screen via apple meta
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Manifest lives in public/manifest.webmanifest (explicit Marketplace-style file).
      manifest: false,
      includeAssets: [
        "favicon.png",
        "favicon-32.png",
        "favicon-48.png",
        "icons/icon-180.png",
        "icons/icon-192.png",
        "icons/icon-512.png"
      ],
      workbox: {
        navigateFallback: "/index.html",
        // App shell JS exceeds Workbox's default 2 MiB precache cap.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Bundled hashed copy is huge; public favicons are the install icon source.
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
