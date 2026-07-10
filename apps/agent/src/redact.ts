/**
 * redact.ts — the PHI gate (CLAUDE.md hard rule 3, REMY_SPEC.md §5).
 *
 * EVERYTHING written to run_events.payload passes through redactPayload().
 * run_events.payload must never contain full names, DOB, MRN, or full addresses.
 * The patient is only ever referenced as first initial + age, both of which are
 * explicitly allowed.
 *
 * This is a safety net: payloads are already constructed to be PHI-safe, but the
 * redactor enforces it so a careless log call can't leak.
 */

// Keys whose presence signals patient identity / protected data. Dropped wholesale.
// NOTE: substrings, matched case-insensitively. "patient_first_initial" and
// "patient_age" do NOT contain any of these, so they survive.
const DENY_KEY_SUBSTRINGS = [
  "patient_name",
  "full_name",
  "first_name",
  "last_name",
  "lastname",
  "firstname",
  "dob",
  "date_of_birth",
  "birth",
  "mrn",
  "ssn",
  "social_security",
  "address",
  "street",
  "email",
];

const REDACTED = "[REDACTED]";

// 6+ consecutive digits (phone / MRN / DOB-ish). ZIP (5) and age (<=3) are shorter.
const LONG_NUMBER = /\d[\d\s().-]{5,}\d/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const DATE_LIKE = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g;

function scrubText(s: string): string {
  return s
    .replace(EMAIL, REDACTED)
    .replace(DATE_LIKE, REDACTED)
    .replace(LONG_NUMBER, REDACTED);
}

function isDeniedKey(key: string): boolean {
  const k = key.toLowerCase();
  return DENY_KEY_SUBSTRINGS.some((sub) => k.includes(sub));
}

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isDeniedKey(k)) continue; // drop the whole key
      out[k] = redactValue(v);
    }
    return out;
  }
  return value;
}

/** Redact an arbitrary payload before it is written to run_events. */
export function redactPayload(payload: unknown): unknown {
  return redactValue(payload);
}

/** Scrub a free-text string (e.g. a transcript summary) for PHI-ish patterns. */
export function redactText(text: string): string {
  return scrubText(text);
}
