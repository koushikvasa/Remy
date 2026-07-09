# REMY — Build Specification

**Remy answers your home-health agency's referral line 24/7 and says yes in seconds — safely.**

Hackathon: Healthcare Hack NYC (Arya Health × Twilio). Must use Twilio to qualify.
Repo: https://github.com/koushikvasa/Remy.git

---

## 1. Problem (the pitch in 4 sentences)

When a hospital discharges a patient to home health, the discharge planner sends the referral
to 3–5 agencies at once. Whichever agency accepts first — often within 30–60 minutes — wins the
patient. Referrals arrive by phone/fax/voicemail and die nights and weekends; agencies lose ~20%
of after-hours referrals, part of a $200–500M/yr industry "referral leakage" problem. Remy is a
voice AI agent that answers the referral line instantly, captures the referral as structured data,
checks fit against the agency's real data, and accepts on the spot — or escalates to a human with
everything pre-filled.

## 2. Hackathon requirements → how Remy satisfies each

| Requirement | Remy implementation |
|---|---|
| Telephony (Twilio, mandatory) | Twilio number + ConversationRelay is the entire voice path |
| Agent development framework | Router + 4 contract-bound sub-agents (Mavi-style architecture) |
| Model (TTS/STT) | ConversationRelay built-in STT (Deepgram) + TTS (ElevenLabs voice); LLM behind single `callModel()` |
| Knowledge base | Supabase: service areas, payers, capacity, acceptance policy — agent decides via tool calls, never guesses |
| Caller info / personalization | Caller-ID lookup in `referral_sources` BEFORE greeting; Remy greets the hospital + contact by name |
| Reliability / guardrails / security | Deterministic decision gate, readback confirmation, human escalation, PHI-redacted telemetry, live observability dashboard |

## 3. Architecture

```
Caller (discharge planner)
   │  PSTN
   ▼
Twilio Number ──► Voice webhook (agent server, HTTP POST /twiml)
   │                 • looks up caller in referral_sources
   │                 • returns TwiML <Connect><ConversationRelay url="wss://.../ws">
   ▼
ConversationRelay (Twilio handles STT + TTS + barge-in)
   │  WebSocket: JSON messages (setup, prompt=user speech, ...)
   ▼
Agent server (Node/Fastify, Railway) ── "the brain"
   │   router → sub-agents → tools → reply text → CR speaks it
   │   every step → run_events (telemetry)
   ▼
Supabase (Postgres + Realtime)
   ▲
   │ realtime subscription
Dashboard (Next.js, Vercel) — live Command Center
```

**Why two deploy targets:** ConversationRelay requires a persistent WebSocket server.
Vercel cannot hold long-lived sockets → agent server goes on **Railway**; dashboard on **Vercel**.

## 4. Repo layout (pnpm monorepo)

```
remy/
├── apps/
│   ├── agent/                  # Railway. Node 20 + Fastify + @fastify/websocket
│   │   ├── src/
│   │   │   ├── server.ts       # HTTP /twiml + /health, WS /ws
│   │   │   ├── session.ts      # per-call state machine
│   │   │   ├── router.ts       # stage router (see §7)
│   │   │   ├── agents/
│   │   │   │   ├── extractor.ts
│   │   │   │   ├── fitchecker.ts   # NOT an LLM — pure DB checks
│   │   │   │   ├── decider.ts      # deterministic gate + LLM reason text
│   │   │   │   └── responder.ts
│   │   │   ├── tools/
│   │   │   │   ├── serviceArea.ts  # zip covered?
│   │   │   │   ├── payer.ts        # insurance accepted?
│   │   │   │   ├── capacity.ts     # open slots for discipline?
│   │   │   │   └── callerLookup.ts # phone → referral source
│   │   │   ├── model.ts        # callModel(system, messages, schema) — SWAP POINT
│   │   │   ├── telemetry.ts    # logEvent(runId, stage, payload) → run_events
│   │   │   └── redact.ts       # strip PHI before telemetry write
│   │   ├── Dockerfile
│   │   └── package.json
│   └── dashboard/              # Vercel. Next.js 14 App Router + Tailwind
│       ├── app/
│       │   ├── page.tsx        # live command center
│       │   └── runs/[id]/page.tsx  # run detail / decision trace
│       └── lib/supabase.ts
├── packages/
│   └── shared/                 # zod schemas = sub-agent I/O contracts (§6)
├── supabase/
│   ├── migrations/0001_init.sql
│   └── seed.sql
├── REMY_SPEC.md                # this file
├── CLAUDE.md                   # working rules for Claude Code
└── turbo.json / pnpm-workspace.yaml
```

