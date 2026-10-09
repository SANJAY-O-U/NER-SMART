/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // NER SMART brand orange. Reserved for the logo mark only: orange
        // also carries a SEMANTIC meaning in this UI (DISRUPTED), so it must
        // not be used as a generic accent or action color.
        brand: {
          50: "#FFF3EA",
          100: "#FEE3CC",
          200: "#FDC79A",
          300: "#FAA666",
          400: "#F58F45",
          500: "#EF7B26",
          600: "#D9670F",
          700: "#B4530C",
        },

        // Primary / action / information color.
        primary: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
        },

        // Semantic operational states. Every strong color in the UI should
        // map to one of these meanings (see src/theme/status.js):
        //   ok       -> accessible / healthy / low risk
        //   warn     -> at risk / warning / medium
        //   disrupt  -> disrupted
        //   block    -> blocked / critical / high
        //   neutral  -> unknown / stale / not verified (never implies "fine")
        ok: { 50: "#ecfdf5", 100: "#d1fae5", 200: "#a7f3d0", 500: "#10b981", 600: "#059669", 700: "#047857" },
        warn: { 50: "#fffbeb", 100: "#fef3c7", 200: "#fde68a", 500: "#f59e0b", 600: "#d97706", 700: "#b45309" },
        disrupt: { 50: "#fff7ed", 100: "#ffedd5", 200: "#fed7aa", 500: "#f97316", 600: "#ea580c", 700: "#c2410c" },
        block: { 50: "#fef2f2", 100: "#fee2e2", 200: "#fecaca", 500: "#ef4444", 600: "#dc2626", 700: "#b91c1c", 800: "#991b1b" },
        neutral: { 50: "#f8fafc", 100: "#f1f5f9", 200: "#e2e8f0", 300: "#cbd5e1", 400: "#94a3b8", 500: "#64748b", 600: "#475569", 700: "#334155" },
      },
      borderRadius: {
        DEFAULT: "8px",
      },
      fontSize: {
        // Compact operational label size used across dense panels.
        "2xs": ["0.75rem", { lineHeight: "1rem" }],
      },
      boxShadow: {
        panel: "0 1px 2px 0 rgb(15 23 42 / 0.05)",
        raised: "0 4px 12px -2px rgb(15 23 42 / 0.12)",
      },
    },
  },
  plugins: [],
};
