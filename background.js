// DevCockpit — service worker (Manifest V3)
// Owns timer phase transitions, the toolbar badge, the transition chime and
// notifications. Runs on chrome.alarms so it fires on time even with no tab open.
// Phases: focus <-> break (no long break).
//
// Also polls Slack's unread count (DMs + @mentions) in the background so the
// top-bar pill, toolbar badge, and desktop alerts work without a tab open.

import { fetchCounts, combineUnread, conversationKey, fetchUnreadMessages } from "./slack.js";
import { explainMessagePL, draftReplyEN, summarizeArticleEN, DEFAULT_MODEL } from "./anthropic.js";
import { BACKUP_DATA_KEYS, MAX_SNAPSHOTS, buildBackup, fingerprint, backupFileName } from "./backup.js";
import { t, setLanguage } from "./i18n.js";

const ALARM_COMPLETE = "ff-complete";
const ALARM_TICK = "ff-tick";
const ALARM_SLACK = "ff-slack";
const ALARM_SNAPSHOT = "ff-snapshot";
const ALARM_AUTOBACKUP = "ff-autobackup";

const SLACK_POLL_MINUTES = 2;
const SLACK_BADGE_COLOR = "#d33";

const SNAPSHOT_DEBOUNCE_MINUTES = 2;     // snapshot a couple of minutes after the last change
const AUTOBACKUP_PERIOD_MINUTES = 24 * 60; // write a file backup to Downloads daily

const DEFAULT_SETTINGS = {
  focusMin: 25,
  breakMin: 5,
  autoStartNext: true,
  sound: "gong", // gong | bell | beep | none
  volume: 0.7,
  notify: true,
  theme: "zed", // must match DEFAULT_SETTINGS.theme in app.js (worker seeds settings on install)
  // location for weather (set by the user)
  city: "",
  lat: null,
  lon: null,
};

const DEFAULT_TIMER = {
  isRunning: false,
  isPaused: false,
  mode: "focus", // focus | break
  endTime: null,
  remaining: 25 * 60,
  completedFocusTotal: 0,
};

async function getState() {
  const data = await chrome.storage.local.get(["settings", "timer"]);
  return {
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    timer: { ...DEFAULT_TIMER, ...(data.timer || {}) },
  };
}

async function setTimer(patch) {
  const { timer } = await getState();
  const next = { ...timer, ...patch };
  await chrome.storage.local.set({ timer: next });
  return next;
}

function durationFor(mode, settings) {
  return (mode === "focus" ? settings.focusMin : settings.breakMin) * 60;
}

// ----------------------------- badge -----------------------------

const COLOR_FOCUS = "#c2603a";
const COLOR_BREAK = "#4f7d6b";
const COLOR_PAUSE = "#6b7280";

function badgeText(s) {
  if (s <= 0) return "";
  return s >= 60 ? String(Math.ceil(s / 60)) : String(s);
}

async function refreshBadge() {
  const { timer } = await getState();
  // Timer wins while a session is running/paused — the countdown is time-sensitive.
  if (timer.isRunning || timer.isPaused) {
    let remaining = timer.remaining;
    if (timer.isRunning && timer.endTime) {
      remaining = Math.max(0, Math.round((timer.endTime - Date.now()) / 1000));
    }
    const color = timer.isPaused ? COLOR_PAUSE : timer.mode === "focus" ? COLOR_FOCUS : COLOR_BREAK;
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text: timer.isPaused ? "||" : badgeText(remaining) });
    return;
  }
  // Timer idle → surface the Slack unread count, if any.
  const total = await slackBadgeTotal();
  if (total > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: SLACK_BADGE_COLOR });
    await chrome.action.setBadgeText({ text: total > 99 ? "99+" : String(total) });
    return;
  }
  await chrome.action.setBadgeText({ text: "" });
}

async function slackBadgeTotal() {
  const { slackCounts } = await chrome.storage.local.get("slackCounts");
  return slackCounts && typeof slackCounts.total === "number" ? slackCounts.total : 0;
}

// ----------------------------- alarms -----------------------------

