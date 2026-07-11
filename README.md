# Remy

**Remy answers a home-health agency's referral line 24/7 and says *yes* in seconds — safely.**

When a hospital discharges a patient to home care, the planner blasts the referral to 3–5 agencies at once and the first to accept wins the patient — often within the hour. Those calls arrive nights and weekends when no one's at the desk, and ~20% leak away (a $200–500M/yr problem). Remy is a voice AI agent that answers the line instantly, captures the referral as structured data, checks fit against the agency's real service area / payers / capacity, and **accepts on the spot — or escalates to a human with everything pre-filled.** An accept is impossible unless the database says yes three times: the decision is made by code, never by the model.

Built for Healthcare Hack NYC (Arya Health × Twilio).

---

## Architecture

```
Caller (discharge planner)
   │  PSTN
   ▼
Twilio number ──► POST /twiml ──► <Connect><ConversationRelay wss://…/ws>
   │                              (greeting personalized by caller lookup)
   ▼
ConversationRelay  (Twilio: Deepgram STT + ElevenLabs TTS + barge-in)
   │  WebSocket JSON: setup / prompt / interrupt
   ▼
Agent server  (Node + Fastify, Railway) ── "the brain"
   │   router → extractor → readback → fitchecker → decide() gate → responder
   │   every step → run_events (PHI-redacted telemetry)
   ▼
Supabase (Postgres + Realtime)
   ▲
   │  realtime (anon) — no polling
   ▼
Dashboard  (Next.js, Vercel) — "Command Center": live call, referral queue, decision trace
```

- **The decision gate is code, not a prompt.** `decide()` in `apps/agent/src/agents/decider.ts` is the only place a decision is produced; the model only words the spoken explanation.
- **One model seam.** Every LLM call goes through `apps/agent/src/model.ts` `callModel()`.
- **No PHI in telemetry.** Everything written to `run_events` passes `redact.ts`; the patient is only ever an initial + age.
- **No dead air.** Every model call is bounded (8s) → static escalation line → run marked failed.

## Live links

- Dashboard (Command Center): `https://<your-vercel-app>.vercel.app`
- Agent health: `https://<your-railway-host>/health` → `{"ok":true}`
- Referral line (Twilio): `+1 662 547 8393`

## Demo scripts

**Call 1 — accept.** "Hi, this is Sarah from Mercy General, discharge referral: 78-year-old, initial M, CHF exacerbation, needs skilled nursing, Medicare, zip 07081, hoping to start tomorrow." → all three checks green → **ACCEPTED / ALL_CLEAR**, logged live.

**Call 2 — escalate.** Same, but UnitedHealthcare Medicare Advantage (or zip 11550). Remy does **not** fake a yes → clean **ESCALATED** with the reason + callback capture, pre-filled on the dashboard queue.

## Quickstart

Monorepo: `pnpm install` at the repo root (Node 20+). Copy `.env.example` → `.env` in `apps/agent` and `.env.local` in `apps/dashboard`.

```bash
# both apps locally
pnpm dev                                   # agent :8080 + dashboard :3000

# iterate on the brain WITHOUT Twilio — type caller turns, see the draft fill,
# prints p50/p95 turn latency at the end
pnpm --filter @remy/agent sim

# reset the DB to a demo-ready state (1 accepted + 1 escalated in the queue)
pnpm --filter @remy/agent reset
```

Feature flags (agent): `REMY_ECHO=1` (WS echoes instead of running the brain — P1 fallback), `REMY_AUTO_END=1` (hang up after the closing line), `REMY_VOICE=<elevenlabs-voice-id>`.

Deploy: agent → Railway (Dockerfile, `railway.json`); dashboard → Vercel (root `apps/dashboard`). See `SETUP_CHECKLIST.md` for the click-through steps and `REMY_SPEC.md` for the full spec.
