/**
 * Callback-number normalization (P7.3 BUG 2). Callers say numbers as digits
 * ("201-555-0199") or spoken words ("two zero one, five five five, ..."), so we
 * extract digits from both, then coerce to E.164:
 *   10 digits           → +1XXXXXXXXXX
 *   11 digits, leading 1 → +1XXXXXXXXXX
 *   already +           → keep (+ and digits)
 *   otherwise          → return raw, ok=false (caller logs a warning; never blocks)
 */

const WORD_TO_DIGIT: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

function extractDigits(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let out = "";
  for (const t of tokens) {
    if (/^\d+$/.test(t)) out += t;
    else if (WORD_TO_DIGIT[t] !== undefined) out += WORD_TO_DIGIT[t];
    // non-numeric words are ignored ("call", "me", "at", ...)
  }
  return out;
}

export interface NormalizedPhone {
  phone: string; // E.164 when ok, else the raw input
  ok: boolean;
}

export function normalizeCallback(raw: string): NormalizedPhone {
  const trimmed = (raw ?? "").trim();
  const digits = extractDigits(trimmed);

  if (trimmed.startsWith("+")) {
    return { phone: "+" + digits, ok: digits.length >= 10 };
  }
  if (digits.length === 10) {
    return { phone: "+1" + digits, ok: true };
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return { phone: "+" + digits, ok: true };
  }
  return { phone: trimmed, ok: false }; // unparseable → keep raw
}
