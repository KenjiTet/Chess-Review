import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// npm sets npm_package_version from package.json when running any npm script, so
// the footer can display the deployed app version without importing package.json.
const appVersion = process.env.npm_package_version ?? '0.0.0'

export default defineConfig({
  // Expose the package version to the client bundle for the footer.
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    // PWA layer: installable on iOS/Android home screen, auto-updates on each deploy.
    VitePWA({
      // autoUpdate fetches the new service worker on each visit and swaps it in,
      // so the home-screen app always reflects the latest Railway deploy.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon-32.png', 'favicon-48.png', 'favicon-96.png', 'favicon-256.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'BlunderDrill — Chess Blunder Trainer',
        short_name: 'BlunderDrill',
        description: 'Train on your own chess blunders.',
        theme_color: '#863bff',
        background_color: '#863bff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png?v=12', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png?v=12', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512x512.png?v=12', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the built app shell (JS/CSS/HTML/icons) for instant launch.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Some background/logo PNGs are >2 MiB; raise the cap so they precache.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Never let the service worker serve API or SSE responses from cache —
        // analysis and the build-stream must always hit the live backend.
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  server: {
    proxy: {
      // Forward all /api requests to the local FastAPI backend.
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        // Required for SSE (EventSource) streaming to work through the proxy.
        ws: false,
      },
    },
  },
})
