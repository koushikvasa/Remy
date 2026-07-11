import OpenAI from "openai";

/**
 * model.ts — THE SWAP POINT (REMY_SPEC.md §8, CLAUDE.md hard rule 2).
 *
 * The whole app calls the LLM only through callModel(). No other file may import
 * a model SDK. To change providers, edit only this file.
 *
 * Every model call is bounded by an 8s timeout (CLAUDE.md hard rule 5): callers
 * catch the resulting error and escalate rather than leaving dead air.
 */

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const TEMPERATURE = 0.2; // extraction wants determinism
const DEFAULT_TIMEOUT_MS = 8000;

// Lazy so importing this module (or booting /health) never requires the key.
let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

export interface CallModelOpts {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  /** When provided, force structured output via OpenAI JSON Schema mode. */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function callModel(opts: CallModelOpts): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const completion = await client().chat.completions.create(
      {
        model: MODEL,
        temperature: opts.temperature ?? TEMPERATURE,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        messages: [
          { role: "system", content: opts.system },
          ...opts.messages,
        ],
        ...(opts.jsonSchema
          ? {
              response_format: {
                type: "json_schema" as const,
                json_schema: {
                  name: "response",
                  strict: true,
                  schema: opts.jsonSchema,
                },
              },
            }
          : {}),
      },
      { signal: controller.signal }
    );

    return completion.choices[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}
