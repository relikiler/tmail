import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Build for Tauri desktop: relative asset paths (works under tauri://localhost)
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-tauri',
  },
})