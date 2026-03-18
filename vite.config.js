import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isElectron = process.env.BUILD_TARGET === 'electron';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: isElectron ? './' : '/hikari-oa/',
  server: {
    port: 5173,
    strictPort: true,
  },
})
