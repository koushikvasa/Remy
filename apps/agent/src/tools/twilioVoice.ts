import twilio from "twilio";
import type { Twilio } from "twilio";

/**
 * Twilio outbound-call wrapper (P6). Guarded: places a call only when creds are
 * present, never throws (a callout failure must never affect the inbound call
 * path — rules 4/5). Verified vs Twilio docs (rule 7):
 * client.calls.create({ to, from, url, method }) → { sid }.
 */

let _client: Twilio | null = null;

export function voiceEnabled(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
  );
}

function client(): Twilio {
  if (!_client) {
    _client = twilio(
      process.env.TWILIO_ACCOUNT_SID as string,
      process.env.TWILIO_AUTH_TOKEN as string
    );
  }
  return _client;
}

export interface CallResult {
  ok: boolean;
  sid?: string;
  error?: string;
}

/** Place an outbound call. `url` is the TwiML webhook Twilio fetches on answer. */
export async function startCall(to: string, url: string): Promise<CallResult> {
  if (!voiceEnabled()) return { ok: false, error: "voice_disabled" };
  if (!to) return { ok: false, error: "no_recipient" };
  try {
    const call = await client().calls.create({
      to,
      from: process.env.TWILIO_FROM_NUMBER as string,
      url,
      method: "POST",
    });
    return { ok: true, sid: call.sid };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
