// DevCockpit — Anthropic Messages API client (ES module, imported by background.js).
//
// Called directly from the service worker. The user's API key lives in
// chrome.storage.local (anthropic.apiKey) and is NEVER logged. The
// `anthropic-dangerous-direct-browser-access` header is Anthropic's own gate for
// browser-origin requests; the api.anthropic.com host_permission lets MV3 run the
// fetch with extension privileges so CORS isn't enforced.

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
export const DEFAULT_MODEL = "claude-haiku-4-5";

/**
 * Single non-streaming Messages call.
 * @param {{ apiKey: string, model?: string }} cfg
 * @param {{ system: string, user: string, maxTokens?: number }} opts
 * @returns {Promise<string>} the assistant's text
 */
export async function callAnthropic({ apiKey, model }, { system, user, maxTokens = 1024 }) {
  if (!apiKey) throw new Error("no_key");
  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
  } catch (e) {
    throw new Error("network");
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error("auth");
    if (res.status === 429) throw new Error("rate_limited");
    if (res.status === 529) throw new Error("overloaded");
    throw new Error("http_" + res.status);
  }
  const json = await res.json();
  if (json && json.stop_reason === "refusal") throw new Error("refusal");
  const block = Array.isArray(json && json.content) ? json.content.find((b) => b.type === "text") : null;
  if (!block || !block.text) throw new Error("empty");
  return block.text.trim();
}

/** Explain a Slack message in Polish. */
export async function explainMessagePL(cfg, { sender, text, channelTitle }) {
  const system =
    "Jesteś asystentem, który zwięźle wyjaśnia po polsku wiadomości ze Slacka. " +
    "Wyjaśnij w 1–3 zdaniach o co chodzi w wiadomości i czego nadawca oczekuje. " +
    "Pisz prostym językiem, bez wstępów typu „Oto wyjaśnienie”.";
  const user =
    `Kanał/rozmowa: ${channelTitle || "—"}\n` +
    `Nadawca: ${sender || "—"}\n` +
    `Wiadomość:\n${text}`;
  return callAnthropic(cfg, { system, user, maxTokens: 512 });
}

/** Draft an English reply the user can send as-is. */
export async function draftReplyEN(cfg, { sender, text, channelTitle }) {
  const system =
    "You help the user reply to Slack messages. Write a natural, friendly, professional " +
    "reply in English that the user can send as-is. Return ONLY the reply text — no preamble, " +
    "no quotation marks, no alternatives.";
  const user =
    `Channel/conversation: ${channelTitle || "—"}\n` +
    `From: ${sender || "—"}\n` +
    `Their message:\n${text}\n\n` +
    `Write my reply in English.`;
  return callAnthropic(cfg, { system, user, maxTokens: 512 });
}
