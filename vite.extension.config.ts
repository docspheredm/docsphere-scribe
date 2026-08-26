import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Separate build for the Chrome extension: side panel + options page (React)
// plus the background service worker, all emitted with predictable filenames
// so extension-src/manifest.json can reference them directly.
export default defineConfig({
  root: resolve(__dirname, 'extension-src'),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist-extension'),
    sourcemap: false,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'extension-src/sidepanel.html'),
        options: resolve(__dirname, 'extension-src/options.html'),
        background: resolve(__dirname, 'extension-src/background.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
