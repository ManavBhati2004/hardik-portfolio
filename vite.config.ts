import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.glsl'],
  server: {
    watch: {
      ignored: ['**/scripts/**', '**/chrome_tmp_profile/**'],
    },
  },
})
