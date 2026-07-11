import type { Config } from "tailwindcss";

/**
 * Remy Command Center design tokens (P4 design brief + theming pass).
 *
 * Colors are CSS variables (space-separated RGB channels) resolved through
 * `rgb(var(--x) / <alpha-value>)`, so every `bg-signal/10`, `text-muted`,
 * `border-hairline` keeps working AND flips between the dark and light themes.
 * The channel values live in globals.css (`:root` = dark, `[data-theme=light]`).
 *
 * Still one signal-green accent, amber for escalations, red for failures.
 * Data is always mono.
 */
const withAlpha = (varName: string) => `rgb(var(${varName}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: withAlpha("--color-base"), // page base
        panel: withAlpha("--color-panel"), // panel surface
        hairline: withAlpha("--color-hairline"), // hairline borders
        ink: withAlpha("--color-ink"), // primary text
        muted: withAlpha("--color-muted"), // secondary text
        signal: withAlpha("--color-signal"), // the ONE accent — accepted / live
        amber: withAlpha("--color-amber"), // escalations only
        danger: withAlpha("--color-danger"), // failures only
        focus: withAlpha("--color-focus"), // keyboard focus ring
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
        md: "8px",
        lg: "10px",
        full: "9999px",
      },
      boxShadow: {
        // Accent glow — adapts to the active theme's signal color.
        glow: "0 0 0 1px rgb(var(--color-signal) / 0.35), 0 0 18px -6px rgb(var(--color-signal) / 0.45)",
        // Soft panel lift — carries the light theme, near-invisible on dark.
        panel: "0 1px 2px rgb(var(--shadow-rgb) / 0.04), 0 6px 16px -8px rgb(var(--shadow-rgb) / 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