async function scheduleAlarms(timer) {
  await chrome.alarms.clear(ALARM_COMPLETE);
  await chrome.alarms.clear(ALARM_TICK);
  if (timer.isRunning && timer.endTime) {
    chrome.alarms.create(ALARM_COMPLETE, { when: timer.endTime });
    chrome.alarms.create(ALARM_TICK, { periodInMinutes: 1 });
  }
}

// ----------------------------- slack -----------------------------

function slackConfigured(slack) {
  return !!(slack && slack.workspaceUrl && slack.token && slack.dCookie);
}

async function scheduleSlack() {
  const { slack } = await chrome.storage.local.get("slack");
  await chrome.alarms.clear(ALARM_SLACK);
  if (slackConfigured(slack)) {
    chrome.alarms.create(ALARM_SLACK, { periodInMinutes: SLACK_POLL_MINUTES });
  }
}

// Fetch the latest unread snapshot, store it, update the badge, and fire a
// desktop alert when genuinely new activity has arrived. Returns a small status
// object so the Settings dialog can report success/failure.
async function pollSlack() {
  const { slack, slackCounts: prev } = await chrome.storage.local.get(["slack", "slackCounts"]);
  if (!slackConfigured(slack)) {
    await chrome.storage.local.remove("slackCounts");
    await refreshBadge();
    return { ok: false, error: "not_configured" };
  }

  let counts;
  try {
    const payload = await fetchCounts(slack);
    counts = combineUnread(payload);
    counts.key = conversationKey(payload);
  } catch (e) {
    const error = (e && e.message) || "slack_error";
    const auth = error === "not_authed" || error === "invalid_auth" || error === "token_revoked";
    const next = { error: auth ? "auth" : "fetch", ts: Date.now() };
    await chrome.storage.local.set({ slackCounts: next });
    await refreshBadge();
    return { ok: false, error };
  }

  const next = {
    total: counts.total,
    dms: counts.dms,
    mentions: counts.mentions,
    key: counts.key,
    ts: Date.now(),
  };
  await chrome.storage.local.set({ slackCounts: next });
  await refreshBadge();

  // Notify only on genuinely new activity: a prior snapshot exists, the total
  // went up, AND the set of unread conversations changed (avoids re-alerting on
  // the same backlog every poll, and skips the first poll after connecting).
  const hadPrev = prev && typeof prev.total === "number";
  const grew = hadPrev && next.total > prev.total;
  const changed = hadPrev && prev.key !== next.key;
  if (slack.notify && grew && changed && next.total > 0) {
    try {
      const { settings } = await chrome.storage.local.get("settings");
      setLanguage(settings && settings.language);
      await chrome.notifications.create(`ff-slack-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: t("notif.slackTitle", { n: next.total }),
        message: t("notif.slackBody", { dms: next.dms, mentions: next.mentions }),
        priority: 2,
      });
    } catch (e) {}
  }

  return { ok: true, total: next.total };
}

async function slackDisconnect() {
  const { slack } = await chrome.storage.local.get("slack");
  await chrome.alarms.clear(ALARM_SLACK);
  await chrome.storage.local.remove(["slack", "slackCounts"]);
  if (slack && slack.workspaceUrl) {
    try {
      const host = new URL(/^https?:\/\//i.test(slack.workspaceUrl) ? slack.workspaceUrl : "https://" + slack.workspaceUrl);
      await chrome.cookies.remove({ url: `${host.protocol}//${host.host}`, name: "d" });
    } catch (e) {}
  }
  await refreshBadge();
}

// On-demand: full unread message bodies for the detail panel. Runs only when the
// user opens / refreshes the Slack drawer, so the heavier calls stay bounded.
async function getSlackUnread() {
  const store = await chrome.storage.local.get(["slack", "slackUsers", "slackConvos"]);
  const slack = store.slack;
  if (!slackConfigured(slack)) return { ok: false, error: "not_configured" };
  try {
    const payload = await fetchCounts(slack);
    const { conversations, caches } = await fetchUnreadMessages(slack, payload, {
      maxConversations: 5,
      perConversation: 5,
      caches: { users: store.slackUsers || {}, convos: store.slackConvos || {} },
    });
    await chrome.storage.local.set({ slackUsers: caches.users, slackConvos: caches.convos });
    return { ok: true, conversations };
  } catch (e) {
    const error = (e && e.message) || "slack_error";
    const auth = error === "not_authed" || error === "invalid_auth" || error === "token_revoked";
    return { ok: false, error: auth ? "auth" : error };
  }
}

// Anthropic-backed helpers for the Slack drawer (explain in Polish / draft in English).
// The API key is read here so it never leaves the worker into page context.
async function runAiTask(kind, payload) {
  const { anthropic } = await chrome.storage.local.get("anthropic");
  const cfg = { apiKey: anthropic && anthropic.apiKey, model: (anthropic && anthropic.model) || DEFAULT_MODEL };
  if (!cfg.apiKey) return { ok: false, error: "no_key" };
  try {
    let text;
    if (kind === "summarize") {
      if (!payload || !payload.title) return { ok: false, error: "no_message" };
      text = await summarizeArticleEN(cfg, payload);
    } else {
      if (!payload || !payload.text) return { ok: false, error: "no_message" };
      text = kind === "explain" ? await explainMessagePL(cfg, payload) : await draftReplyEN(cfg, payload);
    }
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: (e && e.message) || "ai_error" };
  }
}

