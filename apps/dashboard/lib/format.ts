/** Small formatting helpers. Phone/zip/latency are always mono in the UI. */

const DISCIPLINE_WORDS: Record<string, string> = {
  RN: "Skilled Nursing",
  PT: "Physical Therapy",
  OT: "Occupational Therapy",
  ST: "Speech Therapy",
  HHA: "Home Health Aide",
  MSW: "Medical Social Work",
};

export function disciplineLabel(code: string | null): string {
  if (!code) return "—";
  return DISCIPLINE_WORDS[code] ?? code;
}

/** E.164 / digit string → grouped, e.g. +12015550142 → +1 201 555 0142. */
export function formatPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return phone;
}

export function durationLabel(startISO: string, endMs: number): string {
  const start = new Date(startISO).getTime();
  const secs = Math.max(0, Math.floor((endMs - start) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function timeAgo(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function isRecent(iso: string | null, nowMs: number, windowMs: number): boolean {
  if (!iso) return false;
  return nowMs - new Date(iso).getTime() <= windowMs;
}
