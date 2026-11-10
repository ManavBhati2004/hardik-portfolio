import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",                 // top-level await in main.js
    chunkSizeWarningLimit: 900,       // three is ~600 kB min; ship it as its own long-cached chunk
    rollupOptions: {
      output: { manualChunks: (id) => (id.includes("node_modules/three") ? "three" : undefined) },
    },
  },
  server: { port: 5178 },
});
