import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api/accounts": { target: "http://account-api:4242", changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/accounts/, "/account") },
      "/api/health": { target: "http://account-api:4242", changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/health/, "/health") },
      "/api/services": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
});
