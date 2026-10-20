import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/app/',
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Force code-splitting of WalletConnect + qrcode into separate chunks so the
    // QR flow keeps working (dynamic import of universal-provider must not be inlined
    // into the main bundle).
    rolldownOptions: {
      output: {
        // compat: also honor rollup-style manualChunks for splitting heavy deps
        manualChunks(id: string) {
          if (id.includes('@walletconnect') || id.includes('@noble/curves') || id.includes('@noble/hashes')) {
            return 'walletconnect'
          }
          if (id.includes('/qrcode/')) {
            return 'qrcode'
          }
        },
        codeSplitting: {
          groups: [
            {
              name: 'walletconnect',
              test: /([\\/]@walletconnect[\\/]|universal-provider|walletconnect-relay|walletconnect-utils)/,
              priority: 30,
            },
            {
              name: 'qrcode',
              test: /[\\/]node_modules[\\/]qrcode[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
})