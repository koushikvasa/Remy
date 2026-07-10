import type { Config } from "tailwindcss";

/**
 * Remy Command Center design tokens (P4 design brief).
 * After-hours dispatch console: near-black blue-grey, ONE signal-green accent,
 * amber for escalations, red for failures. Data is always mono.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: "#0B0F14", // near-black blue-grey base
        panel: "#11161D", // panel surface
        hairline: "#1E2630", // hairline borders
        ink: "#E8EDF2", // primary text
        muted: "#8A94A3", // muted text
        signal: "#3DDC84", // the ONE accent — accepted / live
        amber: "#FFB454", // escalations only
        danger: "#FF5C5C", // failures only
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        none: "0",
        sm: "4px",
        DEFAULT: "6px",
        md: "6px",
        lg: "6px",
        full: "9999px",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(61,220,132,0.35), 0 0 18px -6px rgba(61,220,132,0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
