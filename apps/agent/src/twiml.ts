import type { CallerSource } from "./tools/callerLookup";

/**
 * TwiML for the inbound-call webhook (REMY_SPEC.md §9). Returns
 * <Connect><ConversationRelay …> so Twilio hands the call to our WS server.
 *
 * Attribute names verified against Twilio's ConversationRelay docs (rule 7):
 * url (required, wss://), welcomeGreeting, voice, ttsProvider, interruptible,
 * events, and <Parameter> for custom session parameters.
 *
 * Voice: ElevenLabs. Default REMY_VOICE = "XrExE9yKIg1WjnnlVkGX" (Matilda — a
 * warm, natural female voice used in Twilio's CR examples). Override with the
 * REMY_VOICE env var (any ElevenLabs voice id; supports id-model and
 * id-speed_stability_similarity forms).
 */

const AGENCY = "Sunrise Home Health";
const DEFAULT_VOICE = "XrExE9yKIg1WjnnlVkGX"; // ElevenLabs "Matilda"

export function buildGreeting(source: CallerSource | null): string {
  if (source?.contact_name) {
    const first = source.contact_name.split(" ")[0];
    return `${AGENCY} — hi ${first}, it's Remy. Do you have a referral for us?`;
  }
  return `${AGENCY} referral line, this is Remy — I can take your referral right now.`;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function twimlConnect(opts: {
  wssUrl: string;
  greeting: string;
  sourceId: string | null;
}): string {
  const voice = process.env.REMY_VOICE || DEFAULT_VOICE;
  const param = opts.sourceId
    ? `\n      <Parameter name="source_id" value="${escapeXml(opts.sourceId)}" />`
    : "";

  // events="tokens-played" lets the server auto-hang up after TTS finishes
  // (REMY_AUTO_END); harmless when the flag is off.
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${escapeXml(opts.wssUrl)}" welcomeGreeting="${escapeXml(
      opts.greeting
    )}" ttsProvider="ElevenLabs" voice="${escapeXml(
      voice
    )}" interruptible="speech" events="tokens-played">${param}
    </ConversationRelay>
  </Connect>
</Response>`;
}
