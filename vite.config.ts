import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'https://localhost:7081',
        secure: false,
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), tailwindcss()],
})
