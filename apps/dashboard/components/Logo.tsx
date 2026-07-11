"use client";

import { useState } from "react";

/**
 * Remy brand logo for the header. Renders /remy-logo.png (drop the file into
 * apps/dashboard/public/). The image sits on a cream plate matching the logo's
 * own background so any surrounding whitespace reads as intentional in the dark
 * theme and blends into the cream light theme; object-cover trims the banner's
 * vertical margins. If the file is missing, it falls back to a styled wordmark
 * so the header is never broken.
 *
 * Responsive: the plate scales by breakpoint; the wordmark fallback scales too.
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
    <span className="inline-flex overflow-hidden rounded-md border border-hairline bg-[#F2F0EA] shadow-sm">
      <img
        src="/remy-logo.png"
        alt="Remy — 24/7 Referral Acceptance"
        onError={() => setFailed(true)}
        className="h-9 w-[128px] object-cover object-center sm:h-10 sm:w-[150px]"
      />
    </span>
  );
}