// ----------------------------- backup -----------------------------

// Rolling in-app snapshots: a change to boards/settings arms a short debounce
// alarm; when it fires we store one snapshot (skipping no-op duplicates).
async function takeSnapshot({ auto = true } = {}) {
  const data = await chrome.storage.local.get([...BACKUP_DATA_KEYS, "backups"]);
  if (!Array.isArray(data.boards) || data.boards.length === 0) return;
  const fp = fingerprint(data);
  const list = Array.isArray(data.backups) ? data.backups : [];
  if (list[0] && list[0].fp === fp) return; // nothing changed since the last snapshot
  const snap = {
    ts: Date.now(),
    auto,
    fp,
    data: { boards: data.boards, activeBoardId: data.activeBoardId, settings: data.settings },
  };
  const next = [snap, ...list].slice(0, MAX_SNAPSHOTS);
  await chrome.storage.local.set({ backups: next });
}

// UTF-8 safe base64 (board content includes non-ASCII, e.g. Polish characters).
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Daily off-device backup: write the current data to the Downloads folder, but
// only when it has changed since the last auto-backup. One file per day (same
// day overwrites), so Downloads stays tidy.
async function autoBackupToFile() {
  const data = await chrome.storage.local.get([...BACKUP_DATA_KEYS, "settings", "lastAutoBackup"]);
  const settings = data.settings || {};
  if (settings.autoBackupFile === false) return;
  if (!Array.isArray(data.boards) || data.boards.length === 0) return;
  const fp = fingerprint(data);
  if (data.lastAutoBackup && data.lastAutoBackup.fp === fp) return; // unchanged since last export
  const json = JSON.stringify(buildBackup(data), null, 2);
  const url = `data:application/json;base64,${toBase64(json)}`;
  try {
    await chrome.downloads.download({
      url,
      filename: backupFileName(new Date()),
      saveAs: false,
      conflictAction: "overwrite",
    });
    await chrome.storage.local.set({ lastAutoBackup: { fp, ts: Date.now() } });
  } catch (e) {}
}

function scheduleAutoBackup() {
  chrome.alarms.create(ALARM_AUTOBACKUP, { periodInMinutes: AUTOBACKUP_PERIOD_MINUTES });
}

// ----------------------------- commands -----------------------------

async function cmdStart() {
  const { settings, timer } = await getState();
  const seconds = timer.isPaused ? timer.remaining : durationFor(timer.mode, settings);
  const next = await setTimer({
    isRunning: true,
    isPaused: false,
    endTime: Date.now() + seconds * 1000,
    remaining: seconds,
  });
  await scheduleAlarms(next);
  await refreshBadge();
}

async function cmdPause() {
  const { timer } = await getState();
  if (!timer.isRunning) return;
  const remaining = Math.max(0, Math.round((timer.endTime - Date.now()) / 1000));
  const next = await setTimer({ isRunning: false, isPaused: true, endTime: null, remaining });
  await scheduleAlarms(next);
  await refreshBadge();
}

