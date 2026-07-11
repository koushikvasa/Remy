"use client";

import { useState } from "react";

/**
 * Remy brand logo for the header. Renders the tightly-cropped, transparent
 * /remy-logo.png at its natural aspect. The wordmark is deep navy, so the logo
 * sits on a cream plate (matching its original artwork) to stay readable on the
 * dark theme and to blend into the cream light theme. Falls back to a styled
 * wordmark if the image is missing, so the header is never broken.
 *
 * Responsive: the logo scales by breakpoint via its height (width follows the
 * image aspect).
 */
export function Logo() {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
        Remy
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-md border border-hairline bg-[#F2F0EA] px-2.5 py-1.5 shadow-sm">
      <img
        src="/remy-logo.png"
        alt="Remy — 24/7 Referral Acceptance"
        onError={() => setFailed(true)}
        className="h-9 w-auto sm:h-11"
      />
    </span>
  );
}
