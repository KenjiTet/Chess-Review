import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forward all /api requests to the local FastAPI backend.
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        // Required for SSE (EventSource) streaming to work through the proxy.
        ws: false,
      },
    },
  },
})
