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
export async function fetchCounts({ workspaceUrl, token, dCookie }) {
  const base = normalizeWorkspaceUrl(workspaceUrl);

  // Place the HttpOnly `d` cookie into the jar so credentials:"include" sends it.
  await chrome.cookies.set({
    url: base,
    name: "d",
    value: dCookie,
    domain: ".slack.com",
    path: "/",
    secure: true,
    httpOnly: true,
  });

  const url = `${base}/api/client.counts?_x_reason=fetch-counts&_x_mode=online`;
  const body = new URLSearchParams({
    token,
    thread_counts_by_channel: "true",
    org_wide_aware: "true",
  });

  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body,
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
