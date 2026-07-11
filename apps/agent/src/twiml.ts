import type { CallerSource } from "./tools/callerLookup";

/**
 * TwiML for the inbound-call webhook (REMY_SPEC.md §9). Returns
 * <Connect><ConversationRelay …> so Twilio hands the call to our WS server.
 *
 * Attribute names verified against Twilio's ConversationRelay docs (rule 7):
 * url (required, wss://), welcomeGreeting, interruptible, and <Parameter> to
 * pass custom session parameters. Voice/ttsProvider left at provider defaults
 * (ElevenLabs) here; P5 picks a specific warm voice.
 */

const AGENCY = "Sunrise Home Health";

export function buildGreeting(source: CallerSource | null): string {
  if (source?.contact_name) {
    const first = source.contact_name.split(" ")[0];
    return `Thanks for calling ${AGENCY} — hi ${first}, this is Remy. Do you have a referral from ${source.org_name} for us?`;
  }
  return `You've reached ${AGENCY}'s referral line, this is Remy. I can take your referral right now — who am I speaking with?`;
}

function escapeXml(s: string): string {
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
  const param = opts.sourceId
    ? `\n      <Parameter name="source_id" value="${escapeXml(opts.sourceId)}" />`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${escapeXml(opts.wssUrl)}" welcomeGreeting="${escapeXml(
      opts.greeting
    )}" interruptible="speech">${param}
    </ConversationRelay>
  </Connect>
</Response>`;
}
