"use client";

import { useEffect, useState } from "react";

/**
 * Dark/light theme control for the Command Center. Rendered as a segmented
 * two-option switch so it's clearly visible in BOTH themes and always shows the
 * active mode. The initial theme is set before paint by the inline script in
 * layout.tsx; this reads the resolved value on mount, flips `data-theme` on
 * <html>, and persists the choice. Fully keyboard-operable and labelled.
 */
type Theme = "dark" | "light";

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M12 2.5v2.5M12 19v2.5M4.4 4.4l1.8 1.8M17.8 17.8l1.8 1.8M2.5 12H5M19 12h2.5M4.4 19.6l1.8-1.8M17.8 6.2l1.8-1.8" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" fill="currentColor" />
    </svg>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) ?? "dark";
    setTheme(current === "light" ? "light" : "dark");
    setMounted(true);
  }, []);

  function apply(next: Theme) {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("remy-theme", next);
    } catch {
      /* storage unavailable — the in-session switch still works */
    }
    setTheme(next);
  }

  const options: { value: Theme; label: string; icon: JSX.Element }[] = [
    { value: "light", label: "Light", icon: <SunIcon /> },
    { value: "dark", label: "Dark", icon: <MoonIcon /> },
  ];

  return (
    <div
      role="group"
      aria-label="Color theme"
      className="inline-flex items-center gap-0.5 rounded-full border border-hairline bg-base/60 p-0.5"
    >
      {options.map((opt) => {
        // Before mount, don't mark either active — keeps hydration output stable.
        const active = mounted && theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => apply(opt.value)}
            aria-pressed={active}
            aria-label={`${opt.label} theme`}
            title={`${opt.label} theme`}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-signal/15 text-signal shadow-glow"
                : "text-muted hover:text-ink"
            }`}
          >
            {opt.icon}
            <span className="hidden sm:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
