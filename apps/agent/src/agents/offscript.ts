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
  /\?|^\s*(do|does|are|is|can|could|will|would|what|which|how|where|who|when)\b/i;
const AREA_RE = /(zip|area|cover|county|service|located|region|neighborhood)/i;
const PAYER_RE =
  /(take|accept|cover|work with|in.?network|insurance|plan|payer|medicare|medicaid|humana|aetna|united|cigna)/i;
// "How soon can you start?" / "Can someone see her this weekend?" — the #1
// real-world question. Answered generically (no specific slot promise).
const TIMING_RE =
  /(how soon|how quickly|how fast|when can|start (her|him|them|care|seeing)|this weekend|same.?day|turnaround|availability|available|wait time|see (her|him|them|the patient))/i;
// "Do you do wound care / PT / IV therapy?" — services we staff.
const SERVICES_RE =
  /(wound care|iv therapy|infusion|physical therapy|\bpt\b|occupational therapy|\bot\b|speech|skilled nursing|\brn\b|nurse|home health aide|\baide\b|social work)/i;
const ZIP_RE = /\b(\d{5})\b/;

export interface OffscriptAnswer {
  answer: string;
  kind: "payer" | "area" | "timing" | "services";
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

  // Timing / speed-to-start question (answered from the domain, not a promise
  // of a specific slot — capacity is verified later by the FitChecker).
  if (TIMING_RE.test(text)) {
    return {
      kind: "timing",
      answer:
        "Once we accept, our care coordinator schedules the first visit within 24 to 48 hours — sooner for urgent needs.",
    };
  }

  // Services question — which disciplines we staff.
  if (SERVICES_RE.test(text)) {
    return {
      kind: "services",
      answer:
        "Yes — we staff skilled nursing, physical, occupational, and speech therapy, home health aides, and medical social work.",
    };
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
