import "dotenv/config";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import formbody from "@fastify/formbody";
import { startSession, type Session } from "./session";
import { handleTurn } from "./router";
import { finalizeRun, logEvent } from "./telemetry";
import { lookupCaller } from "./tools/callerLookup";
import { buildGreeting, twimlConnect } from "./twiml";

/**
 * Agent server — HTTP webhook + ConversationRelay WebSocket (REMY_SPEC.md §9).
 *
 *   POST /twiml : inbound-call webhook → <Connect><ConversationRelay> TwiML,
 *                 greeting personalized from a caller lookup.
 *   GET  /ws    : ConversationRelay socket → runs the brain (router) per turn.
 *   GET  /health: liveness.
 *
 * REMY_ECHO=1 flips /ws into a pure-echo fallback (no DB, no model) — the P1
 * "it's alive" demo safety. No matter what, the caller always hears something
 * (rule 5): every turn is wrapped and errors speak the escalation line.
 *
 * WS schema (setup/prompt/interrupt/dtmf/error ; text/end) verified against
 * Twilio's ConversationRelay docs (rule 7).
 */

const ECHO_MODE = process.env.REMY_ECHO === "1";
const ESCALATION_LINE =
  "Let me connect you with our intake coordinator to make sure nothing is lost.";

const server = Fastify({ logger: true });

await server.register(formbody); // Twilio posts application/x-www-form-urlencoded
await server.register(websocket);

server.get("/health", async () => ({ ok: true }));

// Inbound-call webhook.
server.post("/twiml", async (req, reply) => {
  const body = (req.body ?? {}) as Record<string, string>;
  const from = body.From ?? null;

  let sourceId: string | null = null;
  let greeting: string;
  try {
    const source = ECHO_MODE ? null : await lookupCaller(from);
    sourceId = source?.id ?? null;
    greeting = buildGreeting(source);
  } catch {
    greeting = buildGreeting(null);
  }

  const host = process.env.PUBLIC_HOST ?? req.headers.host ?? "localhost";
  const wssUrl = `wss://${host}/ws`;

  reply.type("text/xml").send(twimlConnect({ wssUrl, greeting, sourceId }));
});

// ConversationRelay socket.
server.get("/ws", { websocket: true }, (socket) => {
  let session: Session | null = null;

  const sendText = (token: string, last = true) => {
    try {
      socket.send(JSON.stringify({ type: "text", token, last }));
    } catch (err) {
      server.log.error(err);
    }
  };

  // Process messages strictly in arrival order: setup must fully complete
  // (session created) before the first prompt is handled.
  let chain: Promise<void> = Promise.resolve();

  socket.on("message", (raw: Buffer) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    chain = chain.then(() => handleMessage(msg));
  });

  async function handleMessage(msg: Record<string, unknown>): Promise<void> {
    try {
      switch (msg.type) {
        case "setup": {
          if (ECHO_MODE) return; // echo needs no run/session
          const from = (msg.from as string) ?? "unknown";
          const params = (msg.customParameters as Record<string, string>) ?? {};
          session = await startSession({ callerPhone: from, sourceId: params.source_id ?? null });
          break;
        }

        case "prompt": {
          // Only act on the final transcript for the turn.
          if (msg.last !== true) return;
          const text = String(msg.voicePrompt ?? "");
          if (ECHO_MODE) {
            sendText(`You said: ${text}`);
            return;
          }
          if (!session) return;
          const res = await handleTurn(session, text);
          sendText(res.reply, true);
          break;
        }

        case "interrupt": {
          // Log the event only — never the caller's utterance (PHI).
          if (session) {
            await logEvent({
              runId: session.runId,
              stage: session.stage,
              subAgent: "system",
              payload: { event: "interrupt" },
            });
          }
          break;
        }

        case "error": {
          if (session) {
            await logEvent({
              runId: session.runId,
              stage: session.stage,
              subAgent: "system",
              payload: { event: "cr_error", description: msg.description ?? null },
            });
          }
          break;
        }

        // "dtmf" and any other types are ignored for P1.
        default:
          break;
      }
    } catch (err) {
      server.log.error(err);
      sendText(ESCALATION_LINE, true); // no dead air (rule 5)
      if (session && !session.finalized) {
        await finalizeRun(session.runId, "failed");
        session.finalized = true;
      }
    }
  }

  socket.on("close", async () => {
    if (session && !session.finalized) {
      await finalizeRun(session.runId, "completed");
      session.finalized = true;
    }
  });
});

const port = Number(process.env.PORT ?? 8080);

try {
  await server.listen({ port, host: "0.0.0.0" });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
