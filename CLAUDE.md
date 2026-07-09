# CLAUDE.md — Working rules for Remy

Read REMY_SPEC.md first. It is the source of truth. This file is how to work on it.

## Project snapshot
Remy = voice AI agent answering a home-health agency's referral line.
Twilio ConversationRelay (voice) → Fastify WS agent server (Railway) → Supabase → Next.js dashboard (Vercel).
Hackathon build. Bias to working > perfect. Demo is two live phone calls + live dashboard.

## Hard rules
1. **The decision gate is code, never a prompt.** `decide()` in `agents/decider.ts` is the
   only place a decision is produced. The LLM only words the spoken explanation.
   Never let model output set `decision`.
2. **All LLM calls go through `src/model.ts` `callModel()`.** Never import a model SDK
   anywhere else. Provider may be swapped later.
3. **No PHI in telemetry.** Everything written to `run_events.payload` passes through
   `redact.ts`. Patient = first initial + age only. No full names, DOB, MRN, addresses.
4. **Never break P1.** The echo call path must keep working through every phase.
   If a change risks the live call path, feature-flag it.
5. **No silent dead air.** Every model call has an 8s timeout → static escalation line
   → run marked failed. A caller must always hear something.
6. **Sub-agent I/O is zod-validated** against packages/shared. On validation failure:
   one retry with the validation error appended, then escalate(MODEL_ERROR).
7. **Check Twilio ConversationRelay docs for exact WS message schema** before writing
   the handler — do not rely on memorized field names. Same for TwiML attributes.

## Conventions
- pnpm monorepo, TypeScript strict everywhere, Node 20.
- apps/agent: Fastify + @fastify/websocket. apps/dashboard: Next.js 14 App Router + Tailwind.
- Supabase JS client v2. Dashboard uses anon key + Realtime; agent uses service role.
- Keep spoken responses SHORT (1–2 sentences) — this is a phone call, latency matters.
- Commit at the end of every phase (P0…P5) with message `P<n>: <what works now>`.
- Secrets only in env. Never commit .env. Provide .env.example.

## Phase discipline
Work strictly in REMY_SPEC.md §12 order. Finish a phase's ✅ check before starting the
next. If asked to jump ahead, note the risk and continue on request.

## Testing shortcuts
- `apps/agent/scripts/simulate.ts`: feed scripted transcript turns through the router
  without Twilio (fast iteration on the brain).
- Demo call scripts live in REMY_SPEC.md §11. Seed data must keep matching them.
