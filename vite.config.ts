import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset URLs so the built app works both at a domain root and
  // under a sub-path such as GitHub Pages' https://user.github.io/repo/
  base: './',
  server: {
    host: true, // Allow phone access via local IP
    port: 5173,
  },
  build: {
    // Split large dependencies into separate chunks to keep initial load small
    rollupOptions: {
      output: {
        manualChunks: {
          // WebGPU model and large UI libraries are heavy
          webllm: ['@mlc-ai/web-llm'],
          leaflet: ['leaflet'],
          lucide: ['lucide-react'],
        },
      },
    },
    // Increase warning limit because the main chunk will still be sizable
    chunkSizeWarningLimit: 800,
  },
});

