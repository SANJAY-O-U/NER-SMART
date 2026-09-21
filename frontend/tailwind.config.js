/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // NER SMART design system — the single source of truth for brand
      // color. Components reference `brand-*` instead of arbitrary hex
      // codes so the orange accent stays consistent everywhere.
      colors: {
        brand: {
          50: "#FFF3EA",
          100: "#FEE3CC",
          200: "#FDC79A",
          300: "#FAA666",
          400: "#F58F45",
          500: "#EF7B26", // NER orange — primary/action color
          600: "#D9670F",
          700: "#B4530C",
        },
      },
      borderRadius: {
        DEFAULT: "8px",
      },
    },
  },
  plugins: [],
};
