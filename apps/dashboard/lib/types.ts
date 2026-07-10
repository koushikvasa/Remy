import type { ReferralDraft } from "@remy/shared";

/** Row shapes (subset of supabase/migrations/0001_init.sql we read). */

export type RunStatus = "active" | "completed" | "failed" | "escalated";

export interface RunRow {
  run_id: string;
  caller_phone: string | null;
  source_id: string | null;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
}

export interface RunEventRow {
  id: number;
  run_id: string;
  seq: number;
  stage: string | null;
  sub_agent: string | null;
  tool_name: string | null;
  latency_ms: number | null;
  confidence: number | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface ReferralRow {
  id: string;
  run_id: string | null;
  patient_first_initial: string | null;
  patient_age: number | null;
  diagnosis_summary: string | null;
  discipline_needed: string | null;
  payer_raw: string | null;
  zip: string | null;
  requested_start: string | null;
  decision: "accepted" | "escalated" | "declined" | null;
  reason_code: string | null;
  callback_phone: string | null;
  created_at: string;
}

export interface SourceRow {
  id: string;
  phone: string;
  org_name: string;
  contact_name: string | null;
  org_type: string | null;
}

export type { ReferralDraft };
