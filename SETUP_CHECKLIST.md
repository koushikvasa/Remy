# Remy — Manual setup checklist (the parts Claude Code can't click for you)

## Supabase (~10 min)
- [ ] Create project `remy` (region: us-east)
- [ ] SQL Editor → run `0001_init.sql`, then `seed.sql`
- [ ] BEFORE running seed: replace `+1XXXXXXXXXX` with your real cell (E.164) —
      this is what makes Remy greet "Sarah Chen from Mercy General" when YOU call
- [ ] Database → Replication: confirm `run_events`, `referrals`, `runs` are in the
      `supabase_realtime` publication (migration adds them; verify)
- [ ] Copy: Project URL, anon key, service_role key → into env vars later

## Twilio (~15 min)
- [ ] Buy a local US number (Voice capable). Trial account is fine BUT:
      trial can only CALL/RECEIVE verified numbers → verify every teammate's cell
      (Console → Phone Numbers → Verified Caller IDs)
- [ ] Upgrade with ~$20 if you want zero trial friction + the trial message removed
      from call start (worth it for demo day; the trial preamble ruins the greeting)
- [ ] Console → Voice → check that ConversationRelay is enabled for the account
      (Voice > Settings, enable if there's a toggle; region US1)
- [ ] Number → Voice Configuration → "A call comes in" → Webhook (HTTP POST) →
      leave blank for now; set to `https://<railway-host>/twiml` after P1 deploy
- [ ] Copy Account SID + Auth Token

## GitHub
- [x] Repo created: koushikvasa/Remy
- [ ] Add repo secrets later if you wire CI (not needed for hackathon)

## Railway (~10 min, during P1)
- [ ] New project → Deploy from GitHub repo → root `apps/agent` (or Dockerfile)
- [ ] Add env vars (see REMY_SPEC.md §13)
- [ ] Enable public networking → copy the `*.up.railway.app` host → PUBLIC_HOST env
- [ ] Alternative if Railway fights you: ngrok on a laptop is a fine hackathon fallback
      (`ngrok http 8080` → use that host in the Twilio webhook)

## Vercel (~5 min, during P4)
- [ ] Import repo → root directory `apps/dashboard`
- [ ] Env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
- [ ] Deploy → this URL is your "live link" for judges

## Model provider
- [ ] Anthropic API key (or provider of choice — one env var either way)
- [ ] Confirm billing/credits active BEFORE demo day

## Demo-day kit
- [ ] Phone with the seeded number, charged
- [ ] Dashboard URL open on the big screen
- [ ] Both call scripts printed (REMY_SPEC.md §11)
- [ ] Backup: screen-record a perfect run the night before, in case venue wifi/cell dies