async function cmdReset() {
  const { settings, timer } = await getState();
  const next = await setTimer({
    isRunning: false,
    isPaused: false,
    endTime: null,
    remaining: durationFor(timer.mode, settings),
  });
  await scheduleAlarms(next);
  await refreshBadge();
}

async function cmdSetMode(mode) {
  const { settings } = await getState();
  const next = await setTimer({
    mode,
    isRunning: false,
    isPaused: false,
    endTime: null,
    remaining: durationFor(mode, settings),
  });
  await scheduleAlarms(next);
  await refreshBadge();
}

async function cmdSkip() {
  await advancePhase({ silent: true });
}

// Nudge the current countdown by deltaSeconds (positive = extend, negative = shorten).
// Works whether the timer is running, paused, or idle; clamped to 1s..180min.
async function cmdAdjust(deltaSeconds) {
  const { timer } = await getState();
  const MIN = 1, MAX = 180 * 60;
  const clamp = (s) => Math.min(MAX, Math.max(MIN, s));
  if (timer.isRunning && timer.endTime) {
    const current = Math.max(0, Math.round((timer.endTime - Date.now()) / 1000));
    const remaining = clamp(current + deltaSeconds);
    const next = await setTimer({ endTime: Date.now() + remaining * 1000, remaining });
    await scheduleAlarms(next);
  } else {
    const next = await setTimer({ remaining: clamp(timer.remaining + deltaSeconds) });
    await scheduleAlarms(next);
  }
  await refreshBadge();
}

async function cmdSettingsChanged() {
  const { settings, timer } = await getState();
  if (!timer.isRunning && !timer.isPaused) {
    await setTimer({ remaining: durationFor(timer.mode, settings) });
  }
  await refreshBadge();
}

// ----------------------------- transition -----------------------------

function nextMode(mode) {
  return mode === "focus" ? "break" : "focus";
}

async function advancePhase({ silent = false } = {}) {
  const { settings, timer } = await getState();
  const finishedMode = timer.mode;
  const mode = nextMode(finishedMode);
  const completedFocusTotal =
    finishedMode === "focus" ? timer.completedFocusTotal + 1 : timer.completedFocusTotal;
  const autoStart = settings.autoStartNext && !silent;
  const seconds = durationFor(mode, settings);

  const next = await setTimer({
    mode,
    completedFocusTotal,
    isRunning: autoStart,
    isPaused: false,
    endTime: autoStart ? Date.now() + seconds * 1000 : null,
    remaining: seconds,
  });
  await scheduleAlarms(next);
  await refreshBadge();
  if (!silent) await notifyAndSound(finishedMode, mode, settings);
}

