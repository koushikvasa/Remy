import { supabase } from "../db";

/**
 * payer tool (REMY_SPEC.md §4) — is the caller's insurance accepted?
 * Matches the raw payer string against payers.name + payers.aliases.
 *
 * Matching is exact-first (so "Medicare" hits the Medicare row, not "Aetna
 * Medicare Advantage"), then longest whole-key containment. Unrecognized payer →
 * accepted=null (unknown), which the gate treats as not-all-green (safe).
 */

export interface PayerResult {
  accepted: boolean | null;
  matchedName: string | null;
  matchedId: string | null;
}

interface PayerRow {
  id: string;
  name: string;
  aliases: string[] | null;
  accepted: boolean;
}

const UNMATCHED: PayerResult = { accepted: null, matchedName: null, matchedId: null };

function toResult(p: PayerRow): PayerResult {
  return { accepted: p.accepted, matchedName: p.name, matchedId: p.id };
}

export async function checkPayer(payerRaw: string | null): Promise<PayerResult> {
  if (!payerRaw) return UNMATCHED;

  const { data, error } = await supabase()
    .from("payers")
    .select("id, name, aliases, accepted");

  if (error) throw new Error(`payer lookup failed: ${error.message}`);
  const rows = (data ?? []) as PayerRow[];

  const norm = payerRaw.toLowerCase().replace(/\s+/g, " ").trim();
  const candidates = rows.map((p) => ({
    p,
    keys: [p.name, ...(p.aliases ?? [])].map((s) => s.toLowerCase().replace(/\s+/g, " ").trim()),
  }));

  // 1. exact match on name or alias
  for (const c of candidates) {
    if (c.keys.includes(norm)) return toResult(c.p);
  }

  // 2. the caller's phrase contains a known key — prefer the longest key
  let best: PayerRow | null = null;
  let bestLen = 0;
  for (const c of candidates) {
    for (const k of c.keys) {
      if (k.length >= 4 && norm.includes(k) && k.length > bestLen) {
        best = c.p;
        bestLen = k.length;
      }
    }
  }
  if (best) return toResult(best);

  return UNMATCHED;
}
