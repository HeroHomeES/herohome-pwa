import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Herohome',
        short_name: 'Herohome',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2E5EA1',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' }
        ]
      }
    })
  ],
})