async function notifyAndSound(finishedMode, nextModeName, settings) {
  if (settings.notify) {
    setLanguage(settings.language);
    const title = finishedMode === "focus" ? t("notif.focusDone") : t("notif.breakOver");
    const message =
      nextModeName === "focus" ? t("notif.startFocus") : t("notif.shortBreak");
    try {
      await chrome.notifications.create(`ff-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title,
        message,
        priority: 2,
      });
    } catch (e) {}
  }
  if (settings.sound && settings.sound !== "none") {
    // distinct pitch direction: ending focus -> rest tone; ending break -> go tone
    await playSound(settings.sound, settings.volume, finishedMode === "focus" ? "rest" : "go");
  }
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Play the timer transition chime when no tab is open.",
  });
}

async function playSound(sound, volume, variant = "go") {
  try {
    await ensureOffscreen();
    await chrome.runtime.sendMessage({ target: "offscreen", type: "play", sound, volume, variant });
  } catch (e) {}
}

// ----------------------------- wiring -----------------------------

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("app.html");
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId != null) await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_COMPLETE) await advancePhase({ silent: false });
  else if (alarm.name === ALARM_TICK) await refreshBadge();
  else if (alarm.name === ALARM_SLACK) await pollSlack();
  else if (alarm.name === ALARM_SNAPSHOT) await takeSnapshot({ auto: true });
  else if (alarm.name === ALARM_AUTOBACKUP) await autoBackupToFile();
});

// Arm the snapshot debounce whenever the user's content changes. Our own backup
// bookkeeping (backups/lastAutoBackup) isn't in BACKUP_DATA_KEYS, so it can't
// retrigger this.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!BACKUP_DATA_KEYS.some((key) => key in changes)) return;
  chrome.alarms.create(ALARM_SNAPSHOT, { delayInMinutes: SNAPSHOT_DEBOUNCE_MINUTES });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target === "offscreen") return;
  (async () => {
    let result;
    switch (msg.type) {
      case "start": await cmdStart(); break;
      case "pause": await cmdPause(); break;
      case "reset": await cmdReset(); break;
      case "skip": await cmdSkip(); break;
      case "adjust": await cmdAdjust(msg.seconds); break;
      case "setMode": await cmdSetMode(msg.mode); break;
      case "settingsChanged": await cmdSettingsChanged(); break;
      case "previewSound": await playSound(msg.sound, msg.volume, "go"); break;
      case "refreshBadge": await refreshBadge(); break;
      case "slackConnect": await scheduleSlack(); result = await pollSlack(); break;
      case "slackRefresh": result = await pollSlack(); break;
      case "slackUnread": result = await getSlackUnread(); break;
      case "slackDisconnect": await slackDisconnect(); break;
      case "aiExplain": result = await runAiTask("explain", msg.payload); break;
      case "aiDraft": result = await runAiTask("draft", msg.payload); break;
      case "aiSummarize": result = await runAiTask("summarize", msg.payload); break;
      case "snapshotNow": await takeSnapshot({ auto: false }); break;
    }
    sendResponse(result || { ok: true });
  })();
  return true;
});

function emptyColumns() {
  return [
    { id: crypto.randomUUID(), title: "To do", taskIds: [] },
    { id: crypto.randomUUID(), title: "Doing", taskIds: [] },
    { id: crypto.randomUUID(), title: "Done", taskIds: [] },
  ];
}

function workBoard() {
  const t = (title, notes = "") => ({ id: crypto.randomUUID(), title, notes, createdAt: Date.now() });
  const todo = [t("Map the funnel in PostHog"), t("Draft the weekly LinkedIn teardown")];
  const doing = [t("Customer.io observability")];
  const done = [t("Onboarding call with Philip")];
  return {
    id: crypto.randomUUID(),
    name: "Work",
    icon: "💼",
    columns: [
      { id: crypto.randomUUID(), title: "To do", taskIds: todo.map((x) => x.id) },
      { id: crypto.randomUUID(), title: "In progress", taskIds: doing.map((x) => x.id) },
      { id: crypto.randomUUID(), title: "Done", taskIds: done.map((x) => x.id) },
    ],
    tasks: Object.fromEntries([...todo, ...doing, ...done].map((x) => [x.id, x])),
  };
}

function defaultBoards() {
  return [
    { id: crypto.randomUUID(), name: "Personal", icon: "🏠", columns: emptyColumns(), tasks: {} },
    workBoard(),
    { id: crypto.randomUUID(), name: "Lifestyle", icon: "🌿", columns: emptyColumns(), tasks: {} },
  ];
}

async function init() {
  const data = await chrome.storage.local.get(["settings", "timer", "board", "boards"]);
  const patch = {};
  if (!data.settings) patch.settings = DEFAULT_SETTINGS;
  if (!data.timer) patch.timer = DEFAULT_TIMER;
  // Seed the multi-board model on fresh installs. A legacy single `board`
  // (from older versions) is migrated to a board on first app load.
  if (!Array.isArray(data.boards) && !data.board) {
    const boards = defaultBoards();
    patch.boards = boards;
    patch.activeBoardId = boards[0].id;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  await scheduleSlack();
  scheduleAutoBackup();
  await pollSlack();
  await refreshBadge();
}

async function onStartup() {
  await scheduleSlack();
  scheduleAutoBackup();
  await pollSlack();
  await refreshBadge();
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(onStartup);
init();
