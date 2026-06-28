// DevCockpit — Slack unread reader (ES module, imported by background.js).
//
// Reads the combined unread count (DMs + @mentions) from Slack's internal
// `client.counts` endpoint — the same one the Slack web app polls. This is an
// UNOFFICIAL endpoint: it only accepts a browser-session token (xoxc-…) paired
// with the `d` cookie (xoxd-…). A standard Slack-app OAuth token (xoxp-…) is
// rejected. Tokens reset when the user logs out of Slack web.
//
// All token values are kept out of logs.

const toInt = (v) => (Number.isFinite(v) ? v : 0);

/**
 * Call client.counts for the given workspace + session credentials.
 * @param {{ workspaceUrl: string, token: string, dCookie: string }} cfg
 * @returns {Promise<object>} the parsed client.counts payload (json.ok === true)
 */
export async function fetchCounts(cfg) {
  const base = normalizeWorkspaceUrl(cfg.workspaceUrl);
  await ensureDCookie(base, cfg.dCookie);
  return slackApi(base, "client.counts", cfg.token, {
    thread_counts_by_channel: "true",
    org_wide_aware: "true",
  }, "?_x_reason=fetch-counts&_x_mode=online");
}

// Place the HttpOnly `d` cookie into the jar so credentials:"include" sends it.
async function ensureDCookie(base, dCookie) {
  await chrome.cookies.set({
    url: base,
    name: "d",
    value: dCookie,
    domain: ".slack.com",
    path: "/",
    secure: true,
    httpOnly: true,
  });
}