## 5. Data model (Supabase)

See `supabase/migrations/0001_init.sql` in this repo (full SQL included in spec bundle).

Tables:
- `referral_sources` — phone (E.164, unique), org_name, contact_name, org_type
- `service_areas` — zip (unique), county, active
- `payers` — name, aliases text[], accepted bool, notes
- `capacity` — discipline (RN | PT | OT | ST | HHA | MSW), open_slots, week_of
- `referrals` — the structured record + decision. THIS IS THE MOCK EMR WRITE-BACK.
  - patient_first_initial, patient_age, diagnosis_summary, discipline_needed,
    payer_raw, payer_matched_id, zip, requested_start, source_id,
    decision (accepted | escalated | declined), reason_code, transcript_summary,
    run_id, created_at
- `run_events` — run_id, seq, stage, sub_agent, tool_name, latency_ms,
  confidence, payload jsonb (REDACTED), created_at
- `runs` — run_id, caller_phone, source_id, status (active|completed|failed|escalated),
  started_at, ended_at

**PHI rule:** `run_events.payload` never contains full names, DOB, MRN, or full addresses.
`redact.ts` runs on every payload. Patient is referenced as first initial + age.

## 6. Sub-agent contracts (zod, in packages/shared)

```ts
// ReferralDraft — what the Extractor fills, turn by turn
const ReferralDraft = z.object({
  patient_first_initial: z.string().max(2).nullable(),
  patient_age: z.number().int().min(0).max(120).nullable(),
  diagnosis_summary: z.string().nullable(),        // plain words, no codes needed
  discipline_needed: z.enum(["RN","PT","OT","ST","HHA","MSW"]).nullable(),
  payer_raw: z.string().nullable(),                // exactly what caller said
  zip: z.string().regex(/^\d{5}$/).nullable(),
  requested_start: z.string().nullable(),          // free text ok ("tomorrow")
});

// ExtractorOut
const ExtractorOut = z.object({
  draft: ReferralDraft,                 // merged view after this turn
  updated_fields: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  needs_clarification: z.string().nullable(),  // question to ask, if any
});

// FitResult — produced by FitChecker (pure code, no LLM)
const FitResult = z.object({
  zip_covered: z.boolean().nullable(),        // null = unknown yet
  payer_accepted: z.boolean().nullable(),
  payer_matched_name: z.string().nullable(),
  capacity_available: z.boolean().nullable(),
  open_slots: z.number().nullable(),
  all_green: z.boolean(),
  missing_fields: z.array(z.string()),
});

// Decision — the gate
const Decision = z.object({
  decision: z.enum(["accept","escalate","decline"]),
  reason_code: z.enum([
    "ALL_CLEAR","OUT_OF_AREA","PAYER_NOT_ACCEPTED","NO_CAPACITY",
    "MISSING_FIELDS","LOW_CONFIDENCE","CALLER_REQUESTED_HUMAN","MODEL_ERROR"
  ]),
  spoken_reason: z.string(),  // what Remy says out loud
});
```

## 7. Router — conversation stages

Per-call state machine. Stages: `GREETING → COLLECTING → READBACK → DECIDING → CLOSING`.

