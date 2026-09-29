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
    // Phase 10.5.3: every VITE_* value is inlined into public JS, so a
    // build must never see the backend write key. Production dashboards
    // are read-only; VITE_API_KEY is for `vite dev` (local) only.
    if ((env.VITE_API_KEY || "").trim()) {
      throw new Error(
        "VITE_API_KEY is set, but it must never be present in a build: VITE_* variables are bundled into " +
          "public JavaScript, which would expose the backend NER_API_KEY. Remove VITE_API_KEY from the build " +
          "environment (Vercel project settings and frontend/.env). For local development, put it in " +
          "frontend/.env.development.local, which `vite build` does not load."
      );
    }
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
    },
  };
});
