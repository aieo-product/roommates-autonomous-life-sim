import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target:
          (
            globalThis as typeof globalThis & {
              process?: { env?: Record<string, string | undefined> };
            }
          ).process?.env?.VITE_API_TARGET ?? "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