- **GREETING**: greeting text was already sent via TwiML `welcomeGreeting`
  (personalized from caller lookup). First user utterance → COLLECTING.
- **COLLECTING**: each user turn → Extractor. If `needs_clarification`, Responder asks it.
  When all 7 draft fields non-null (or caller says "that's everything") → READBACK.
- **READBACK**: Remy reads the structured referral back. "Did I get that right?"
  Yes → DECIDING. No → back to COLLECTING targeting the corrected field.
- **DECIDING**: FitChecker runs all three tools. Decision gate (below). Speak result → CLOSING.
- **CLOSING**: confirmation ("Referral logged, our coordinator calls the patient within
  the hour") or warm escalation handoff. Write `referrals` row. End session.

**THE DECISION GATE (core guardrail — code, not prompt):**

```ts
function decide(fit: FitResult, draft: ReferralDraft, confidence: number): Decision {
  if (fit.missing_fields.length > 0)      return escalate("MISSING_FIELDS");
  if (confidence < 0.7)                   return escalate("LOW_CONFIDENCE");
  if (fit.zip_covered === false)          return escalate("OUT_OF_AREA");
  if (fit.payer_accepted === false)       return escalate("PAYER_NOT_ACCEPTED");
  if (fit.capacity_available === false)   return escalate("NO_CAPACITY");
  if (fit.all_green)                      return accept("ALL_CLEAR");
  return escalate("LOW_CONFIDENCE");
}
```
The LLM writes the *spoken_reason* wording; it can NEVER produce the decision itself.
An `accept` is impossible unless the database said yes three times.

**Escalation is never a dead end:** on escalate, Remy captures a callback number,
promises a coordinator follow-up, and the referral is written with `decision='escalated'`
so it shows on the dashboard queue pre-filled. (Stretch: Twilio SMS to "on-call
coordinator" phone — great demo beat, ~20 min to add with the Twilio SDK.)

## 8. model.ts — the swap point

```ts
// ONE function. Whole app calls the LLM only through this.
export async function callModel(opts: {
  system: string;
  messages: {role:"user"|"assistant"; content:string}[];
  jsonSchema?: object;          // when set, force structured output
}): Promise<string> { ... }
```
Default provider: Anthropic (claude-sonnet-4-6 via API, temperature 0.2 for extraction).
Swap = edit this file only. Do not import any model SDK anywhere else.

## 9. Twilio wiring

**/twiml webhook (HTTP POST from Twilio on inbound call):**
```xml
<Response>
  <Connect>
    <ConversationRelay
      url="wss://AGENT_HOST/ws"
      welcomeGreeting="{{personalized — see below}}"
      voice="{{pick a warm ElevenLabs voice in CR config}}" />
  </Connect>
</Response>
```
In the webhook handler: read `From`, look up `referral_sources`, build greeting:
- Known: "Thanks for calling Sunrise Home Health — hi Sarah, this is Remy. Do you have a referral from Mercy General for us?"
- Unknown: "You've reached Sunrise Home Health referral line, this is Remy. I can take your referral right now — who am I speaking with?"
Pass source_id into the WS session via custom parameter.

**WS protocol (ConversationRelay → server):** JSON messages. Handle:
- `setup` (call metadata, custom parameters) → create run, init session
- `prompt` (final user transcript for the turn) → router → reply with
  `{"type":"text","token":"...","last":true}` (CR converts to speech)
- `interrupt` → mark turn interrupted in telemetry
- socket close → finalize run
Consult Twilio ConversationRelay docs for exact message schema at build time
(fields evolve; do not trust memory).

**Failure guardrail:** wrap every model call in timeout (8s). On timeout/error →
Responder speaks static line: "Let me connect you with our intake coordinator to make
sure nothing is lost." → decision = escalate(MODEL_ERROR), run status = failed.
This is the fail_run pattern: NO silent dead air, ever.

## 10. Dashboard — "Remy Command Center" (Vercel)

Purpose in demo: while the judge is on the phone, the screen shows the machine working.

- **Live run view (hero):** active call card — caller org, stage stepper
  (Greeting → Collecting → Readback → Deciding → Closed), the ReferralDraft filling
  field-by-field in realtime, tool-check chips flipping grey→green/red
  (Area ✓ / Payer ✓ / Capacity ✓), decision banner.
- **Referral queue:** accepted + escalated referrals as cards (the "mock EMR").
- **Run detail page:** full telemetry trace — every event, sub-agent, latency,
  confidence. This is the reliability story made visible.
- Supabase Realtime subscription on `run_events` + `referrals`. No polling.
- Design: dark ops-console aesthetic, one accent color, big type for the decision.
  It should read as "mission control", not "admin CRUD".

## 11. Seed data (supabase/seed.sql) — tuned for the demo script

- referral_sources: 3 hospitals. One is "Mercy General Hospital / Sarah Chen /
  case manager" mapped to **the phone number you will demo from**.
- service_areas: ~15 NJ/NYC zips INCLUDING 07081 (Springfield NJ) and the venue zip;
  deliberately EXCLUDE 11550 (used in the escalation demo call).
- payers: Medicare (accepted), Aetna Medicare Advantage (accepted), Humana MA
  (accepted), UnitedHealthcare MA (NOT accepted — escalation trigger), Medicaid
  (accepted, note "pending recert").
- capacity: RN 4 slots, PT 3, OT 2, ST 0 (zero — second escalation trigger), HHA 6.

**Demo call 1 (accept):** "Hi, this is Sarah from Mercy General, discharge referral:
78-year-old, initial M, CHF exacerbation, needs skilled nursing, Medicare, zip 07081,
hoping to start tomorrow." → all green → accepted live.
**Demo call 2 (escalate):** same but UnitedHealthcare MA or zip 11550 → Remy does NOT
fake a yes → clean escalation with reason + callback capture.

## 12. Build phases (execute in order; each ends runnable)

- **P0 — Skeleton (do first):** monorepo scaffolding, shared zod package, Supabase
  migration + seed applied, `/health` up locally. ✅ check: `pnpm dev` runs both apps.
- **P1 — It's alive:** Railway deploy, Twilio number → /twiml → CR → WS echo
  (repeat back what caller says). ✅ check: phone call, hear echo. DEMO FALLBACK POINT.
- **P2 — Brain:** router + extractor + responder; multi-turn collection works;
  readback works. ✅ check: full collection conversation by phone.
- **P3 — Gate:** tools + fitchecker + decider + referrals write-back.
  ✅ check: demo call 1 accepts, demo call 2 escalates.
- **P4 — Glass:** dashboard live view + queue + run detail on Vercel.
  ✅ check: second screen shows the call live.
- **P5 — Polish:** personalized greeting, voice choice, latency pass
  (parallel tool calls, short responses), SMS-to-coordinator stretch goal,
  rehearse both scripted calls twice.

Rule: NEVER break P1. Every later phase must degrade gracefully back to a
working phone call.

## 13. Env vars

agent (Railway): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, ANTHROPIC_API_KEY (or provider
key), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUBLIC_HOST (for TwiML wss URL)
dashboard (Vercel): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

## 14. Judging narrative (30-second version)

"Referral leakage costs home-health agencies $200–500M a year — the first agency to say
yes wins the patient, and 20% of referrals arrive when no one's at the desk. This is Remy.
She answered that call you just watched, structured the referral, checked our real service
area, payer contracts, and capacity, and accepted in 40 seconds — and when she couldn't
verify fit, she refused to guess and escalated with everything pre-filled. Voice by Twilio
ConversationRelay, brain is a routed team of contract-bound sub-agents, every decision
fully traced on the screen behind me. Speed is revenue; guardrails make it safe to be fast."