// One POST to a Slack web-API method using the session token (+ d cookie via
// credentials:"include"). Throws Error(json.error) on a non-ok payload.
async function slackApi(base, method, token, params = {}, query = "") {
  const res = await fetch(`${base}/api/${method}${query}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: new URLSearchParams({ token, ...params }),
  });
  if (!res.ok) throw new Error("http_" + res.status);
  const json = await res.json();
  if (!json || !json.ok) throw new Error((json && json.error) || "slack_error");
  return json;
}

/**
 * Reduce a client.counts payload to one combined unread number plus a DM /
 * mention breakdown. Written defensively because the exact shape is
 * undocumented and can vary between workspaces.
 *
 * @param {object} counts
 * @returns {{ total: number, dms: number, mentions: number }}
 */
export function combineUnread(counts) {
  // Preferred: Slack ships a precomputed badge summary that matches the red
  // sidebar badges. Use it when present.
  const badges = counts && counts.channel_badges;
  if (badges && typeof badges === "object") {
    const dms = toInt(badges.dms) + toInt(badges.app_dms);
    const mentions =
      toInt(badges.channels) + toInt(badges.thread_mentions) + toInt(badges.mpdms);
    return { total: dms + mentions, dms, mentions };
  }

  // Fallback: sum from the raw arrays.
  const sumMentions = (arr) =>
    Array.isArray(arr) ? arr.reduce((n, c) => n + toInt(c && c.mention_count), 0) : 0;

  // DMs: every unread message in an IM counts toward the badge.
  const ims = Array.isArray(counts && counts.ims) ? counts.ims : [];
  const dms = ims.reduce(
    (n, im) => n + (toInt(im.mention_count) || (im.has_unreads ? 1 : 0)),
    0
  );

  const mentions =
    sumMentions(counts && counts.channels) +
    sumMentions(counts && counts.mpims) +
    toInt(counts && counts.threads && counts.threads.mention_count);

  return { total: dms + mentions, dms, mentions };
}

/**
 * A stable key describing which conversations currently have unreads, used to
 * decide whether genuinely new activity arrived between polls.
 * @param {object} counts
 * @returns {string}
 */
export function conversationKey(counts) {
  const ids = [];
  const collect = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const c of arr) {
      if (c && c.id && (c.has_unreads || toInt(c.mention_count) > 0)) ids.push(c.id);
    }
  };
  collect(counts && counts.ims);
  collect(counts && counts.channels);
  collect(counts && counts.mpims);
  return ids.sort().join(",");
}

function normalizeWorkspaceUrl(workspaceUrl) {
  let u = String(workspaceUrl || "").trim();
  if (!u) throw new Error("no_workspace");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  // strip trailing slash and any path
  try {
    const parsed = new URL(u);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (e) {
    throw new Error("bad_workspace");
  }
}

// ----------------------------- unread message bodies -----------------------------
// Built on the same unofficial transport as fetchCounts. Used only on panel open /
// manual refresh (not on the 2-min poll), so the extra API calls stay bounded.

const USER_TTL_MS = 24 * 60 * 60 * 1000;
const CONV_TTL_MS = 24 * 60 * 60 * 1000;
const SKIP_SUBTYPES = new Set([
  "channel_join", "channel_leave", "channel_topic", "channel_purpose", "channel_name",
  "group_join", "group_leave", "bot_add", "bot_remove",
]);

/** Pick the conversations that currently have unreads, ranked by mentions then recency. */
export function pickUnreadConversations(counts, { maxConversations = 5 } = {}) {
  const out = [];
  const take = (arr, type) => {
    if (!Array.isArray(arr)) return;
    for (const c of arr) {
      if (!c || !c.id) continue;
      const mention = toInt(c.mention_count);
      if (c.has_unreads || mention > 0) {
        out.push({
          id: c.id, type, mentionCount: mention,
          lastRead: c.last_read || "0", latest: c.latest || "0", userId: c.user || null,
        });
      }
    }
  };
  take(counts && counts.ims, "im");
  take(counts && counts.channels, "channel");
  take(counts && counts.mpims, "mpim");
  out.sort((a, b) => (b.mentionCount - a.mentionCount) || (parseFloat(b.latest) - parseFloat(a.latest)));
  return out.slice(0, maxConversations);
}

/**
 * For each unread conversation, pull the recent messages, resolve a title and
 * sender display names (cached), and render mrkdwn to plain text.
 * @returns {Promise<{ conversations: Array, caches: { users: object, convos: object } }>}
 */
export async function fetchUnreadMessages(cfg, countsPayload, opts = {}) {
  const { maxConversations = 5, perConversation = 5, caches = {} } = opts;
  const base = normalizeWorkspaceUrl(cfg.workspaceUrl);
  await ensureDCookie(base, cfg.dCookie);
  const token = cfg.token;
  const users = caches.users || {};
  const convos = caches.convos || {};
  const now = Date.now();

  const convs = pickUnreadConversations(countsPayload, { maxConversations });
  const conversations = [];

  for (const conv of convs) {
    let messages;
    try {
      const hist = await slackApi(base, "conversations.history", token, {
        channel: conv.id,
        limit: String(perConversation),
        oldest: conv.lastRead && conv.lastRead !== "0" ? conv.lastRead : "0",
        inclusive: "false",
      });
      messages = Array.isArray(hist.messages) ? hist.messages : [];
    } catch (e) {
      continue; // skip this conversation, keep the rest
    }

    let meta = convos[conv.id];
    if (!meta || now - meta.ts > CONV_TTL_MS) {
      try {
        const info = await slackApi(base, "conversations.info", token, { channel: conv.id });
        const ch = info.channel || {};
        meta = { title: ch.name ? "#" + ch.name : null, userId: ch.user || conv.userId || null, ts: now };
      } catch (e) {
        meta = { title: null, userId: conv.userId || null, ts: now };
      }
      convos[conv.id] = meta;
    }

    const wantUsers = new Set();
    if (meta.userId) wantUsers.add(meta.userId);
    for (const m of messages) if (m.user) wantUsers.add(m.user);
    for (const uid of wantUsers) {
      if (users[uid] && now - users[uid].ts < USER_TTL_MS) continue;
      try {
        const ui = await slackApi(base, "users.info", token, { user: uid });
        users[uid] = { name: displayName(ui.user, uid), ts: now };
      } catch (e) {
        users[uid] = { name: null, ts: now };
      }
    }
    const nameFor = (uid) => (uid && users[uid] && users[uid].name) || uid || "Unknown";
    const title = meta.title
      || (meta.userId ? nameFor(meta.userId) : conv.type === "im" ? "Direct message" : "Conversation");

    const rendered = messages
      .filter((m) => !SKIP_SUBTYPES.has(m.subtype))
      .reverse() // history is newest-first; show oldest-first
      .map((m) => ({
        ts: m.ts,
        sender: m.user ? nameFor(m.user) : (m.username || (m.bot_id ? "Bot" : "Unknown")),
        isBot: !!m.bot_id || m.subtype === "bot_message",
        text: renderMrkdwn(extractText(m), users),
      }))
      .filter((m) => m.text);

    conversations.push({ id: conv.id, type: conv.type, title, mentionCount: conv.mentionCount, messages: rendered });
  }

  return { conversations, caches: { users, convos } };
}

function displayName(u, fallback) {
  if (!u) return fallback;
  return (u.profile && (u.profile.display_name || u.profile.real_name)) || u.real_name || u.name || fallback;
}

// Pull text from a message: the raw mrkdwn `text`, else block-kit text, else an
// attachment fallback. Block-kit is walked shallowly for string `text` fields.
function extractText(m) {
  if (m.text && m.text.trim()) return m.text;
  if (Array.isArray(m.blocks)) {
    const parts = [];
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (typeof node.text === "string") parts.push(node.text);
      else if (node.text && typeof node.text === "object") walk(node.text);
      if (Array.isArray(node.elements)) node.elements.forEach(walk);
    };
    m.blocks.forEach(walk);
    if (parts.length) return parts.join(" ");
  }
  if (Array.isArray(m.attachments)) {
    for (const a of m.attachments) {
      if (a.fallback) return a.fallback;
      if (a.text) return a.text;
    }
  }
  return "";
}

/** Convert Slack mrkdwn to readable plain text (output is inserted via textContent). */
export function renderMrkdwn(text, users = {}) {
  if (!text) return "";
  let s = text;
  s = s.replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id, name) => "@" + (name || (users[id] && users[id].name) || id));
  s = s.replace(/<#[A-Z0-9]+\|([^>]+)>/g, (_, name) => "#" + name);
  s = s.replace(/<#[A-Z0-9]+>/g, "#channel");
  s = s.replace(/<!subteam\^[A-Z0-9]+(?:\|([^>]+))?>/g, (_, name) => name || "@team");
  s = s.replace(/<!(here|channel|everyone)>/g, (_, k) => "@" + k);
  s = s.replace(/<(https?:[^|>]+)\|([^>]+)>/g, (_, url, label) => label);
  s = s.replace(/<(https?:[^>]+)>/g, (_, url) => url);
  s = s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return s.trim();
}
