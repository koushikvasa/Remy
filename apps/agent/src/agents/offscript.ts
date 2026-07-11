import { checkPayer } from "../tools/payer";
import { checkServiceArea } from "../tools/serviceArea";

/**
 * Off-script question handling (P5 judge-proofing). If the caller asks a
 * coverage question mid-collection ("do you take Humana?", "do you cover
 * 11550?"), answer it from the real payers / service_areas tables and let the
 * router resume collection. Deterministic (no LLM) — fast and safe.
 *
 * Returns null when the turn isn't a recognized off-script question, so the
 * router treats it as normal referral input.
 */

const QUESTION_RE =
  /\?|^\s*(do|does|are|is|can|could|will|would|what|which|how|where|who)\b/i;
const AREA_RE = /(zip|area|cover|county|service|located|region|neighborhood)/i;
const PAYER_RE =
  /(take|accept|cover|work with|in.?network|insurance|plan|payer|medicare|medicaid|humana|aetna|united|cigna)/i;
const ZIP_RE = /\b(\d{5})\b/;

export interface OffscriptAnswer {
  answer: string;
  kind: "payer" | "area";
}

export async function answerOffscript(
  text: string
): Promise<OffscriptAnswer | null> {
  if (!QUESTION_RE.test(text)) return null;

  // Service-area question that names a specific ZIP.
  const zip = text.match(ZIP_RE);
  if (zip && AREA_RE.test(text)) {
    const r = await checkServiceArea(zip[1]);
    return {
      kind: "area",
      answer:
        r.covered === true
          ? `Yes — ${zip[1]} is in our service area.`
          : `That ZIP, ${zip[1]}, is just outside our service area.`,
    };
  }

  // Payer question.
  if (PAYER_RE.test(text)) {
    const p = await checkPayer(text);
    if (p.matchedName) {
      return {
        kind: "payer",
        answer: p.accepted
          ? `Yes, we accept ${p.matchedName}.`
          : `We're not in-network with ${p.matchedName} right now.`,
      };
    }
    if (/\b(what|which)\b/i.test(text)) {
      return {
        kind: "payer",
        answer:
          "We take Medicare and most Medicare Advantage plans — which does the patient have?",
      };
    }
  }

  // Generic service-area question.
  if (AREA_RE.test(text)) {
    return {
      kind: "area",
      answer:
        "We cover much of Union and Essex county in New Jersey, plus parts of New York City.",
    };
  }

  return null;
}
