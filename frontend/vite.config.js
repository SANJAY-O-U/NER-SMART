import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  // Phase 7A: src/services/api.js falls back to http://localhost:5000/api
  // when VITE_API_BASE_URL is unset — fine for `npm run dev`, wrong for a
  // deployable bundle. Fail the build instead of shipping that fallback.
  if (command === "build") {
    const env = loadEnv(mode, process.cwd(), "VITE_");
    if (!env.VITE_API_BASE_URL) {
      throw new Error(
        "VITE_API_BASE_URL is not set. Set it (e.g. https://<backend-host>/api) in the build environment or frontend/.env before building."
      );
    }
    if (!env.VITE_API_KEY) {
      console.warn("[vite] VITE_API_KEY is not set — dashboard write actions will be rejected by the backend.");
    }
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
    },
  };
});
