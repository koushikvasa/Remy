import { FitResult, ReferralDraft } from "@remy/shared";
import { checkServiceArea } from "../tools/serviceArea";
import { checkPayer } from "../tools/payer";
import { checkCapacity } from "../tools/capacity";
import { logEvent } from "../telemetry";
import { DRAFT_FIELDS } from "./extractor";

/**
 * FitChecker (REMY_SPEC.md §4/§7) — NOT an LLM. Runs the three DB tools in
 * parallel and assembles a FitResult. `all_green` requires three real yeses.
 *
 * When a runId is passed it emits one run_event per tool (for the dashboard's
 * check chips) plus a fit summary event.
 */

export interface FitCheckOutput {
  fit: FitResult;
  payerMatchedId: string | null;
}

async function timedTool<T>(
  name: string,
  runId: string | undefined,
  work: Promise<T>
): Promise<T> {
  const started = Date.now();
  const result = await work;
  if (runId) {
    await logEvent({
      runId,
      stage: "DECIDING",
      subAgent: "fitchecker",
      toolName: name,
      latencyMs: Date.now() - started,
      payload: { result },
    });
  }
  return result;
}

export async function runFitCheck(
  draft: ReferralDraft,
  runId?: string
): Promise<FitCheckOutput> {
  const missing_fields = DRAFT_FIELDS.filter(
    (f) => draft[f] === null || draft[f] === undefined
  ).map((f) => f as string);

  const [area, payer, capacity] = await Promise.all([
    timedTool("serviceArea", runId, checkServiceArea(draft.zip)),
    timedTool("payer", runId, checkPayer(draft.payer_raw)),
    timedTool("capacity", runId, checkCapacity(draft.discipline_needed)),
  ]);

  const fit: FitResult = FitResult.parse({
    zip_covered: area.covered,
    payer_accepted: payer.accepted,
    payer_matched_name: payer.matchedName,
    capacity_available: capacity.available,
    open_slots: capacity.openSlots,
    all_green:
      area.covered === true &&
      payer.accepted === true &&
      capacity.available === true,
    missing_fields,
  });

  if (runId) {
    await logEvent({
      runId,
      stage: "DECIDING",
      subAgent: "fitchecker",
      payload: { fit },
    });
  }

  return { fit, payerMatchedId: payer.matchedId };
}
