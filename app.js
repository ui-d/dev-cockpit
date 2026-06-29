// DevCockpit v2 — board-first daily driver.
// Top bar: minimal timer + Google Calendar + weather. Main area: the board.

import { BACKUP_DATA_KEYS, buildBackup, readBackup, backupFileName } from "./backup.js";
import { fetchAllNews } from "./news.js";

const EXT_ID = "aiegllbeihjbphiilgeifggceklfffkn"; // deterministic (from manifest "key")
const OAUTH_PLACEHOLDER = "YOUR_CLIENT_ID.apps.googleusercontent.com";

const DEFAULT_SETTINGS = {
  focusMin: 25,
  breakMin: 5,
  autoStartNext: true,
  sound: "gong",
  volume: 0.7,
  notify: true,
  theme: "auto",
  accent: "ember",
  city: "",
  lat: null,
  lon: null,
  autoBackupFile: true,
  view: "boards",
};

const $ = (s) => document.querySelector(s);
const el = {
  body: document.body,
  root: document.documentElement,
  time: $("#timeDisplay"),
  timerDot: $("#timerDot"),
  startPause: $("#startPauseBtn"),
  reset: $("#resetBtn"),
  settingsBtn: $("#settingsBtn"),
  board: $("#board"),
  globalList: $("#globalList"),
  // top-bar view switcher
  viewNav: $("#viewNav"),
  workspace: $("#workspace"),
  ideasView: $("#ideasView"),
  newsView: $("#newsView"),
  // ideas canvas
  ideasViewport: $("#ideasViewport"),
  ideasLayer: $("#ideasLayer"),
  ideasAdd: $("#ideasAddBtn"),
  ideasTypeBtn: $("#ideasTypeBtn"),
  ideasTypeMenu: $("#ideasTypeMenu"),
  ideasZoomIn: $("#ideasZoomIn"),
  ideasZoomOut: $("#ideasZoomOut"),
  ideasZoomReset: $("#ideasZoomReset"),
  // news feed
  newsFilter: $("#newsFilter"),
  newsRefresh: $("#newsRefresh"),
  newsList: $("#newsList"),
  // calendar
  calPill: $("#calPill"),
  calPillText: $("#calPillText"),
  // weather
  wxPill: $("#wxPill"),
  wxPillText: $("#wxPillText"),
  wxIcon: $("#wxIcon"),
  wxPopover: $("#wxPopover"),
  wxDetail: $("#wxDetail"),
  // slack
  slackPill: $("#slackPill"),
  slackPillText: $("#slackPillText"),
  // gmail
  gmailPill: $("#gmailPill"),
  gmailPillText: $("#gmailPillText"),
  // detail drawer
  detailDrawer: $("#detailDrawer"),
  drawerOverlay: $("#drawerOverlay"),
  drawerBody: $("#drawerBody"),
  drawerTitle: $("#drawerTitle"),
  drawerRefresh: $("#drawerRefresh"),
  drawerClose: $("#drawerClose"),
  // settings dialog
  settingsDialog: $("#settingsDialog"),
  settingsForm: $("#settingsForm"),
  focusMin: $("#focusMin"),
  breakMin: $("#breakMin"),
  autoStartNext: $("#autoStartNext"),
  sound: $("#sound"),
  volume: $("#volume"),
  notify: $("#notify"),
  previewSound: $("#previewSoundBtn"),
  cityInput: $("#cityInput"),
  useLocation: $("#useLocationBtn"),
  wxHint: $("#wxHint"),
  calStatus: $("#calStatus"),
  calConnect: $("#calConnectBtn"),
  calDisconnect: $("#calDisconnectBtn"),
  calHint: $("#calHint"),
  slackWorkspace: $("#slackWorkspace"),
  slackToken: $("#slackToken"),
  slackCookie: $("#slackCookie"),
  slackNotify: $("#slackNotify"),
  slackStatus: $("#slackStatus"),
  slackConnect: $("#slackConnectBtn"),
  slackClear: $("#slackClearBtn"),
  slackHint: $("#slackHint"),
  gmailStatus: $("#gmailStatus"),
  gmailConnect: $("#gmailConnectBtn"),
  gmailDisconnect: $("#gmailDisconnectBtn"),
  gmailNotify: $("#gmailNotify"),
  gmailHint: $("#gmailHint"),
  anthropicKey: $("#anthropicKey"),
  anthropicModel: $("#anthropicModel"),
  anthropicStatus: $("#anthropicStatus"),
  anthropicSave: $("#anthropicSaveBtn"),
  anthropicClear: $("#anthropicClearBtn"),
  anthropicHint: $("#anthropicHint"),
  theme: $("#theme"),
  accent: $("#accentTheme"),
  resetSettings: $("#resetSettingsBtn"),
  // backup & restore
  downloadBackup: $("#downloadBackupBtn"),
  restoreBackup: $("#restoreBackupBtn"),
  restoreFile: $("#restoreFileInput"),
  autoBackupFile: $("#autoBackupFile"),
  backupHistory: $("#backupHistory"),
  // task dialog
  taskDialog: $("#taskDialog"),
  taskForm: $("#taskForm"),
  taskTitle: $("#taskTitle"),
  taskNotes: $("#taskNotes"),
  deleteTask: $("#deleteTaskBtn"),
  taskDialogTitle: $("#taskDialogTitle"),
  // board rail + board dialog
  rail: $("#boardRail"),
  boardDialog: $("#boardDialog"),
  boardForm: $("#boardForm"),
  boardName: $("#boardName"),
  boardDialogTitle: $("#boardDialogTitle"),
  deleteBoard: $("#deleteBoardBtn"),
  iconPicker: $("#iconPicker"),
};

let settings = { ...DEFAULT_SETTINGS };
let timer = null;
let boards = [];                              // [{ id, name, icon, columns, tasks }]
let activeBoardId = null;
let board = { columns: [], tasks: {} };       // points at the active board
let globalList = { title: "Pinned", taskIds: [], tasks: {} }; // persistent list shown on every board
let tickInterval = null;
let editingTask = null;
let editingBoard = null;                      // board id when editing, null when adding
let pickedIcon = "📋";
let isDragging = false;
let isEditingBoard = false;
let isAddingCard = false;                     // a card composer is open — don't let a re-render wipe it
let calConnected = false;
let slackCfg = null; // { workspaceUrl, token, dCookie, notify } or null
let gmailConnected = false;
let gmailNotify = false;
let anthropicCfg = null; // { apiKey, model } or null
let ideas = { canvases: [], activeId: null };   // free-form sticky-note canvas
let ideasInited = false;                         // first-view lazy render guard
let newsInited = false;                          // first-view lazy load guard
let newsFilter = "all";                          // 'all' | 'hn' | 'devto'
let currentView = "boards";                      // 'boards' | 'ideas' | 'news'

const BOARD_ICONS = ["🏠","💼","🌿","📋","🎯","🚀","💡","📚","🛒","💪","🎨","✈️","💰","🍳","❤️","🔧","🌟","📦","🧠","🎸","📅","🎬","💬","💎","💊","🏦","🛠️","🌙"];

// ----------------------------- messaging -----------------------------

function send(type, extra = {}) {
  try { chrome.runtime.sendMessage({ type, ...extra }); } catch (e) {}
}
function durationFor(mode) { return (mode === "focus" ? settings.focusMin : settings.breakMin) * 60; }
function remainingSeconds() {
  if (!timer) return 0;
  if (timer.isRunning && timer.endTime) return Math.max(0, Math.round((timer.endTime - Date.now()) / 1000));
  return timer.remaining;
}

// ----------------------------- timer -----------------------------

function fmt(total) {
  const m = Math.floor(total / 60), s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function renderTimer() {
  if (!timer) return;
  el.body.dataset.mode = timer.mode;
  el.body.classList.toggle("running", timer.isRunning);
  el.body.classList.toggle("paused", timer.isPaused);

  const remaining = remainingSeconds();
  el.time.textContent = fmt(remaining);
  el.timerDot.style.background =
    timer.isRunning || timer.isPaused ? "" : ""; // CSS drives colour via body classes
  el.startPause.setAttribute("aria-label", timer.isRunning ? "Pause" : "Start");
  el.startPause.title = timer.isRunning ? "Pause (Space)" : timer.isPaused ? "Resume (Space)" : "Start (Space)";
  $("#timer").title = timer.mode === "focus" ? "Focus session" : "Break";

  document.title = timer.isRunning
    ? `${fmt(remaining)} · ${timer.mode === "focus" ? "Focus" : "Break"} — DevCockpit`
    : "DevCockpit";

  updateBadge(remaining);
}

function updateBadge(remaining) {
  if (!timer) return;
  // Timer idle: let the service worker own the badge so it can surface the
  // Slack unread count instead of blanking it every tick.
  if (!timer.isRunning && !timer.isPaused) { send("refreshBadge"); return; }
  const color = timer.isPaused ? "#6b7280" : timer.mode === "focus" ? "#c2603a" : "#4f7d6b";
  chrome.action.setBadgeBackgroundColor({ color });
  let text;
  if (timer.isPaused) text = "||";
  else if (remaining >= 60) text = String(Math.ceil(remaining / 60));
  else text = String(remaining);
  chrome.action.setBadgeText({ text });
}

function startTick() { stopTick(); if (timer && timer.isRunning) tickInterval = setInterval(renderTimer, 1000); }
function stopTick() { if (tickInterval) clearInterval(tickInterval); tickInterval = null; }

el.startPause.addEventListener("click", () => timer && send(timer.isRunning ? "pause" : "start"));
el.reset.addEventListener("click", () => send("reset"));
el.settingsBtn.addEventListener("click", openSettings);

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return; // let shortcuts like Ctrl/Cmd+S through
  if (e.target.matches("input, textarea, select, [contenteditable='true']")) return;
  if (document.querySelector("dialog[open]")) return;
  if (e.key === "1") setView("boards");
  else if (e.key === "2") setView("ideas");
  else if (e.key === "3") setView("news");
  else if (e.code === "Space") { e.preventDefault(); if (timer) send(timer.isRunning ? "pause" : "start"); }
  else if (e.key.toLowerCase() === "r") send("reset");
  else if (e.key.toLowerCase() === "s") send("skip");
  else if (e.key.toLowerCase() === "f") send("setMode", { mode: "focus" });
  else if (e.key.toLowerCase() === "b") send("setMode", { mode: "break" });
  else if (e.key === "+" || e.key === "=" || e.key === "ArrowUp") { e.preventDefault(); send("adjust", { seconds: 60 }); }
  else if (e.key === "-" || e.key === "_" || e.key === "ArrowDown") { e.preventDefault(); send("adjust", { seconds: -60 }); }
  else if (e.key.toLowerCase() === "m") toggleMute();
  else if (e.key.toLowerCase() === "a") toggleAutoStart();
  else if (e.key.toLowerCase() === "t") cycleTheme();
  else if (e.key.toLowerCase() === "n") { e.preventDefault(); const btn = document.querySelector(".global-list .add-card"); if (btn) btn.click(); }
  else if (e.key === "?") { e.preventDefault(); toggleShortcutHelp(); }
  else if (e.key.toLowerCase() === "c") {
    const hovered = document.querySelector(".card:hover");
    if (hovered && hovered.dataset.taskId) deleteCardById(hovered.dataset.taskId);
  }
});

// Ctrl/Cmd+S — save whatever is currently editable, anywhere in the app.
// Capture phase + preventDefault so the browser's "Save page" dialog never opens.
document.addEventListener("keydown", (e) => {
  if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s")) return;
  e.preventDefault();
  e.stopPropagation();

  // 1) An open dialog (settings / task / board): submit its Save button.
  const dialog = document.querySelector("dialog[open]");
  if (dialog) {
    const form = dialog.querySelector("form");
    const saveBtn = dialog.querySelector('button[value="save"]');
    if (form && saveBtn) { form.requestSubmit(saveBtn); flashSaved(); return; }
  }

  // 2) An inline editor (add-card input, column/board title): commit on blur.
  const active = document.activeElement;
  if (active && active.matches('input, textarea, [contenteditable="true"]')) {
    active.blur();
    flashSaved();
    return;
  }

  // 3) Nothing open — board edits already persist immediately. Just confirm.
  flashSaved();
}, true);

// Tiny transient confirmation toast (used by Ctrl/Cmd+S and the Pomodoro shortcuts).
let savedToastEl = null, savedToastTimer = null;
function flashToast(text) {
  if (!savedToastEl) {
    savedToastEl = document.createElement("div");
    savedToastEl.className = "save-toast";
    document.body.appendChild(savedToastEl);
  }
  savedToastEl.textContent = text;
  savedToastEl.classList.add("show");
  if (savedToastTimer) clearTimeout(savedToastTimer);
  savedToastTimer = setTimeout(() => savedToastEl.classList.remove("show"), 1100);
}
function flashSaved() { flashToast("Saved ✓"); }

// ----------------------------- pomodoro / app shortcuts -----------------------------

// M — mute or unmute the phase-transition chime, remembering the previous sound.
let preMuteSound = "gong";
function toggleMute() {
  if (settings.sound !== "none") {
    preMuteSound = settings.sound;
    settings = { ...settings, sound: "none" };
  } else {
    settings = { ...settings, sound: preMuteSound || "gong" };
  }
  chrome.storage.local.set({ settings });
  flashToast(settings.sound === "none" ? "Chime muted 🔇" : "Chime on 🔔");
}

// A — toggle whether the next phase auto-starts when the current one ends.
function toggleAutoStart() {
  settings = { ...settings, autoStartNext: !settings.autoStartNext };
  chrome.storage.local.set({ settings });
  flashToast(settings.autoStartNext ? "Auto-start on ▶" : "Auto-start off ⏸");
}

// T — cycle the theme: auto → dark → light → auto.
const THEME_CYCLE = ["auto", "dark", "light"];
function cycleTheme() {
  const i = THEME_CYCLE.indexOf(settings.theme);
  const next = THEME_CYCLE[(i + 1) % THEME_CYCLE.length];
  settings = { ...settings, theme: next };
  chrome.storage.local.set({ settings });
  applyTheme();
  flashToast(`Theme: ${next}`);
}

// ? — toggle a modal cheat-sheet listing every shortcut.
const SHORTCUT_ROWS = [
  ["1 / 2 / 3", "Switch view: Boards / Ideas / News"],
  ["Space", "Start / pause timer"],
  ["F", "Switch to a focus block"],
  ["B", "Switch to a break"],
  ["R", "Reset current phase"],
  ["S", "Skip to next phase"],
  ["+ / − (↑ / ↓)", "Extend / shorten by 1 min"],
  ["M", "Mute / unmute chime"],
  ["A", "Toggle auto-start next phase"],
  ["T", "Cycle theme (auto / dark / light)"],
  ["N", "Add a card to the Pinned list"],
  ["C", "Delete the card under the cursor"],
  ["Ctrl / ⌘ + S", "Save"],
  ["?", "Show this cheat sheet"],
];
let helpDialog = null;
function buildShortcutHelp() {
  const dlg = document.createElement("dialog");
  dlg.className = "dlg shortcut-help";
  const rows = SHORTCUT_ROWS
    .map(([k, d]) => `<li><kbd>${k}</kbd><span>${d}</span></li>`)
    .join("");
  dlg.innerHTML = `
    <form method="dialog" class="dlg-form">
      <div class="dlg-head"><h2>Keyboard shortcuts</h2></div>
      <ul class="sc-list">${rows}</ul>
      <div class="dlg-actions"><button class="btn" value="close">Close</button></div>
    </form>`;
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  document.body.appendChild(dlg);
  return dlg;
}
function toggleShortcutHelp() {
  if (!helpDialog) helpDialog = buildShortcutHelp();
  if (helpDialog.open) helpDialog.close(); else helpDialog.showModal();
}

// ----------------------------- settings -----------------------------

function applyTheme() {
  el.root.dataset.theme = settings.theme || "auto";
  el.root.dataset.accent = settings.accent || "ember";
}

function openSettings() {
  el.focusMin.value = settings.focusMin;
  el.breakMin.value = settings.breakMin;
  el.autoStartNext.checked = settings.autoStartNext;
  el.sound.value = settings.sound;
  el.volume.value = settings.volume;
  el.notify.checked = settings.notify;
  el.cityInput.value = settings.city || "";
  el.theme.value = settings.theme;
  el.accent.value = settings.accent || "ember";
  el.wxHint.textContent = settings.lat != null ? "" : "Type a city or use your location.";
  renderCalSettings();
  el.slackWorkspace.value = slackCfg ? slackCfg.workspaceUrl || "" : "";
  el.slackToken.value = slackCfg ? slackCfg.token || "" : "";
  el.slackCookie.value = slackCfg ? slackCfg.dCookie || "" : "";
  el.slackNotify.checked = slackCfg ? !!slackCfg.notify : false;
  renderSlackSettings();
  el.gmailNotify.checked = gmailNotify;
  renderGmailSettings();
  renderAnthropicSettings();
  el.autoBackupFile.checked = settings.autoBackupFile !== false;
  renderBackupHistory();
  setSettingsTab("timer");
  el.settingsDialog.showModal();
}

// Switch which settings tab panel is visible.
function setSettingsTab(name) {
  document.querySelectorAll("#settingsTabs .dlg-tab").forEach((tab) => {
    const on = tab.dataset.tab === name;
    tab.classList.toggle("is-active", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll("#settingsForm .tab-panel").forEach((panel) => {
    const on = panel.dataset.tab === name;
    panel.classList.toggle("is-active", on);
    panel.hidden = !on;
  });
}
document.getElementById("settingsTabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".dlg-tab");
  if (tab) setSettingsTab(tab.dataset.tab);
});

function readSettingsForm() {
  const clampInt = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return {
    focusMin: clampInt(el.focusMin.value, 1, 180, 25),
    breakMin: clampInt(el.breakMin.value, 1, 60, 5),
    autoStartNext: el.autoStartNext.checked,
    sound: el.sound.value,
    volume: parseFloat(el.volume.value),
    notify: el.notify.checked,
    theme: el.theme.value,
    accent: el.accent.value,
    autoBackupFile: el.autoBackupFile.checked,
  };
}

el.settingsForm.addEventListener("submit", async (e) => {
  if (!(e.submitter && e.submitter.value === "save")) return;
  const prevLoc = `${settings.lat},${settings.lon}`;
  settings = { ...settings, ...readSettingsForm() };
  await chrome.storage.local.set({ settings });
  applyTheme();
  send("settingsChanged");
  renderTimer();
  if (`${settings.lat},${settings.lon}` !== prevLoc && settings.lat != null) loadWeather(true);
});

el.resetSettings.addEventListener("click", () => {
  const { city, lat, lon } = settings;
  settings = { ...DEFAULT_SETTINGS, city, lat, lon };
  el.focusMin.value = settings.focusMin; el.breakMin.value = settings.breakMin;
  el.autoStartNext.checked = settings.autoStartNext; el.sound.value = settings.sound;
  el.volume.value = settings.volume; el.notify.checked = settings.notify; el.theme.value = settings.theme;
  el.accent.value = settings.accent; el.autoBackupFile.checked = settings.autoBackupFile !== false;
  el.root.dataset.theme = settings.theme; el.root.dataset.accent = settings.accent;
});

el.previewSound.addEventListener("click", () => send("previewSound", { sound: el.sound.value, volume: parseFloat(el.volume.value) }));
el.theme.addEventListener("change", () => (el.root.dataset.theme = el.theme.value));
el.accent.addEventListener("change", () => (el.root.dataset.accent = el.accent.value));

// ----------------------------- backup & restore -----------------------------

function setBackupHint(msg, isError) {
  const hint = $("#backupHint");
  if (!hint) return;
  hint.textContent = msg;
  hint.classList.toggle("error", !!isError);
}

// Manual export: trigger a download of the current boards + settings. Done in the
// page (no `downloads` permission needed); the worker handles the auto version.
async function downloadBackup() {
  try {
    const data = await chrome.storage.local.get(BACKUP_DATA_KEYS);
    const json = JSON.stringify(buildBackup(data), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFileName(new Date());
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackupHint("Backup downloaded.", false);
  } catch (e) {
    setBackupHint("Couldn't create the backup file.", true);
  }
}

// Apply a restored data bag: snapshot the current state first (so the restore is
// itself undoable), then overwrite and reload for a clean re-init.
async function applyRestore(parsed) {
  try {
    await chrome.runtime.sendMessage({ type: "snapshotNow" });
  } catch (e) {}
  const patch = { boards: parsed.boards, activeBoardId: parsed.activeBoardId };
  if (parsed.settings) patch.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
  if (parsed.globalList) patch.globalList = parsed.globalList;
  if (parsed.ideas) patch.ideas = parsed.ideas;
  await chrome.storage.local.set(patch);
  location.reload();
}

async function restoreFromFile(file) {
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch (e) {
    setBackupHint("That file isn't valid JSON.", true);
    return;
  }
  let parsed;
  try {
    parsed = readBackup(obj);
  } catch (e) {
    setBackupHint(e.message, true);
    return;
  }
  const boardCount = parsed.boards.length;
  if (!confirm(`Restore ${boardCount} board${boardCount === 1 ? "" : "s"} from this backup?\n\nThis replaces your current boards and settings. A snapshot of the current state is kept so you can undo it.`)) {
    return;
  }
  await applyRestore(parsed);
}

async function renderBackupHistory() {
  const { backups } = await chrome.storage.local.get("backups");
  const list = Array.isArray(backups) ? backups : [];
  if (!list.length) {
    el.backupHistory.innerHTML = `<p class="hint">No snapshots yet — they're taken automatically a couple of minutes after you make changes.</p>`;
    return;
  }
  const rows = list
    .map((s, i) => {
      const when = new Date(s.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      const n = Array.isArray(s.data && s.data.boards) ? s.data.boards.length : 0;
      const tag = s.auto === false ? " · manual" : "";
      return `<div class="backup-snap">
        <span class="backup-snap-when">${when}${tag}</span>
        <span class="backup-snap-meta">${n} board${n === 1 ? "" : "s"}</span>
        <button type="button" class="btn btn-ghost sm" data-snap="${i}">Restore</button>
      </div>`;
    })
    .join("");
  el.backupHistory.innerHTML = `<div class="backup-history-head">Recent snapshots</div>${rows}`;
}

el.downloadBackup.addEventListener("click", downloadBackup);
el.restoreBackup.addEventListener("click", () => el.restoreFile.click());
el.restoreFile.addEventListener("change", async () => {
  const file = el.restoreFile.files && el.restoreFile.files[0];
  el.restoreFile.value = ""; // allow re-selecting the same file later
  if (file) await restoreFromFile(file);
});
el.backupHistory.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-snap]");
  if (!btn) return;
  const { backups } = await chrome.storage.local.get("backups");
  const snap = Array.isArray(backups) ? backups[parseInt(btn.dataset.snap, 10)] : null;
  if (!snap || !snap.data) return;
  let parsed;
  try {
    parsed = readBackup(buildBackup(snap.data));
  } catch (err) {
    setBackupHint("That snapshot looks corrupted.", true);
    return;
  }
  const when = new Date(snap.ts).toLocaleString();
  if (!confirm(`Roll back to the snapshot from ${when}?\n\nThis replaces your current boards and settings. The current state is snapshotted first, so you can undo it.`)) {
    return;
  }
  await applyRestore(parsed);
});

// ----------------------------- boards -----------------------------

async function saveBoard() { await chrome.storage.local.set({ boards, activeBoardId }); }
async function saveGlobalList() { await chrome.storage.local.set({ globalList }); }
function newId() { return crypto.randomUUID(); }

// Find a task currently on screen (active board or the global list) by id.
function findTask(taskId) { return board.tasks[taskId] || globalList.tasks[taskId] || null; }

// Locate which container (a board column or the global list) holds a task,
// along with the task map that owns it. Returns null if it isn't on screen.
function locateTask(taskId) {
  const col = board.columns.find((c) => c.taskIds.includes(taskId));
  if (col) return { container: col, tasks: board.tasks };
  if (globalList.taskIds.includes(taskId)) return { container: globalList, tasks: globalList.tasks };
  return null;
}

// Delete a card from wherever it lives (used by the editor and the 'c' shortcut).
function deleteCardById(taskId) {
  const loc = locateTask(taskId);
  if (!loc) return;
  loc.container.taskIds = loc.container.taskIds.filter((id) => id !== taskId);
  delete loc.tasks[taskId];
  saveBoard(); saveGlobalList(); renderBoard(); renderGlobalList();
}

function defaultColumns() {
  return [
    { id: newId(), title: "To do", taskIds: [] },
    { id: newId(), title: "Doing", taskIds: [] },
    { id: newId(), title: "Done", taskIds: [] },
  ];
}
function makeBoard(name, icon) {
  return { id: newId(), name, icon, columns: defaultColumns(), tasks: {} };
}
function defaultBoards() {
  return [makeBoard("Personal", "🏠"), makeBoard("Work", "💼"), makeBoard("Lifestyle", "🌿")];
}

// ----------------------------- Trello import (one-time seed) -----------------------------

// Columns lifted from the user's Trello, grouped into sensible boards.
const TRELLO_SEED = [
  {
    name: "Priorytety",
    icon: "🎯",
    columns: [
      { title: "Priorytety", cards: [
        "ODWAŻNE CELE",
        "Komunia Święta 2x / msc",
        "Otwórz swe serce, a narodzisz się na nowo",
        "Focus",
        "Sesje myślenie / medytacja / zeszyt",
      ] },
      { title: "Communication", cards: [
        "Zachowuj się jak osoba którą chcesz być",
        "Choose who you want to be",
        "Talk",
        "Still other patterns",
        "More Energy at the beginning",
      ] },
      { title: "Glow Up", cards: [
        "Brwi",
        "testosteron",
        "Dagestan",
      ] },
      { title: "Movies / Books", cards: [
        "Perfect Days",
        "Peterson",
        "Sekretne życie Waltera Mitty",
        "Old Henry",
        "christian bale",
      ] },
    ],
  },
  {
    name: "Zakupy",
    icon: "🛒",
    columns: [
      { title: "Zakupy", cards: [
        "Zegarek",
        "D&G The One Parfum",
        "boss bottled absolu",
        "Club De Nuit Urban Elixir Armaf",
        "hasas fire",
        "dior cologne",
        "al haramain detour noir",
        "mietlica trawa",
        "eros energy",
      ] },
    ],
  },
  {
    name: "Finanse",
    icon: "💰",
    columns: [
      { title: "Wydatki", cards: [
        "aparat: 25k",
        "oszczednosci 100k",
        "samochód - 100k",
        "remont: 70k",
      ] },
      { title: "Subskrypcje", cards: [
        "Youtube",
        "Claude Code",
        "Lotto",
        "Obsidian",
      ] },
    ],
  },
  {
    name: "Plan 2026",
    icon: "📅",
    columns: [
      { title: "Kalendarz 2026", cards: [
        "Styczeń: 40stka, łazienka, lampy w kuchni",
        "Luty: łazienka",
        "Marzec: łazienka / donice / stojak na rowery",
        "Kwiecień: myjka",
        "Maj: praca",
        "Czerwiec: Szczyrk: ścieżka w ogrodku, oksy, tv",
        "Lipiec: gravel, aparat, pompa cyrkulacyjna",
        "Wrzesień: 90kg, Warszawa - Zadar, rolety",
        "Październik: kapsułka endoskopowa, badania, Barnaba",
        "Listopad: poddasze",
        "Grudzień: Oszczędności 500k - IKE, IKZE, OKI, konta oszczędnościowe, obligacje",
      ] },
    ],
  },
];

function buildSeededBoard(spec) {
  const b = { id: newId(), name: spec.name, icon: spec.icon, columns: [], tasks: {} };
  spec.columns.forEach((colSpec) => {
    const col = { id: newId(), title: colSpec.title, taskIds: [] };
    colSpec.cards.forEach((text) => {
      const t = { id: newId(), title: text, notes: "", createdAt: Date.now() };
      b.tasks[t.id] = t;
      col.taskIds.push(t.id);
    });
    b.columns.push(col);
  });
  return b;
}

function boardIsEmpty(b) {
  return !b.tasks || Object.keys(b.tasks).length === 0;
}
function syncActiveBoard() {
  board = boards.find((b) => b.id === activeBoardId) || boards[0];
  if (board) activeBoardId = board.id;
}
function switchBoard(id) {
  if (id === activeBoardId) return;
  activeBoardId = id;
  syncActiveBoard();
  saveBoard();
  renderRail();
  renderBoard();
}

function renderRail() {
  el.rail.innerHTML = "";
  boards.forEach((b) => {
    const btn = document.createElement("button");
    btn.className = "rail-item" + (b.id === activeBoardId ? " active" : "");
    btn.dataset.boardId = b.id;
    btn.draggable = true;
    btn.title = b.id === activeBoardId ? `${b.name} — click again to edit` : b.name;
    btn.setAttribute("aria-label", b.name);
    const ico = document.createElement("span");
    ico.className = "rail-icon";
    ico.textContent = b.icon || "📋";
    btn.append(ico);
    btn.addEventListener("click", () => (b.id === activeBoardId ? openBoardEditor(b.id) : switchBoard(b.id)));
    btn.addEventListener("dragstart", (e) => { isDragging = true; btn.classList.add("rail-dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", b.id); });
    btn.addEventListener("dragend", () => { btn.classList.remove("rail-dragging"); isDragging = false; commitRailOrderFromDom(); });
    el.rail.appendChild(btn);
  });
  const add = document.createElement("button");
  add.className = "rail-item rail-add";
  add.title = "New board";
  add.setAttribute("aria-label", "New board");
  add.textContent = "+";
  add.addEventListener("click", () => openBoardEditor(null));
  el.rail.appendChild(add);
}

el.rail.addEventListener("dragover", (e) => {
  const dragging = el.rail.querySelector(".rail-dragging");
  if (!dragging) return;                       // ignore card drags
  e.preventDefault();
  const after = getRailDragAfterElement(e.clientY);
  if (after == null) el.rail.insertBefore(dragging, el.rail.querySelector(".rail-add"));
  else el.rail.insertBefore(dragging, after);
});

function getRailDragAfterElement(y) {
  const items = [...el.rail.querySelectorAll(".rail-item:not(.rail-dragging):not(.rail-add)")];
  let closest = { offset: -Infinity, element: null };
  for (const item of items) {
    const box = item.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, element: item };
  }
  return closest.element;
}

async function commitRailOrderFromDom() {
  const ids = [...el.rail.querySelectorAll(".rail-item[data-board-id]")].map((n) => n.dataset.boardId);
  const reordered = ids.map((id) => boards.find((b) => b.id === id)).filter(Boolean);
  if (reordered.length === boards.length) boards = reordered;
  await saveBoard();
  renderRail();
}

// ----------------------------- board editor (add / edit) -----------------------------

function renderIconPicker() {
  el.iconPicker.innerHTML = "";
  BOARD_ICONS.forEach((icon) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "icon-opt" + (icon === pickedIcon ? " selected" : "");
    b.textContent = icon;
    b.addEventListener("click", () => { pickedIcon = icon; renderIconPicker(); });
    el.iconPicker.appendChild(b);
  });
}

function openBoardEditor(id) {
  editingBoard = id;
  const b = id ? boards.find((x) => x.id === id) : null;
  el.boardDialogTitle.textContent = b ? "Edit board" : "New board";
  el.boardName.value = b ? b.name : "";
  pickedIcon = b ? (b.icon || "📋") : "📋";
  el.deleteBoard.hidden = !b || boards.length <= 1;
  renderIconPicker();
  el.boardDialog.showModal();
  el.boardName.focus();
}

el.boardForm.addEventListener("submit", (e) => {
  if (e.submitter && e.submitter.value === "cancel") { editingBoard = null; return; }
  const name = el.boardName.value.trim();
  if (!name) { e.preventDefault(); return; }
  if (editingBoard) {
    const b = boards.find((x) => x.id === editingBoard);
    if (b) { b.name = name; b.icon = pickedIcon; }
  } else {
    const nb = makeBoard(name, pickedIcon);
    boards.push(nb);
    activeBoardId = nb.id;
    syncActiveBoard();
  }
  saveBoard();
  renderRail();
  renderBoard();
  editingBoard = null;
});

el.deleteBoard.addEventListener("click", () => {
  if (!editingBoard || boards.length <= 1) return;
  const b = boards.find((x) => x.id === editingBoard);
  if (!b) return;
  const cardCount = b.columns.reduce((n, c) => n + c.taskIds.length, 0);
  if (cardCount > 0 && !confirm(`Delete board "${b.name}" and its ${cardCount} card(s)?`)) return;
  boards = boards.filter((x) => x.id !== editingBoard);
  if (activeBoardId === editingBoard) { activeBoardId = boards[0].id; syncActiveBoard(); }
  saveBoard();
  renderRail();
  renderBoard();
  editingBoard = null;
  el.boardDialog.close();
});

function renderBoard() {
  el.board.innerHTML = "";
  board.columns.forEach((col) => el.board.appendChild(renderColumn(col)));
  const add = document.createElement("button");
  add.className = "column add-column-btn";
  add.textContent = "+ Add list";
  add.addEventListener("click", addColumn);
  el.board.appendChild(add);
}

// Reorder whole lists by dragging their header grip. Columns sit side by side,
// so we position by horizontal midpoint (clientX), mirroring the card/rail logic.
el.board.addEventListener("dragover", (e) => {
  const dragging = el.board.querySelector(".column-dragging");
  if (!dragging) return;                         // ignore card drags
  e.preventDefault();
  const after = getColumnDragAfterElement(e.clientX);
  if (after == null) el.board.insertBefore(dragging, el.board.querySelector(".add-column-btn"));
  else el.board.insertBefore(dragging, after);
});

function getColumnDragAfterElement(x) {
  const cols = [...el.board.querySelectorAll(".column[data-column-id]:not(.column-dragging)")];
  let closest = { offset: -Infinity, element: null };
  for (const c of cols) {
    const box = c.getBoundingClientRect();
    const offset = x - box.left - box.width / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, element: c };
  }
  return closest.element;
}

function commitColumnOrderFromDom() {
  const ids = [...el.board.querySelectorAll(".column[data-column-id]")].map((n) => n.dataset.columnId);
  const reordered = ids.map((id) => board.columns.find((c) => c.id === id)).filter(Boolean);
  if (reordered.length === board.columns.length) board.columns = reordered;
  saveBoard();
}

function renderColumn(col) {
  const wrap = document.createElement("div");
  wrap.className = "column";
  wrap.dataset.columnId = col.id;

  const head = document.createElement("div");
  head.className = "column-head";

  // drag handle — reorders the whole list among its siblings
  const grip = document.createElement("span");
  grip.className = "column-grip"; grip.textContent = "⠿";
  grip.title = "Drag to reorder list"; grip.setAttribute("aria-label", "Drag to reorder list");
  grip.draggable = true;
  grip.addEventListener("dragstart", (e) => {
    isDragging = true; wrap.classList.add("column-dragging");
    e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", col.id);
    e.dataTransfer.setDragImage(wrap, 20, 20);
  });
  grip.addEventListener("dragend", () => { wrap.classList.remove("column-dragging"); isDragging = false; commitColumnOrderFromDom(); });

  const title = document.createElement("input");
  title.className = "column-title";
  title.value = col.title;
  title.setAttribute("aria-label", "List name");
  title.addEventListener("focus", () => (isEditingBoard = true));
  title.addEventListener("blur", () => {
    isEditingBoard = false;
    const v = title.value.trim() || "Untitled";
    title.value = v;
    if (v !== col.title) { col.title = v; saveBoard(); }
  });
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") title.blur(); });

  const count = document.createElement("span");
  count.className = "column-count";
  count.textContent = String(col.taskIds.length);

  const del = document.createElement("button");
  del.className = "column-del"; del.textContent = "✕"; del.title = "Delete list";
  del.addEventListener("click", () => deleteColumn(col.id));

  // a button to move the whole list to another board
  const move = document.createElement("button");
  move.className = "column-move"; move.textContent = "⤴"; move.title = "Move list to another board";
  move.setAttribute("aria-label", "Move list to another board");
  move.addEventListener("click", (e) => { e.stopPropagation(); openMoveListMenu(col.id, move); });

  head.append(grip, title, count, move, del);

  const list = document.createElement("ul");
  list.className = "column-list";
  list.dataset.columnId = col.id;
  col.taskIds.forEach((tid) => { const t = board.tasks[tid]; if (t) list.appendChild(renderCard(t)); });
  wireDropTarget(list);

  const addBtn = document.createElement("button");
  addBtn.className = "add-card"; addBtn.textContent = "+ Add a card";
  addBtn.addEventListener("click", () => startAddCard(col, board.tasks, saveBoard, list, addBtn));

  wrap.append(head, list, addBtn);
  return wrap;
}

function renderCard(task) {
  const li = document.createElement("li");
  li.className = "card"; li.draggable = true; li.dataset.taskId = task.id; li.tabIndex = 0; li.setAttribute("role", "button");
  const title = document.createElement("div"); title.className = "card-title"; title.textContent = task.title; li.appendChild(title);
  if (task.notes) { const n = document.createElement("div"); n.className = "card-notes"; n.textContent = task.notes; li.appendChild(n); }
  li.addEventListener("click", () => openTaskEditor(task.id));
  li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.code === "Space") { e.preventDefault(); openTaskEditor(task.id); } });
  li.addEventListener("dragstart", (e) => { isDragging = true; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", task.id); });
  li.addEventListener("dragend", () => { li.classList.remove("dragging"); isDragging = false; commitDragFromDom(); });
  return li;
}

function wireDropTarget(list) {
  const host = () => list.closest(".column, .global-list");
  list.addEventListener("dragover", (e) => {
    e.preventDefault();
    const dragging = document.querySelector(".card.dragging");
    if (!dragging) return;
    const after = getDragAfterElement(list, e.clientY);
    if (after == null) list.appendChild(dragging); else list.insertBefore(dragging, after);
    host().classList.add("drag-over");
  });
  list.addEventListener("dragleave", () => host().classList.remove("drag-over"));
  list.addEventListener("drop", (e) => { e.preventDefault(); host().classList.remove("drag-over"); });
}

function getDragAfterElement(container, y) {
  const cards = [...container.querySelectorAll(".card:not(.dragging)")];
  let closest = { offset: -Infinity, element: null };
  for (const card of cards) {
    const box = card.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, element: card };
  }
  return closest.element;
}

// Re-read card order from the DOM after a drag. Cards can cross between the
// active board's columns and the global list, which keep separate task maps, so
// we pool every on-screen task and re-home each one by where its card now sits.
function commitDragFromDom() {
  const pool = { ...board.tasks, ...globalList.tasks };
  const nextBoardTasks = {};
  const nextGlobalTasks = {};

  document.querySelectorAll(".column[data-column-id]").forEach((colEl) => {
    const col = board.columns.find((c) => c.id === colEl.dataset.columnId);
    if (!col) return;
    col.taskIds = [...colEl.querySelectorAll(".card")].map((c) => c.dataset.taskId);
    col.taskIds.forEach((id) => { if (pool[id]) nextBoardTasks[id] = pool[id]; });
    const countEl = colEl.querySelector(".column-count");
    if (countEl) countEl.textContent = String(col.taskIds.length);
  });

  const glEl = document.querySelector(".global-list .column-list");
  if (glEl) {
    globalList.taskIds = [...glEl.querySelectorAll(".card")].map((c) => c.dataset.taskId);
    globalList.taskIds.forEach((id) => { if (pool[id]) nextGlobalTasks[id] = pool[id]; });
    const countEl = document.querySelector(".global-list .column-count");
    if (countEl) countEl.textContent = String(globalList.taskIds.length);
  } else {
    // global list not on screen for some reason — keep its tasks untouched
    Object.assign(nextGlobalTasks, globalList.tasks);
  }

  board.tasks = nextBoardTasks;
  globalList.tasks = nextGlobalTasks;
  saveBoard();
  saveGlobalList();
}

// Open an inline card composer. `container` is a board column or the global list
// (anything with a taskIds array); `tasksMap` owns the task objects; `save`
// persists that store. While it's open, isAddingCard suppresses the storage
// re-render so each Enter can leave the composer in place, ready for the next card.
function startAddCard(container, tasksMap, save, list, addBtn) {
  isAddingCard = true;
  addBtn.style.display = "none";
  const input = document.createElement("textarea");
  input.className = "add-card-input"; input.rows = 2; input.placeholder = "What needs doing?";
  list.after(input); input.focus();

  let teardown = false;
  // Append the new card directly (no full re-render) so the composer keeps focus.
  const commit = () => {
    const text = input.value.trim();
    if (!text) return false;
    const task = { id: newId(), title: text, notes: "", createdAt: Date.now() };
    tasksMap[task.id] = task;
    container.taskIds.push(task.id);
    list.appendChild(renderCard(task));
    const count = list.parentElement.querySelector(".column-count");
    if (count) count.textContent = String(container.taskIds.length);
    save();
    return true;
  };
  const dismiss = () => {
    if (teardown) return;
    teardown = true;
    isAddingCard = false;
    input.remove();
    addBtn.style.display = "";
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (commit()) { input.value = ""; input.focus(); } // ready for the next card
    } else if (e.key === "Escape") {
      teardown = true;            // discard; suppress the blur-commit removal triggers
      isAddingCard = false;
      input.remove();
      addBtn.style.display = "";
    }
  });
  input.addEventListener("blur", () => { if (teardown) return; commit(); dismiss(); });
}

function deleteColumn(columnId) {
  const col = board.columns.find((c) => c.id === columnId);
  if (!col) return;
  if (col.taskIds.length > 0 && !confirm(`Delete "${col.title}" and its ${col.taskIds.length} card(s)?`)) return;
  col.taskIds.forEach((tid) => delete board.tasks[tid]);
  board.columns = board.columns.filter((c) => c.id !== columnId);
  saveBoard(); renderBoard();
}

function addColumn() {
  const col = { id: newId(), title: "New list", taskIds: [] };
  board.columns.push(col); saveBoard(); renderBoard();
  const last = el.board.querySelector(".column[data-column-id]:last-of-type .column-title");
  if (last) { last.focus(); last.select(); }
}

// ----------------------------- move a list to another board -----------------------------

let closeMoveMenu = null;

function openMoveListMenu(columnId, anchor) {
  if (closeMoveMenu) closeMoveMenu();
  const others = boards.filter((b) => b.id !== activeBoardId);

  const menu = document.createElement("div");
  menu.className = "move-menu";
  const head = document.createElement("div");
  head.className = "move-menu-head";
  head.textContent = "Move list to…";
  menu.appendChild(head);

  if (!others.length) {
    const empty = document.createElement("div");
    empty.className = "move-menu-empty";
    empty.textContent = "No other boards yet.";
    menu.appendChild(empty);
  } else {
    others.forEach((b) => {
      const item = document.createElement("button");
      item.className = "move-menu-item";
      const icon = document.createElement("span");
      icon.className = "move-menu-icon"; icon.textContent = b.icon || "📋";
      const name = document.createElement("span"); name.textContent = b.name;
      item.append(icon, name);
      item.addEventListener("click", () => { moveColumnToBoard(columnId, b.id); if (closeMoveMenu) closeMoveMenu(); });
      menu.appendChild(item);
    });
  }

  document.body.appendChild(menu);
  // anchor under the button, kept inside the viewport
  const r = anchor.getBoundingClientRect();
  let left = Math.max(8, r.right - menu.offsetWidth);
  let top = r.bottom + 6;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const onDocClick = (e) => { if (!menu.contains(e.target) && e.target !== anchor) closeMoveMenu(); };
  const onKey = (e) => { if (e.key === "Escape") closeMoveMenu(); };
  closeMoveMenu = () => {
    menu.remove();
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", closeMoveMenu, true);
    closeMoveMenu = null;
  };
  // defer so the click that opened the menu doesn't immediately dismiss it
  setTimeout(() => document.addEventListener("click", onDocClick, true), 0);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", closeMoveMenu, true);
}

function moveColumnToBoard(columnId, targetBoardId) {
  if (targetBoardId === activeBoardId) return;
  const target = boards.find((b) => b.id === targetBoardId);
  const idx = board.columns.findIndex((c) => c.id === columnId);
  if (!target || idx === -1) return;
  if (!target.tasks || typeof target.tasks !== "object") target.tasks = {};
  const [col] = board.columns.splice(idx, 1);
  // carry the list's task objects across to the destination board's task map
  col.taskIds.forEach((tid) => {
    const t = board.tasks[tid];
    if (t) { target.tasks[tid] = t; delete board.tasks[tid]; }
  });
  target.columns.push(col);
  saveBoard();
  renderBoard();
}

// ----------------------------- global (pinned) list -----------------------------

function normalizeGlobalList(raw) {
  const gl = raw && typeof raw === "object" ? raw : {};
  const tasks = gl.tasks && typeof gl.tasks === "object" ? gl.tasks : {};
  const taskIds = Array.isArray(gl.taskIds) ? gl.taskIds.filter((id) => tasks[id]) : [];
  return { title: typeof gl.title === "string" ? gl.title : "Pinned", taskIds, tasks };
}

function renderGlobalList() {
  const host = el.globalList;
  if (!host) return;
  host.innerHTML = "";

  const head = document.createElement("div");
  head.className = "column-head global-list-head";
  const title = document.createElement("span");
  title.className = "global-list-title";
  title.innerHTML = `<span aria-hidden="true">📌</span>`;
  const label = document.createElement("input");
  label.className = "column-title global-list-name";
  label.value = globalList.title || "Pinned";
  label.setAttribute("aria-label", "Pinned list name");
  label.addEventListener("focus", () => (isEditingBoard = true));
  label.addEventListener("blur", () => {
    isEditingBoard = false;
    const v = label.value.trim() || "Pinned";
    label.value = v;
    if (v !== globalList.title) { globalList.title = v; saveGlobalList(); }
  });
  label.addEventListener("keydown", (e) => { if (e.key === "Enter") label.blur(); });
  title.appendChild(label);
  const count = document.createElement("span");
  count.className = "column-count";
  count.textContent = String(globalList.taskIds.length);
  head.append(title, count);

  const list = document.createElement("ul");
  list.className = "column-list";
  list.dataset.globalList = "1";
  globalList.taskIds.forEach((tid) => { const t = globalList.tasks[tid]; if (t) list.appendChild(renderCard(t)); });
  wireDropTarget(list);

  const addBtn = document.createElement("button");
  addBtn.className = "add-card"; addBtn.textContent = "+ Add a card";
  addBtn.addEventListener("click", () => startAddCard(globalList, globalList.tasks, saveGlobalList, list, addBtn));

  // Lower third: the widget tray, rendered from the saved layout (see buildWidgetTray).
  host.append(head, list, addBtn, buildWidgetTray());
}

// ----------------------------- work clock widget -----------------------------

const WORK_START_HOUR = 9; // 9 AM — start of the workday
const WORK_END_HOUR = 17;   // 5 PM — end of the workday the analog clock counts down to
const WORK_BAND_R = 45.5;   // radius of the working-hours gradient band on the dial
let workClockTimer = null;

// Convert a clock-face angle (0° = 12 o'clock, increasing clockwise) to an SVG point.
function clockPoint(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

// Working-hours window expressed as clock-face angles + clockwise sweep between them.
function workAngles() {
  const aStart = (WORK_START_HOUR % 12) * 30;
  const aEnd = (WORK_END_HOUR % 12) * 30;
  return { aStart, aEnd, sweep: ((aEnd - aStart) + 360) % 360 };
}

// Build an SVG arc path string sweeping `sweepDeg` clockwise from `fromDeg` at radius r.
function clockArcPath(fromDeg, sweepDeg, r) {
  const p1 = clockPoint(50, 50, r, fromDeg);
  const p2 = clockPoint(50, 50, r, fromDeg + sweepDeg);
  const largeArc = sweepDeg > 180 ? 1 : 0;
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
}

function buildWorkClockWidget() {
  const wrap = document.createElement("div");
  wrap.className = "work-clock";

  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = i * 30;
    const outer = clockPoint(50, 50, 44, a);
    const inner = clockPoint(50, 50, i % 3 === 0 ? 38 : 40.5, a);
    const cls = i === WORK_END_HOUR % 12 ? "wc-tick wc-tick-end" : "wc-tick";
    const w = i % 3 === 0 ? 1.6 : 1;
    return `<line class="${cls}" x1="${outer.x.toFixed(2)}" y1="${outer.y.toFixed(2)}" x2="${inner.x.toFixed(2)}" y2="${inner.y.toFixed(2)}" stroke-width="${w}" stroke-linecap="round" />`;
  }).join("");

  // 5 PM marker dot sits just inside the rim at the 5 o'clock position.
  const endDot = clockPoint(50, 50, 44, (WORK_END_HOUR % 12) * 30);

  // Static working-hours band (9 AM → 5 PM) painted with a sage→amber→ember gradient.
  const { aStart, sweep } = workAngles();
  const bandPath = clockArcPath(aStart, sweep, WORK_BAND_R);
  const g1 = clockPoint(50, 50, WORK_BAND_R, aStart);
  const g2 = clockPoint(50, 50, WORK_BAND_R, aStart + sweep);

  wrap.innerHTML = `
    <svg class="wc-face" viewBox="0 0 100 100" role="img" aria-label="Working hours — time until 5 PM">
      <defs>
        <linearGradient id="wcGrad" gradientUnits="userSpaceOnUse"
          x1="${g1.x.toFixed(2)}" y1="${g1.y.toFixed(2)}" x2="${g2.x.toFixed(2)}" y2="${g2.y.toFixed(2)}">
          <stop class="wc-g0" offset="0" />
          <stop class="wc-g1" offset="0.5" />
          <stop class="wc-g2" offset="1" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="47" class="wc-rim" />
      <path class="wc-band" d="${bandPath}" fill="none" stroke="url(#wcGrad)" stroke-linecap="round" />
      <path id="wcElapsed" class="wc-elapsed" fill="none" stroke-linecap="round" />
      ${ticks}
      <circle cx="${endDot.x.toFixed(2)}" cy="${endDot.y.toFixed(2)}" r="2.4" class="wc-end-dot" />
      <line id="wcHour" class="wc-hand wc-hour" x1="50" y1="50" x2="50" y2="27" stroke-linecap="round" />
      <line id="wcMin" class="wc-hand wc-min" x1="50" y1="50" x2="50" y2="18" stroke-linecap="round" />
      <line id="wcSec" class="wc-hand wc-sec" x1="50" y1="54" x2="50" y2="14" stroke-linecap="round" />
      <circle cx="50" cy="50" r="2.2" class="wc-pivot" />
    </svg>
    <div class="wc-readout"><span id="wcCountdown" class="wc-countdown">—</span><span class="wc-sub">to 5 PM</span></div>
  `;

  // Keep a single ticking timer alive; it re-targets whatever clock DOM currently exists.
  if (!workClockTimer) workClockTimer = setInterval(updateWorkClock, 1000);
  // Update on the next frame so the freshly-built nodes are in the DOM.
  requestAnimationFrame(updateWorkClock);
  return wrap;
}

function updateWorkClock() {
  const elapsed = document.getElementById("wcElapsed");
  if (!elapsed) return; // widget not mounted right now
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();

  const setHand = (id, angle) => {
    const eln = document.getElementById(id);
    if (eln) eln.setAttribute("transform", `rotate(${angle.toFixed(2)} 50 50)`);
  };
  setHand("wcHour", ((h % 12) + m / 60) * 30);
  setHand("wcMin", (m + s / 60) * 6);
  setHand("wcSec", s * 6);

  const start = new Date(now); start.setHours(WORK_START_HOUR, 0, 0, 0);
  const end = new Date(now); end.setHours(WORK_END_HOUR, 0, 0, 0);
  const diffMin = (end - now) / 60000;       // minutes left until 5 PM
  const elapsedMin = (now - start) / 60000;  // minutes since 9 AM
  const totalMin = (end - start) / 60000;    // workday length

  const { aStart, sweep } = workAngles();
  // Grey out the portion of the working-hours band that has already elapsed.
  const spentMin = Math.max(0, Math.min(elapsedMin, totalMin));
  elapsed.setAttribute("d", spentMin <= 0 ? "" : clockArcPath(aStart, spentMin / 2, WORK_BAND_R));

  const readout = elapsed.parentElement.parentElement.querySelector(".wc-readout");
  const sub = readout && readout.querySelector(".wc-sub");
  const countdown = document.getElementById("wcCountdown");

  if (diffMin <= 0 || diffMin > 12 * 60) {
    // Outside the workday: keep the analog face, hide the countdown readout entirely.
    if (diffMin <= 0) elapsed.setAttribute("d", clockArcPath(aStart, sweep, WORK_BAND_R)); // fully spent
    if (readout) readout.hidden = true;
    return;
  }
  if (readout) readout.hidden = false;

  const hrs = Math.floor(diffMin / 60);
  const mins = Math.floor(diffMin % 60);
  if (countdown) countdown.textContent = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  if (sub) sub.textContent = "to 5 PM";
}

// ----------------------------- soundscape widget -----------------------------
// Relaxing background audio, fully synthesized with Web Audio — no files, no
// network, no extra permissions (same offline ethos as the transition chime).
// Each scene is a small generative graph; playback is a DOM-independent singleton
// so it keeps going while you switch boards and the widget re-renders.

const MUSIC_SCENES = [
  { key: "lofi",    label: "Lofi" },
  { key: "ambient", label: "Ambient" },
  { key: "piano",   label: "Piano" },
  { key: "nature",  label: "Nature" },
  { key: "rain",    label: "Rain" },
];

const Soundscape = (() => {
  const MASTER = 0.6;
  let ac = null, master = null, comp = null;
  let current = null;   // { name, nodes, timers, extraStop? }
  let pending = null;   // a scene mid fade-out, awaiting its deferred teardown
  let stopTimer = null;

  function ctx() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      comp = ac.createDynamicsCompressor();      // gentle safety limiter
      master = ac.createGain(); master.gain.value = 0.0001;
      master.connect(comp).connect(ac.destination);
    }
    return ac;
  }

  // Looping noise bed. "brown" is integrated white noise (soft, low rumble);
  // "white" is raw (bright hiss). Both are short buffers set to loop.
  function noiseBuffer(seconds, kind) {
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    if (kind === "brown") {
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    } else {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return buf;
  }
  function noiseSource(seconds, kind) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(seconds, kind);
    src.loop = true; src.start();
    return src;
  }
  // Oscillate an AudioParam between min and max at `freq` Hz (slow LFOs for
  // wind/rain swells and tremolo). Returns the [osc, gain] nodes so we can stop them.
  function lfo(freq, min, max, param) {
    const osc = ac.createOscillator(); osc.frequency.value = freq;
    const g = ac.createGain(); g.gain.value = (max - min) / 2;
    param.value = (max + min) / 2;
    osc.connect(g).connect(param);
    osc.start();
    return [osc, g];
  }

  // Delicate light rain — soft, muffled, gentle patter rather than a downpour.
  function buildRain(dest) {
    const nodes = [], timers = [];
    const brown = noiseSource(3, "brown"); nodes.push(brown);
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1000; nodes.push(lp);
    const bg = ac.createGain(); bg.gain.value = 0.3; nodes.push(bg);
    brown.connect(lp).connect(bg).connect(dest);

    const white = noiseSource(2, "white"); nodes.push(white);
    const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2000; bp.Q.value = 0.5; nodes.push(bp);
    const hg = ac.createGain(); nodes.push(hg);
    white.connect(bp).connect(hg).connect(dest);
    nodes.push(...lfo(0.06, 0.03, 0.09, hg.gain));     // soft "sheets" swelling gently

    const drip = () => {                                // sparse, soft droplets
      const n = noiseSource(0.2, "white");
      const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 900 + Math.random() * 1800; f.Q.value = 6;
      const g = ac.createGain(); const t = ac.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      n.connect(f).connect(g).connect(dest); n.stop(t + 0.22);
      timers.push(setTimeout(drip, 800 + Math.random() * 2800));
    };
    timers.push(setTimeout(drip, 1000));
    return { nodes, timers };
  }

  // Delicate nature — a soft breeze with the occasional faraway, gentle birdsong.
  function buildNature(dest) {
    const nodes = [], timers = [];
    const wind = noiseSource(3, "brown"); nodes.push(wind);
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420; lp.Q.value = 0.7; nodes.push(lp);
    const wg = ac.createGain(); nodes.push(wg);
    wind.connect(lp).connect(wg).connect(dest);
    nodes.push(...lfo(0.04, 240, 560, lp.frequency));   // slow, soft breeze
    nodes.push(...lfo(0.07, 0.12, 0.28, wg.gain));

    const chirp = () => {                               // sparse, quiet bird calls
      const t0 = ac.currentTime;
      const count = 1 + Math.floor(Math.random() * 3);
      const base = 1900 + Math.random() * 1600;
      for (let i = 0; i < count; i++) {
        const o = ac.createOscillator(); o.type = "sine";
        const g = ac.createGain(); const st = t0 + i * 0.13;
        o.frequency.setValueAtTime(base * (1 + Math.random() * 0.1), st);
        o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.3), st + 0.06);
        o.frequency.exponentialRampToValueAtTime(base, st + 0.12);
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(0.055, st + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 0.13);
        o.connect(g).connect(dest); o.start(st); o.stop(st + 0.16);
      }
      timers.push(setTimeout(chirp, 4000 + Math.random() * 8000));
    };
    timers.push(setTimeout(chirp, 2500));
    return { nodes, timers };
  }

  // Ambient music — a sustained low drone under a lush chord that crossfades very slowly
  // between voicings, with a slow filter drift and a faint high shimmer. Calm, evolving.
  function buildAmbient(dest) {
    const nodes = [], timers = [];
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.4; nodes.push(lp);
    const pad = ac.createGain(); pad.gain.value = 0.0001; nodes.push(pad);
    lp.connect(pad).connect(dest);
    nodes.push(...lfo(0.012, 700, 1500, lp.frequency));   // very slow tone-colour drift
    nodes.push(...lfo(0.05, 0.16, 0.28, pad.gain));        // gentle swell

    const drone = ac.createOscillator(); drone.type = "sine"; drone.frequency.value = 130.81; // C3
    const dg = ac.createGain(); dg.gain.value = 0.12;
    drone.connect(dg).connect(dest); drone.start(); nodes.push(drone, dg);

    const chords = [
      [196.00, 261.63, 329.63, 392.00],   // Cadd9-ish
      [174.61, 261.63, 349.23, 440.00],   // Fmaj9-ish
      [220.00, 293.66, 349.23, 440.00],   // Am add
    ];
    let voices = [];
    const setChord = (notes) => {
      const t = ac.currentTime;
      voices.forEach((v) => { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0.0001, t, 1.6); try { v.o.stop(t + 4.5); } catch (e) {} });
      voices = notes.map((f) => {
        const o = ac.createOscillator(); o.type = "sine"; o.frequency.value = f; o.detune.value = Math.random() * 6 - 3;
        const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.1 / notes.length, t + 2.5);
        o.connect(g).connect(lp); o.start();
        return { o, g };
      });
    };
    let idx = 0; setChord(chords[0]);
    timers.push(setInterval(() => { idx = (idx + 1) % chords.length; setChord(chords[idx]); }, 15000));

    const sh = ac.createOscillator(); sh.type = "sine"; sh.frequency.value = 1567.98; // G6 shimmer
    const shg = ac.createGain(); shg.gain.value = 0.0001;
    sh.connect(shg).connect(dest); sh.start(); nodes.push(sh, shg);
    nodes.push(...lfo(0.07, 0.0001, 0.02, shg.gain));

    return { nodes, timers, extraStop: () => { const t = ac.currentTime; voices.forEach((v) => { try { v.o.stop(t + 0.1); } catch (e) {} }); } };
  }

  // Piano — sparse, soft generative notes from a C-major pentatonic scale; each note is a
  // mellow triangle + octave sine with a quick attack and long decay (gentle, music-like).
  function buildPiano(dest) {
    const nodes = [], timers = [];
    const out = ac.createGain(); out.gain.value = 0.9; nodes.push(out); out.connect(dest);
    const scale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33]; // C D E G A C D
    const note = () => {
      const t = ac.currentTime;
      const f = scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.3 ? 0.5 : 1);
      const o1 = ac.createOscillator(); o1.type = "triangle"; o1.frequency.value = f;
      const o2 = ac.createOscillator(); o2.type = "sine"; o2.frequency.value = f * 2;
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      const g2 = ac.createGain(); g2.gain.value = 0.3; o2.connect(g2).connect(g);
      o1.connect(g).connect(out);
      o1.start(t); o2.start(t); o1.stop(t + 2.6); o2.stop(t + 2.6);
      timers.push(setTimeout(note, 1400 + Math.random() * 2600));
    };
    timers.push(setTimeout(note, 300));
    return { nodes, timers };
  }

  function buildLofi(dest) {
    const nodes = [], timers = [];
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 0.6; nodes.push(lp);
    const pad = ac.createGain(); pad.gain.value = 0.0001; nodes.push(pad);
    lp.connect(pad).connect(dest);
    nodes.push(...lfo(0.2, 0.16, 0.26, pad.gain));      // slow tremolo

    // mellow ii–vi–IV–V style loop; one chord every 6s, voices crossfaded
    const chords = [
      [261.63, 311.13, 392.00, 493.88],
      [220.00, 261.63, 329.63, 392.00],
      [174.61, 220.00, 261.63, 349.23],
      [196.00, 246.94, 293.66, 392.00],
    ];
    let voices = [];
    const setChord = (notes) => {
      const t = ac.currentTime;
      voices.forEach((v) => { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0.0001, t, 0.4); try { v.o.stop(t + 1.6); } catch (e) {} });
      voices = notes.map((f, i) => {
        const o = ac.createOscillator(); o.type = i === 0 ? "sine" : "triangle";
        o.frequency.value = f; o.detune.value = Math.random() * 8 - 4;
        const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime((0.12 / notes.length) * (i === 0 ? 1.4 : 1), t + 0.6);
        o.connect(g).connect(lp); o.start();
        return { o, g };
      });
    };
    let idx = 0; setChord(chords[0]);
    timers.push(setInterval(() => { idx = (idx + 1) % chords.length; setChord(chords[idx]); }, 6000));

    const white = noiseSource(2, "white"); nodes.push(white);   // vinyl crackle
    const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1200; nodes.push(hp);
    const cg = ac.createGain(); cg.gain.value = 0.015; nodes.push(cg);
    white.connect(hp).connect(cg).connect(dest);

    return { nodes, timers, extraStop: () => { const t = ac.currentTime; voices.forEach((v) => { try { v.o.stop(t + 0.1); } catch (e) {} }); } };
  }

  const BUILDERS = { rain: buildRain, nature: buildNature, ambient: buildAmbient, piano: buildPiano, lofi: buildLofi };

  function teardown(scene) {
    scene.timers.forEach((id) => { clearTimeout(id); clearInterval(id); });
    scene.nodes.forEach((n) => { try { n.stop && n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} });
    if (scene.extraStop) try { scene.extraStop(); } catch (e) {}
  }
  function fade(to, dur) {
    const t = ac.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t);
    master.gain.linearRampToValueAtTime(Math.max(0.0001, to), t + dur);
  }

  return {
    isPlaying: () => !!current,
    currentName: () => current && current.name,
    play(name) {
      if (!BUILDERS[name]) return;
      const a = ctx();
      if (a.state === "suspended") a.resume();
      if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
      if (pending) { teardown(pending); pending = null; }   // kill a scene still fading out from a prior stop()
      master.gain.cancelScheduledValues(a.currentTime);
      master.gain.setValueAtTime(0.0001, a.currentTime);   // mute instantly to avoid a click on switch
      if (current) { teardown(current); current = null; }
      current = { name, ...BUILDERS[name](master) };
      fade(MASTER, 0.6);
    },
    stop() {
      if (!current) return;
      fade(0.0001, 0.4);
      pending = current; current = null;
      if (stopTimer) clearTimeout(stopTimer);
      stopTimer = setTimeout(() => { if (pending) { teardown(pending); pending = null; } stopTimer = null; }, 480);
    },
  };
})();

let musicScene = "lofi";   // last-picked scene, so the footer Play knows what to resume

// Every scene is backed by a real internet-radio stream for studio-quality audio; the
// synthesized builders (BUILDERS, above) stay as an automatic offline fallback. Clicking
// a playing scene advances to its next station, then past the last one switches it off —
// so single-station scenes simply toggle, and Lofi cycles its three instrumental channels.
const STREAM_SCENES = {
  lofi: {
    stations: [
      { url: "https://ice1.somafm.com/fluid-128-mp3",       name: "Fluid · instrumental hip-hop" },
      { url: "https://ice1.somafm.com/groovesalad-128-mp3", name: "Groove Salad · chill beats" },
      { url: "https://ice1.somafm.com/beatblender-128-mp3", name: "Beat Blender · downtempo" },
    ],
  },
  ambient: { stations: [{ url: "https://ice1.somafm.com/dronezone-128-mp3", name: "Drone Zone · deep ambient" }] },
  piano:   { stations: [{ url: "https://stream.epic-classical.com/classical-piano", name: "Classical Piano" }] },
  nature:  { stations: [{ url: "https://nature-rex.radioca.st/stream", name: "Nature · field recordings" }] },
  rain:    { stations: [{ url: "https://maggie.torontocast.com:2020/stream/natureradiorain", name: "Rain" }] },
};
let streamAudio = null;
let streamStationIdx = 0;
let activeScene = null;     // scene currently sounding (null = stopped)
let activeEngine = null;    // "stream" | "synth"

function musicIsPlaying() { return activeScene !== null; }
function musicCurrent() { return activeScene; }

function musicStop() {
  if (activeEngine === "stream" && streamAudio) streamAudio.pause();
  if (activeEngine === "synth") Soundscape.stop();
  activeScene = null; activeEngine = null;
}

function musicPlay(scene) {
  musicStop();
  activeScene = scene;
  if (STREAM_SCENES[scene]) { streamStationIdx = 0; startStream(scene); }
  else { activeEngine = "synth"; Soundscape.play(scene); }
}

// Click an already-playing stream scene → advance to the next station; wrap past the
// last one back to "off" so the same button can also stop it.
function musicCycleStation(scene) {
  const stations = STREAM_SCENES[scene].stations;
  streamStationIdx += 1;
  if (streamStationIdx >= stations.length) { streamStationIdx = 0; musicStop(); return; }
  activeScene = scene;
  startStream(scene);
}

function startStream(scene) {
  activeEngine = "stream";
  const stations = STREAM_SCENES[scene].stations;
  const station = stations[streamStationIdx] || stations[0];
  if (!streamAudio) {
    streamAudio = new Audio();
    streamAudio.preload = "none";
    streamAudio.addEventListener("error", () => { if (activeEngine === "stream") fallbackToSynth(scene); });
  }
  streamAudio.src = station.url;
  streamAudio.volume = 0.55;
  const p = streamAudio.play();
  if (p && p.catch) p.catch(() => { if (activeEngine === "stream") fallbackToSynth(scene); });
  flashToast(station.name);
}

// Stream blocked/offline → keep the same scene but switch to the synthesized mix.
function fallbackToSynth(scene) {
  if (activeScene !== scene) return;
  activeEngine = "synth";
  Soundscape.play(scene);
  flashToast("Stream unavailable — playing offline mix");
  refreshMusicUI();
}

function buildMusicWidget() {
  const wrap = document.createElement("div");
  wrap.className = "music-widget";
  // Dimmed layered-waves SVG sits behind the controls; it drifts gently while playing.
  wrap.innerHTML = `
    <svg class="mw-bg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <circle class="mw-bg-orb" cx="74" cy="24" r="11" />
      <path class="mw-bg-w1" d="M0 60 C 18 52 32 64 50 57 S 82 48 100 55 L100 100 L0 100 Z" />
      <path class="mw-bg-w2" d="M0 74 C 20 66 34 80 52 72 S 84 64 100 71 L100 100 L0 100 Z" />
      <path class="mw-bg-w3" d="M0 87 C 16 80 36 92 54 85 S 86 79 100 86 L100 100 L0 100 Z" />
    </svg>
    <div class="mw-head">
      <span class="mw-title"><span aria-hidden="true">🎵</span> Soundscapes</span>
      <span class="mw-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    </div>
    <div class="mw-grid"></div>
  `;
  const grid = wrap.querySelector(".mw-grid");
  MUSIC_SCENES.forEach((s) => {
    const chip = document.createElement("button");
    chip.type = "button"; chip.className = "mw-chip"; chip.dataset.scene = s.key;
    chip.setAttribute("aria-label", `Play ${s.label}`);
    chip.innerHTML = `<span class="mw-chip-label">${s.label}</span>`;
    chip.addEventListener("click", () => {
      musicScene = s.key;
      if (musicCurrent() === s.key) {
        if (STREAM_SCENES[s.key]) musicCycleStation(s.key); else musicStop();
      } else {
        musicPlay(s.key);
      }
      refreshMusicUI();
    });
    grid.appendChild(chip);
  });
  syncMusicWidget(wrap);
  return wrap;
}

function refreshMusicUI() {
  const root = document.querySelector(".music-widget");
  if (root) syncMusicWidget(root);
}

// Reflect the singleton player's state: glow + EQ while playing, and highlight the
// active scene. Clicking the active chip stops it (there is no separate Pause button).
function syncMusicWidget(root) {
  const playingName = musicCurrent();
  root.classList.toggle("playing", musicIsPlaying());
  root.querySelectorAll(".mw-chip").forEach((c) => {
    const on = c.dataset.scene === playingName;
    c.classList.toggle("active", on);
    c.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

// ----------------------------- widget tray + manager -----------------------------
// The pinned list's lower tray holds up to WIDGET_SLOTS widgets. Which widget sits in
// which slot is data, persisted in `widgetLayout` and edited via the manager modal, so
// new widgets only need a registry entry to become placeable.

const WIDGET_REGISTRY = {
  workclock:   { id: "workclock",   name: "Work clock",  build: buildWorkClockWidget },
  soundscapes: { id: "soundscapes", name: "Soundscapes", build: buildMusicWidget },
};
const WIDGET_SLOTS = 4;
const DEFAULT_WIDGET_LAYOUT = ["workclock", "soundscapes", null, null];
let widgetLayout = DEFAULT_WIDGET_LAYOUT.slice();

// Keep the layout to WIDGET_SLOTS entries, drop unknown ids, and never place the same
// widget twice (a widget lives in exactly one slot).
function normalizeWidgetLayout(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < WIDGET_SLOTS; i++) {
    const id = arr[i];
    if (id && WIDGET_REGISTRY[id] && !seen.has(id)) { out.push(id); seen.add(id); }
    else out.push(null);
  }
  return out;
}
async function saveWidgetLayout() { await chrome.storage.local.set({ widgetLayout }); }

// Build the 2×2 tray from the current layout. Empty slots open the manager when clicked.
function buildWidgetTray() {
  const tray = document.createElement("div");
  tray.className = "widget-tray";

  const head = document.createElement("div");
  head.className = "widget-tray-head";
  head.innerHTML = `<span class="widget-tray-title">Widgets</span>`;
  const manage = document.createElement("button");
  manage.type = "button"; manage.className = "widget-tray-manage";
  manage.textContent = "⚙"; manage.title = "Manage widgets"; manage.setAttribute("aria-label", "Manage widgets");
  manage.addEventListener("click", openWidgetManager);
  head.appendChild(manage);

  const grid = document.createElement("div");
  grid.className = "global-widgets";
  widgetLayout.forEach((id, i) => {
    const slot = document.createElement("div");
    slot.className = "widget-slot"; slot.dataset.slot = String(i + 1);
    const w = id && WIDGET_REGISTRY[id];
    if (w) {
      slot.classList.add("widget-filled");
      if (id === "soundscapes") slot.classList.add("widget-music-slot");
      slot.appendChild(w.build());
    } else {
      slot.classList.add("widget-empty");
      slot.innerHTML = `<span class="widget-empty-mark" aria-hidden="true">+</span><span class="widget-empty-label">Add widget</span>`;
      slot.addEventListener("click", openWidgetManager);
    }
    grid.appendChild(slot);
  });

  tray.append(head, grid);
  return tray;
}

let widgetMgrDialog = null;
function openWidgetManager() {
  if (!widgetMgrDialog) {
    widgetMgrDialog = document.createElement("dialog");
    widgetMgrDialog.className = "dlg widget-mgr";
    widgetMgrDialog.addEventListener("click", (e) => { if (e.target === widgetMgrDialog) widgetMgrDialog.close(); });
    document.body.appendChild(widgetMgrDialog);
  }
  renderWidgetManager();
  if (!widgetMgrDialog.open) widgetMgrDialog.showModal();
}

function renderWidgetManager() {
  const dlg = widgetMgrDialog;
  if (!dlg) return;
  const slotsHtml = widgetLayout.map((id, i) => {
    const w = id && WIDGET_REGISTRY[id];
    return `<li class="wm-slot">
      <span class="wm-slot-n">${i + 1}</span>
      <span class="wm-slot-name ${w ? "" : "is-empty"}">${w ? w.name : "Empty"}</span>
      <span class="wm-slot-actions">
        <button type="button" class="wm-mv" data-i="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} title="Move up" aria-label="Move up">↑</button>
        <button type="button" class="wm-mv" data-i="${i}" data-dir="1" ${i === WIDGET_SLOTS - 1 ? "disabled" : ""} title="Move down" aria-label="Move down">↓</button>
        ${w ? `<button type="button" class="wm-rm" data-i="${i}" title="Remove" aria-label="Remove">✕</button>` : `<span class="wm-rm-spacer"></span>`}
      </span>
    </li>`;
  }).join("");
  const placed = new Set(widgetLayout.filter(Boolean));
  const available = Object.values(WIDGET_REGISTRY).filter((w) => !placed.has(w.id));
  const hasEmpty = widgetLayout.some((x) => !x);
  const availHtml = available.length
    ? available.map((w) => `<li class="wm-avail"><span>${w.name}</span><button type="button" class="wm-add" data-id="${w.id}" ${hasEmpty ? "" : "disabled"} title="${hasEmpty ? "Add to first empty slot" : "No empty slot"}">Add</button></li>`).join("")
    : `<li class="wm-note">All widgets are placed.</li>`;
  dlg.innerHTML = `
    <form method="dialog" class="dlg-form">
      <div class="dlg-head"><h2>Manage widgets</h2></div>
      <div class="wm-section">Slots</div>
      <ul class="wm-list">${slotsHtml}</ul>
      <div class="wm-section">Available</div>
      <ul class="wm-list">${availHtml}</ul>
      <div class="dlg-actions"><button class="btn" value="close">Done</button></div>
    </form>`;
  dlg.querySelectorAll(".wm-mv").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); moveWidget(+b.dataset.i, +b.dataset.dir); }));
  dlg.querySelectorAll(".wm-rm").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); removeWidgetAt(+b.dataset.i); }));
  dlg.querySelectorAll(".wm-add").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); addWidget(b.dataset.id); }));
}

function addWidget(id) {
  if (!WIDGET_REGISTRY[id] || widgetLayout.includes(id)) return;
  const empty = widgetLayout.indexOf(null);
  if (empty === -1) return;
  widgetLayout[empty] = id;
  commitWidgetLayout();
}
function removeWidgetAt(i) { widgetLayout[i] = null; commitWidgetLayout(); }
function moveWidget(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= WIDGET_SLOTS) return;
  [widgetLayout[i], widgetLayout[j]] = [widgetLayout[j], widgetLayout[i]];
  commitWidgetLayout();
}
function commitWidgetLayout() {
  widgetLayout = normalizeWidgetLayout(widgetLayout);
  // If the soundscapes widget was removed, stop its audio — there's no UI left to do it.
  if (!widgetLayout.includes("soundscapes") && musicIsPlaying()) musicStop();
  saveWidgetLayout();
  renderGlobalList();      // rebuild the tray
  renderWidgetManager();   // refresh the modal
}

// ----------------------------- task editor -----------------------------

function openTaskEditor(taskId) {
  const task = findTask(taskId);
  if (!task) return;
  editingTask = { taskId };
  el.taskTitle.value = task.title; el.taskNotes.value = task.notes || "";
  el.taskDialog.showModal(); el.taskTitle.focus();
}
el.taskForm.addEventListener("submit", (e) => {
  if (e.submitter && e.submitter.value === "cancel") return;
  if (!editingTask) return;
  const task = findTask(editingTask.taskId); if (!task) return;
  const title = el.taskTitle.value.trim(); if (!title) { e.preventDefault(); return; }
  task.title = title; task.notes = el.taskNotes.value.trim();
  saveBoard(); saveGlobalList(); renderBoard(); renderGlobalList(); editingTask = null;
});
el.deleteTask.addEventListener("click", () => {
  if (!editingTask) return;
  deleteCardById(editingTask.taskId);
  editingTask = null; el.taskDialog.close();
});

// ----------------------------- popovers -----------------------------

// Weather keeps a lightweight dropdown popover; calendar/slack/gmail open the drawer.
function toggleWxPopover() {
  const open = !el.wxPopover.hidden;
  closeWxPopover();
  if (!open) { el.wxPopover.hidden = false; el.wxPill.setAttribute("aria-expanded", "true"); }
}
function closeWxPopover() {
  el.wxPopover.hidden = true;
  el.wxPill.setAttribute("aria-expanded", "false");
}
el.wxPill.addEventListener("click", (e) => { e.stopPropagation(); toggleWxPopover(); });
document.addEventListener("click", (e) => {
  if (!el.wxPopover.contains(e.target) && !el.wxPill.contains(e.target)) closeWxPopover();
});

// ----------------------------- detail drawer -----------------------------

let drawerSource = null; // 'cal' | 'slack' | 'gmail' | null
const DRAWER_TITLES = { cal: "Calendar", slack: "Slack", gmail: "Gmail" };

function openDrawer(source) {
  drawerSource = source;
  closeWxPopover();
  el.drawerTitle.textContent = DRAWER_TITLES[source] || "Details";
  el.detailDrawer.hidden = false;
  el.drawerOverlay.hidden = false;
  el.detailDrawer.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => el.detailDrawer.classList.add("open"));
  loadDrawer(false);
}
function closeDrawer() {
  drawerSource = null;
  el.detailDrawer.classList.remove("open");
  el.detailDrawer.setAttribute("aria-hidden", "true");
  el.drawerOverlay.hidden = true;
  setTimeout(() => { if (!drawerSource) el.detailDrawer.hidden = true; }, 220);
}
function loadDrawer(force) {
  if (drawerSource === "cal") loadCalendarDrawer(force);
  else if (drawerSource === "slack") loadSlackDrawer();
  else if (drawerSource === "gmail") loadGmailDrawer(force);
}
function drawerMsg(text, cls = "drawer-empty") {
  el.drawerBody.innerHTML = "";
  const d = document.createElement("div");
  d.className = cls; d.textContent = text;
  el.drawerBody.appendChild(d);
}

el.calPill.addEventListener("click", (e) => { e.stopPropagation(); openDrawer("cal"); });
el.slackPill.addEventListener("click", (e) => { e.stopPropagation(); openDrawer("slack"); });
el.gmailPill.addEventListener("click", (e) => { e.stopPropagation(); openDrawer("gmail"); });
el.drawerClose.addEventListener("click", closeDrawer);
el.drawerOverlay.addEventListener("click", closeDrawer);
el.drawerRefresh.addEventListener("click", () => loadDrawer(true));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (drawerSource) closeDrawer();
  closeWxPopover();
});

// ---- calendar drawer ----
async function loadCalendarDrawer(force) {
  if (drawerSource !== "cal") return;
  if (!calConfigured() || !calConnected) { drawerMsg("Connect Google Calendar in settings to see your events."); return; }
  drawerMsg("Loading…", "drawer-loading");
  try {
    const cache = (await chrome.storage.local.get("calCache")).calCache;
    const fresh = cache && Date.now() - cache.ts < 5 * 60 * 1000;
    let events;
    if (fresh && !force) {
      events = cache.events;
    } else {
      const token = await getToken(false, CAL_SCOPES);
      events = await calFetchEvents(token);
      await chrome.storage.local.set({ calCache: { events, ts: Date.now() } });
      renderCalendar(events); // keep the pill in sync
    }
    if (drawerSource === "cal") renderCalendarDrawer(events);
  } catch (e) {
    if (drawerSource === "cal") drawerMsg("Couldn't load your calendar. Try reconnecting in settings.");
  }
}
function renderCalendarDrawer(events) {
  const now = Date.now();
  const todayStart = startOfDay(now);
  const tomorrowStart = todayStart + 86400000;
  const dayAfterStart = tomorrowStart + 86400000;
  const todays = events.filter((e) => e.startMs >= todayStart && e.startMs < tomorrowStart);
  const tomorrows = events.filter((e) => e.startMs >= tomorrowStart && e.startMs < dayAfterStart);
  el.drawerBody.innerHTML = "";
  el.drawerBody.appendChild(renderCalDrawerSection("Today", todays, now));
  el.drawerBody.appendChild(renderCalDrawerSection("Tomorrow", tomorrows, now));
}
function renderCalDrawerSection(label, list, now) {
  const wrap = document.createElement("div");
  wrap.className = "cal-section";
  const head = document.createElement("div");
  head.className = "cal-day-head"; head.textContent = label;
  wrap.appendChild(head);
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "cal-empty"; empty.textContent = "Nothing scheduled.";
    wrap.appendChild(empty);
    return wrap;
  }
  list.forEach((e) => {
    const row = document.createElement("div");
    row.className = "cal-row";
    if (!e.allDay && e.startMs <= now && e.endMs > now) row.classList.add("now");
    else if (e.endMs <= now) row.classList.add("past");
    const time = document.createElement("div"); time.className = "cal-time";
    time.textContent = e.allDay ? "all-day" : `${fmtT(e.startMs)}–${fmtT(e.endMs)}`;
    const body = document.createElement("div");
    const t = document.createElement("div"); t.className = "cal-title"; t.textContent = e.title; body.appendChild(t);
    const det = document.createElement("div"); det.className = "cal-ev-detail";
    if (e.location) { const m = document.createElement("div"); m.textContent = "📍 " + e.location; det.appendChild(m); }
    if (e.attendees && e.attendees.length) {
      const a = document.createElement("div");
      a.textContent = "👥 " + e.attendees.slice(0, 6).join(", ") + (e.attendees.length > 6 ? ` +${e.attendees.length - 6}` : "");
      det.appendChild(a);
    }
    if (e.description) {
      const d = document.createElement("div");
      d.textContent = e.description.length > 240 ? e.description.slice(0, 240) + "…" : e.description;
      det.appendChild(d);
    }
    if (e.videoLink) {
      const j = document.createElement("a");
      j.href = e.videoLink; j.target = "_blank"; j.rel = "noopener"; j.textContent = "Join video call ↗";
      det.appendChild(j);
    }
    if (e.htmlLink) {
      const o = document.createElement("a");
      o.href = e.htmlLink; o.target = "_blank"; o.rel = "noopener"; o.textContent = "Open in Calendar ↗";
      det.appendChild(o);
    }
    if (det.childNodes.length) body.appendChild(det);
    row.append(time, body);
    wrap.appendChild(row);
  });
  return wrap;
}

// ---- gmail drawer ----
const GMAIL_LIST_URL = "https://www.googleapis.com/gmail/v1/users/me/messages";
const GMAIL_MSG_URL = "https://www.googleapis.com/gmail/v1/users/me/messages/";

async function gmailAuthedFetch(url) {
  let token = await getToken(false, GMAIL_SCOPES);
  let r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (r.status === 401) {
    await new Promise((res) => chrome.identity.removeCachedAuthToken({ token }, res));
    token = await getToken(false, GMAIL_SCOPES).catch(() => null);
    if (!token) throw new Error("auth expired");
    r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  }
  if (!r.ok) throw new Error("gmail http " + r.status);
  return r.json();
}
function gmailParseFrom(v) {
  if (!v) return "";
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>/);
  return (m && m[1].trim()) || v.replace(/<[^>]+>/, "").trim() || v;
}
async function gmailFetchMessages(max = 20) {
  const list = await gmailAuthedFetch(`${GMAIL_LIST_URL}?labelIds=INBOX&maxResults=${max}`);
  const ids = (list.messages || []).map((m) => m.id);
  const results = [];
  const queue = ids.slice();
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        const m = await gmailAuthedFetch(
          `${GMAIL_MSG_URL}${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
        );
        const headers = (m.payload && m.payload.headers) || [];
        const h = (n) => { const x = headers.find((z) => z.name.toLowerCase() === n); return x ? x.value : ""; };
        results.push({
          id: m.id,
          from: gmailParseFrom(h("from")),
          subject: h("subject") || "(no subject)",
          date: h("date"),
          dateMs: m.internalDate ? Number(m.internalDate) : 0,
          unread: Array.isArray(m.labelIds) && m.labelIds.includes("UNREAD"),
        });
      } catch (e) { /* skip this message */ }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  results.sort((a, b) => b.dateMs - a.dateMs);
  return results;
}
async function loadGmailDrawer(force) {
  if (drawerSource !== "gmail") return;
  if (!gmailConfigured() || !gmailConnected) { drawerMsg("Connect Gmail in settings to see your inbox."); return; }
  drawerMsg("Loading…", "drawer-loading");
  try {
    const cache = (await chrome.storage.local.get("gmailMsgCache")).gmailMsgCache;
    const fresh = cache && Date.now() - cache.ts < 2 * 60 * 1000;
    let messages;
    if (fresh && !force) messages = cache.messages;
    else {
      messages = await gmailFetchMessages(20);
      await chrome.storage.local.set({ gmailMsgCache: { messages, ts: Date.now() } });
    }
    if (drawerSource === "gmail") renderGmailDrawer(messages);
  } catch (e) {
    if (drawerSource === "gmail") drawerMsg("Couldn't load Gmail. Try reconnecting in settings.");
  }
}
function fmtMailDate(ms, raw) {
  if (!ms) return raw || "";
  return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
function renderGmailDrawer(messages) {
  el.drawerBody.innerHTML = "";
  if (!messages || !messages.length) { drawerMsg("Inbox is empty."); return; }
  messages.forEach((m) => {
    const a = document.createElement("a");
    a.className = "gm-msg" + (m.unread ? " unread" : "");
    a.href = `https://mail.google.com/mail/u/0/#all/${m.id}`;
    a.target = "_blank"; a.rel = "noopener";
    const from = document.createElement("div"); from.className = "gm-from"; from.textContent = m.from || "(unknown sender)";
    const subj = document.createElement("div"); subj.className = "gm-subj"; subj.textContent = m.subject;
    const date = document.createElement("div"); date.className = "gm-date"; date.textContent = fmtMailDate(m.dateMs, m.date);
    a.append(from, subj, date);
    el.drawerBody.appendChild(a);
  });
}

// ---- slack drawer ----
function aiSend(type, payload) {
  return new Promise((resolve) => {
    try { chrome.runtime.sendMessage({ type, payload }, (r) => resolve(r || { ok: false, error: "send_failed" })); }
    catch (e) { resolve({ ok: false, error: "send_failed" }); }
  });
}
function fmtSlackTs(ts) {
  const ms = Math.floor(parseFloat(ts) * 1000);
  if (!ms) return "";
  return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
async function loadSlackDrawer() {
  if (drawerSource !== "slack") return;
  if (!slackConfigured()) { drawerMsg("Connect Slack in settings to see your unread messages."); return; }
  drawerMsg("Loading messages…", "drawer-loading");
  const res = await new Promise((resolve) => {
    try { chrome.runtime.sendMessage({ type: "slackUnread" }, (r) => resolve(r || { ok: false, error: "send_failed" })); }
    catch (e) { resolve({ ok: false, error: "send_failed" }); }
  });
  if (drawerSource !== "slack") return;
  if (!res || !res.ok) {
    drawerMsg(res && res.error === "auth"
      ? "Slack session expired — re-paste your token & cookie in settings."
      : "Couldn't load Slack messages. Try the refresh button.");
    return;
  }
  renderSlackDrawer(res.conversations || []);
}
function renderSlackDrawer(conversations) {
  el.drawerBody.innerHTML = "";
  if (!conversations.length) { drawerMsg("No unread Slack messages 🎉"); return; }
  const aiReady = anthropicReady();
  conversations.forEach((conv) => {
    const box = document.createElement("div"); box.className = "sk-conv";
    const head = document.createElement("div"); head.className = "sk-conv-head";
    const title = document.createElement("span"); title.className = "sk-conv-title"; title.textContent = conv.title;
    head.appendChild(title);
    if (conv.mentionCount > 0) {
      const b = document.createElement("span"); b.className = "sk-conv-badge"; b.textContent = `@${conv.mentionCount}`;
      head.appendChild(b);
    }
    box.appendChild(head);
    if (!conv.messages.length) {
      const e = document.createElement("div"); e.className = "sk-msg-text"; e.textContent = "(no readable messages)";
      box.appendChild(e);
    }
    conv.messages.forEach((m) => box.appendChild(renderSlackMessage(conv, m, aiReady)));
    el.drawerBody.appendChild(box);
  });
}
function renderSlackMessage(conv, m, aiReady) {
  const wrap = document.createElement("div"); wrap.className = "sk-msg";
  const meta = document.createElement("div"); meta.className = "sk-msg-meta";
  const sender = document.createElement("span"); sender.className = "sk-msg-sender"; sender.textContent = m.sender;
  meta.appendChild(sender);
  meta.appendChild(document.createTextNode(" · " + fmtSlackTs(m.ts)));
  const text = document.createElement("div"); text.className = "sk-msg-text"; text.textContent = m.text;
  wrap.append(meta, text);

  const actions = document.createElement("div"); actions.className = "sk-actions";
  const explainBtn = document.createElement("button"); explainBtn.className = "sk-btn"; explainBtn.textContent = "Wyjaśnij (PL)";
  const draftBtn = document.createElement("button"); draftBtn.className = "sk-btn"; draftBtn.textContent = "Odpowiedz (EN)";
  if (!aiReady) {
    explainBtn.disabled = true; draftBtn.disabled = true;
    explainBtn.title = draftBtn.title = "Add an Anthropic API key in settings";
  }
  actions.append(explainBtn, draftBtn);
  const out = document.createElement("div"); out.className = "sk-ai-out";
  wrap.append(actions, out);

  const payload = { sender: m.sender, text: m.text, channelTitle: conv.title };
  explainBtn.addEventListener("click", () => runAiExplain(explainBtn, out, payload));
  draftBtn.addEventListener("click", () => runAiDraft(draftBtn, out, payload));
  return wrap;
}
async function runAiExplain(btn, out, payload) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "…"; out.innerHTML = "";
  const res = await aiSend("aiExplain", payload);
  btn.disabled = false; btn.textContent = label;
  if (!res.ok) { showAiError(out, res.error); return; }
  out.innerHTML = "";
  const box = document.createElement("div"); box.className = "sk-ai-explain"; box.textContent = res.text;
  out.appendChild(box);
}
async function runAiDraft(btn, out, payload) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "…"; out.innerHTML = "";
  const res = await aiSend("aiDraft", payload);
  btn.disabled = false; btn.textContent = label;
  if (!res.ok) { showAiError(out, res.error); return; }
  out.innerHTML = "";
  const ta = document.createElement("textarea"); ta.className = "sk-ai-draft"; ta.value = res.text;
  const row = document.createElement("div"); row.className = "sk-actions";
  const copy = document.createElement("button"); copy.className = "sk-btn"; copy.textContent = "Kopiuj";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(ta.value);
      copy.textContent = "Skopiowano ✓";
      setTimeout(() => (copy.textContent = "Kopiuj"), 1500);
    } catch (e) { copy.textContent = "Błąd kopiowania"; }
  });
  row.appendChild(copy);
  out.append(ta, row);
}
function showAiError(out, error) {
  const e = document.createElement("div"); e.className = "sk-err";
  e.textContent =
    error === "no_key" ? "Dodaj klucz API Anthropic w ustawieniach."
    : error === "auth" ? "Nieprawidłowy klucz API (401)."
    : error === "rate_limited" ? "Limit zapytań — spróbuj za chwilę."
    : error === "overloaded" ? "Model przeciążony — spróbuj ponownie."
    : "Błąd AI: " + error;
  out.innerHTML = ""; out.appendChild(e);
}

// ----------------------------- weather -----------------------------

const WMO = {
  0: ["☀️", "Clear"], 1: ["🌤️", "Mainly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"],
  45: ["🌫️", "Fog"], 48: ["🌫️", "Rime fog"],
  51: ["🌦️", "Light drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌧️", "Heavy drizzle"],
  56: ["🌧️", "Freezing drizzle"], 57: ["🌧️", "Freezing drizzle"],
  61: ["🌦️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"],
  66: ["🌧️", "Freezing rain"], 67: ["🌧️", "Freezing rain"],
  71: ["🌨️", "Light snow"], 73: ["🌨️", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["🌨️", "Snow grains"],
  80: ["🌦️", "Showers"], 81: ["🌧️", "Showers"], 82: ["⛈️", "Violent showers"],
  85: ["🌨️", "Snow showers"], 86: ["❄️", "Snow showers"],
  95: ["⛈️", "Thunderstorm"], 96: ["⛈️", "Thunderstorm + hail"], 99: ["⛈️", "Thunderstorm + hail"],
};
function wmo(code) { return WMO[code] || ["•", "—"]; }

async function geocodeCity(city) {
  const u = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const r = await fetch(u); const j = await r.json();
  if (!j.results || !j.results.length) throw new Error("not found");
  const g = j.results[0];
  return { lat: g.latitude, lon: g.longitude, name: [g.name, g.country_code].filter(Boolean).join(", ") };
}

async function fetchWeather(lat, lon) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
  const r = await fetch(u); if (!r.ok) throw new Error("weather http " + r.status);
  return r.json();
}

function renderWeatherIdle(text) {
  el.wxIcon.textContent = "··";
  el.wxPillText.textContent = text || "Weather";
  el.wxDetail.innerHTML = `<div class="wx-empty">${text || "Set your city in settings."}</div>`;
}

function renderWeather(data, locName) {
  const c = data.current;
  const [icon, label] = wmo(c.weather_code);
  const temp = Math.round(c.temperature_2m);
  const hi = Math.round(data.daily.temperature_2m_max[0]);
  const lo = Math.round(data.daily.temperature_2m_min[0]);
  el.wxIcon.textContent = icon;
  el.wxPillText.textContent = `${temp}° ↑${hi}° ↓${lo}°`;
  el.wxDetail.innerHTML = `
    <div class="wx-now"><span style="font-size:30px">${icon}</span>
      <div><div class="wx-temp">${temp}°C</div><div class="wx-cond">${label}</div></div></div>
    <div class="wx-grid">
      <span>Feels <b>${Math.round(c.apparent_temperature)}°</b></span>
      <span>High <b>${hi}°</b></span><span>Low <b>${lo}°</b></span>
      <span>Wind <b>${Math.round(c.wind_speed_10m)} km/h</b></span>
    </div>
    <div class="wx-loc">${locName || ""} · updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</div>`;
}

async function loadWeather(force = false) {
  if (settings.lat == null || settings.lon == null) { renderWeatherIdle("Set location"); return; }
  try {
    const cache = (await chrome.storage.local.get("weatherCache")).weatherCache;
    const fresh = cache && Date.now() - cache.ts < 30 * 60 * 1000 && cache.lat === settings.lat;
    if (fresh && !force) { renderWeather(cache.data, settings.city || cache.name); return; }
    const data = await fetchWeather(settings.lat, settings.lon);
    await chrome.storage.local.set({ weatherCache: { data, ts: Date.now(), lat: settings.lat, name: settings.city } });
    renderWeather(data, settings.city);
  } catch (e) { renderWeatherIdle("Weather —"); }
}

el.cityInput.addEventListener("change", async () => {
  const city = el.cityInput.value.trim();
  if (!city) return;
  el.wxHint.textContent = "Looking up…";
  try {
    const g = await geocodeCity(city);
    settings = { ...settings, city: g.name, lat: g.lat, lon: g.lon };
    el.cityInput.value = g.name;
    await chrome.storage.local.set({ settings });
    el.wxHint.textContent = `Set to ${g.name}.`;
    loadWeather(true);
  } catch (e) { el.wxHint.textContent = "City not found — try another spelling."; }
});

el.useLocation.addEventListener("click", () => {
  el.wxHint.textContent = "Requesting location…";
  if (!navigator.geolocation) { el.wxHint.textContent = "Geolocation unavailable."; return; }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      settings = { ...settings, city: "Current location", lat: +pos.coords.latitude.toFixed(4), lon: +pos.coords.longitude.toFixed(4) };
      el.cityInput.value = "Current location";
      await chrome.storage.local.set({ settings });
      el.wxHint.textContent = "Using your current location.";
      loadWeather(true);
    },
    () => (el.wxHint.textContent = "Location permission denied."),
    { timeout: 8000 }
  );
});

// ----------------------------- calendar -----------------------------

// Google OAuth scopes are requested per-feature so connecting Calendar doesn't
// force a Gmail consent prompt (and vice-versa). getAuthToken caches a separate
// token per scope set, keeping the two integrations independent.
const CAL_SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];
const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.metadata"];

function calConfigured() {
  const m = chrome.runtime.getManifest();
  return m.oauth2 && m.oauth2.client_id && m.oauth2.client_id !== OAUTH_PLACEHOLDER;
}

function getToken(interactive, scopes) {
  return new Promise((resolve, reject) => {
    const opts = scopes ? { interactive, scopes } : { interactive };
    chrome.identity.getAuthToken(opts, (token) => {
      if (chrome.runtime.lastError || !token) return reject(chrome.runtime.lastError || new Error("no token"));
      resolve(token);
    });
  });
}

async function calFetchEvents(token) {
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  // through the end of tomorrow (today + next day)
  const end = new Date(now); end.setDate(end.getDate() + 1); end.setHours(23, 59, 59, 999);
  const u = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
    `timeMin=${start.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=50`;
  let r = await fetch(u, { headers: { Authorization: "Bearer " + token } });
  if (r.status === 401) {
    await new Promise((res) => chrome.identity.removeCachedAuthToken({ token }, res));
    const t2 = await getToken(false, CAL_SCOPES).catch(() => null);
    if (!t2) throw new Error("auth expired");
    r = await fetch(u, { headers: { Authorization: "Bearer " + t2 } });
  }
  if (!r.ok) throw new Error("calendar http " + r.status);
  const j = await r.json();
  return (j.items || [])
    .filter((e) => e.status !== "cancelled")
    .filter((e) => !(e.attendees || []).some((a) => a.self && a.responseStatus === "declined"))
    .map((e) => {
      const allDay = !e.start.dateTime;
      const startMs = allDay ? new Date(e.start.date + "T00:00:00").getTime() : new Date(e.start.dateTime).getTime();
      const endMs = allDay ? new Date(e.end.date + "T00:00:00").getTime() : new Date(e.end.dateTime).getTime();
      const attendees = (e.attendees || [])
        .filter((a) => !a.resource)
        .map((a) => a.displayName || a.email)
        .filter(Boolean);
      let videoLink = e.hangoutLink || "";
      if (!videoLink && e.conferenceData && Array.isArray(e.conferenceData.entryPoints)) {
        const v = e.conferenceData.entryPoints.find((p) => p.entryPointType === "video");
        if (v) videoLink = v.uri || "";
      }
      return {
        title: e.summary || "(no title)", allDay, startMs, endMs,
        location: e.location || "", description: e.description || "",
        attendees, videoLink, htmlLink: e.htmlLink || "",
      };
    })
    .sort((a, b) => a.startMs - b.startMs);
}

function fmtT(ms) { return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }

function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }

function renderCalendar(events) {
  const now = Date.now();
  const todayStart = startOfDay(now);
  const tomorrowStart = todayStart + 86400000;
  const dayAfterStart = tomorrowStart + 86400000;
  const todays = events.filter((e) => e.startMs >= todayStart && e.startMs < tomorrowStart);
  const tomorrows = events.filter((e) => e.startMs >= tomorrowStart && e.startMs < dayAfterStart);

  // pill — prioritise today, fall back to tomorrow's first meeting
  const ongoing = todays.find((e) => !e.allDay && e.startMs <= now && e.endMs > now);
  const upcoming = todays.filter((e) => !e.allDay && e.startMs > now);
  el.calPill.classList.remove("now");
  if (ongoing) {
    el.calPillText.textContent = `${ongoing.title} · to ${fmtT(ongoing.endMs)}`;
    el.calPill.classList.add("now");
  } else if (upcoming.length) {
    el.calPillText.textContent = `${fmtT(upcoming[0].startMs)} · ${upcoming[0].title}`;
  } else if (tomorrows.length) {
    const first = tomorrows.find((e) => !e.allDay) || tomorrows[0];
    el.calPillText.textContent = first.allDay
      ? `Tomorrow · ${first.title}`
      : `Tomorrow ${fmtT(first.startMs)} · ${first.title}`;
  } else if (todays.length) {
    el.calPillText.textContent = "Done for today";
  } else {
    el.calPillText.textContent = "No meetings";
  }
}

function renderCalIdle(text) {
  el.calPill.classList.remove("now");
  el.calPillText.textContent = text;
}

async function loadCalendar(force = false) {
  if (!calConfigured()) { renderCalIdle("Calendar", "Connect in settings to see today's meetings."); return; }
  if (!calConnected) { renderCalIdle("Connect calendar", "Connect in settings to see today's meetings."); return; }
  try {
    const cache = (await chrome.storage.local.get("calCache")).calCache;
    const fresh = cache && Date.now() - cache.ts < 5 * 60 * 1000;
    if (fresh && !force) { renderCalendar(cache.events); return; }
    const token = await getToken(false, CAL_SCOPES);
    const events = await calFetchEvents(token);
    await chrome.storage.local.set({ calCache: { events, ts: Date.now() } });
    renderCalendar(events);
  } catch (e) { renderCalIdle("Calendar —", "Couldn't load. Try reconnecting in settings."); }
}

function renderCalSettings() {
  if (!calConfigured()) {
    el.calStatus.textContent = "Setup needed";
    el.calConnect.hidden = true;
    el.calDisconnect.hidden = true;
    el.calHint.innerHTML =
      `To enable Google Calendar, create an OAuth client (type <b>Chrome extension</b>) in Google Cloud Console ` +
      `with this extension ID:<br><code>${EXT_ID}</code><br>` +
      `Add scope <code>calendar.readonly</code>, then paste the client ID into <code>manifest.json</code> → <code>oauth2.client_id</code> and reload. See the README for step-by-step.`;
    return;
  }
  el.calStatus.textContent = calConnected ? "Connected" : "Not connected";
  el.calConnect.hidden = calConnected;
  el.calDisconnect.hidden = !calConnected;
  el.calHint.textContent = calConnected
    ? "Showing today's events from your primary calendar."
    : "Connect to show today's meetings in the bar.";
}

el.calConnect.addEventListener("click", async () => {
  if (!calConfigured()) return;
  el.calStatus.textContent = "Connecting…";
  try {
    await getToken(true, CAL_SCOPES);
    calConnected = true;
    await chrome.storage.local.set({ calConnected: true });
    renderCalSettings();
    loadCalendar(true);
  } catch (e) {
    el.calStatus.textContent = "Connection failed";
    const detail = (e && e.message) ? e.message : String(e);
    console.error("[DevCockpit] getAuthToken failed:", detail, e);
    el.calHint.textContent =
      "Couldn't connect: " + detail +
      " — check the OAuth client ID, that you're added as a test user, and that Chrome is signed into the right Google account.";
  }
});

el.calDisconnect.addEventListener("click", async () => {
  try { const t = await getToken(false, CAL_SCOPES); await new Promise((r) => chrome.identity.removeCachedAuthToken({ token: t }, r)); } catch (e) {}
  calConnected = false;
  await chrome.storage.local.set({ calConnected: false, calCache: null });
  renderCalSettings();
  renderCalIdle("Connect calendar");
});

// ----------------------------- slack -----------------------------

function slackConfigured() {
  return !!(slackCfg && slackCfg.workspaceUrl && slackCfg.token && slackCfg.dCookie);
}

// Render the top-bar pill + popover from a cached counts snapshot.
// Pill-only: the bar badge. Full message bodies live in the drawer (loadSlackDrawer).
function renderSlack(counts) {
  el.slackPill.classList.remove("has-unread");
  if (!slackConfigured()) { el.slackPillText.textContent = "Slack"; return; }
  if (counts && counts.error) {
    el.slackPillText.textContent = counts.error === "auth" ? "Slack !" : "Slack —";
    return;
  }
  const total = counts && typeof counts.total === "number" ? counts.total : 0;
  el.slackPillText.textContent = total > 0 ? String(total) : "0";
  if (total > 0) el.slackPill.classList.add("has-unread");
}

function renderSlackSettings() {
  if (!slackConfigured()) {
    el.slackStatus.textContent = "Not connected";
    el.slackConnect.textContent = "Connect";
    el.slackHint.innerHTML =
      `Shows your combined unread count (DMs + @mentions) using Slack's session token. ` +
      `In Chrome on <code>your-team.slack.com</code> open DevTools: ` +
      `Console → <code>JSON.parse(localStorage.localConfig_v2).teams</code> for the <code>xoxc-…</code> token, ` +
      `and Application → Cookies → cookie <code>d</code> for the <code>xoxd-…</code> value. ` +
      `<b>Unofficial method:</b> tokens reset when you log out of Slack, grant full account access, and are stored only on this device.`;
    return;
  }
  el.slackStatus.textContent = "Connected";
  el.slackConnect.textContent = "Update";
  el.slackHint.textContent = "Polling your unread DMs and mentions every couple of minutes.";
}

el.slackConnect.addEventListener("click", async () => {
  const workspaceUrl = el.slackWorkspace.value.trim();
  const token = el.slackToken.value.trim();
  const dCookie = el.slackCookie.value.trim();
  if (!workspaceUrl || !token || !dCookie) {
    el.slackStatus.textContent = "Missing fields";
    el.slackHint.textContent = "Fill in workspace URL, token, and cookie.";
    return;
  }
  slackCfg = { workspaceUrl, token, dCookie, notify: el.slackNotify.checked };
  await chrome.storage.local.set({ slack: slackCfg });
  el.slackStatus.textContent = "Connecting…";
  const res = await new Promise((resolve) => {
    try { chrome.runtime.sendMessage({ type: "slackConnect" }, (r) => resolve(r || { ok: false })); }
    catch (e) { resolve({ ok: false, error: "send_failed" }); }
  });
  if (res && res.ok) {
    el.slackStatus.textContent = "Connected";
    el.slackConnect.textContent = "Update";
    el.slackHint.textContent = `Connected — ${res.total} unread right now.`;
  } else {
    const err = (res && res.error) || "unknown";
    el.slackStatus.textContent = "Connection failed";
    el.slackHint.textContent =
      err === "not_authed" || err === "invalid_auth" || err === "auth"
        ? "Slack rejected the token/cookie. Re-copy both from a fresh Slack web session."
        : "Couldn't reach Slack (" + err + "). Check the workspace URL and try again.";
  }
});

el.slackNotify.addEventListener("change", async () => {
  if (!slackConfigured()) return;
  slackCfg = { ...slackCfg, notify: el.slackNotify.checked };
  await chrome.storage.local.set({ slack: slackCfg });
});

el.slackClear.addEventListener("click", async () => {
  slackCfg = null;
  el.slackWorkspace.value = "";
  el.slackToken.value = "";
  el.slackCookie.value = "";
  el.slackNotify.checked = false;
  send("slackDisconnect");
  renderSlackSettings();
  renderSlack(null);
});

// ----------------------------- gmail -----------------------------
// Reuses the same Google OAuth client as Calendar but requests only the
// gmail.metadata scope: label counts, never message contents. Shows the inbox
// unread count in a pill to the right of the Slack badge. Polled app-side
// (like Calendar) while the tab is open.

const GMAIL_INBOX_URL = "https://www.googleapis.com/gmail/v1/users/me/labels/INBOX";

const toCount = (v) => (Number.isFinite(v) ? v : 0);

// Gmail shares Calendar's OAuth client, so "configured" means the same thing.
function gmailConfigured() {
  return calConfigured();
}

async function gmailFetchUnread(token) {
  let r = await fetch(GMAIL_INBOX_URL, { headers: { Authorization: "Bearer " + token } });
  if (r.status === 401) {
    await new Promise((res) => chrome.identity.removeCachedAuthToken({ token }, res));
    const t2 = await getToken(false, GMAIL_SCOPES).catch(() => null);
    if (!t2) throw new Error("auth expired");
    r = await fetch(GMAIL_INBOX_URL, { headers: { Authorization: "Bearer " + t2 } });
  }
  if (!r.ok) throw new Error("gmail http " + r.status);
  const j = await r.json();
  return { unread: toCount(j.messagesUnread), threadsUnread: toCount(j.threadsUnread) };
}

// Pill-only: the bar badge (unread count). The message list lives in the drawer.
function renderGmail(snap) {
  el.gmailPill.classList.remove("gmail-unread");
  if (!gmailConfigured() || !gmailConnected) { el.gmailPillText.textContent = "Gmail"; return; }
  if (snap && snap.error) {
    el.gmailPillText.textContent = snap.error === "auth" ? "Gmail !" : "Gmail —";
    return;
  }
  const unread = snap && typeof snap.unread === "number" ? snap.unread : 0;
  el.gmailPillText.textContent = unread > 99 ? "99+" : String(unread);
  if (unread > 0) el.gmailPill.classList.add("gmail-unread");
}

async function loadGmail(force = false) {
  if (!gmailConfigured() || !gmailConnected) { renderGmail(null); return; }
  try {
    const cache = (await chrome.storage.local.get("gmailCache")).gmailCache;
    const fresh = cache && !cache.error && Date.now() - cache.ts < 2 * 60 * 1000;
    if (fresh && !force) { renderGmail(cache); return; }
    const prev = cache && !cache.error ? cache : null;
    const token = await getToken(false, GMAIL_SCOPES);
    const { unread, threadsUnread } = await gmailFetchUnread(token);
    const snap = { unread, threadsUnread, ts: Date.now() };
    await chrome.storage.local.set({ gmailCache: snap });
    renderGmail(snap);
    maybeNotifyGmail(prev, snap);
  } catch (e) {
    const msg = (e && e.message) || "";
    renderGmail({ error: /auth|token/i.test(msg) ? "auth" : "fetch", ts: Date.now() });
  }
}

// Desktop alert when the unread count climbs (only while the tab is open).
async function maybeNotifyGmail(prev, snap) {
  if (!gmailNotify || !prev) return;
  if (snap.unread > prev.unread) {
    const added = snap.unread - prev.unread;
    try {
      await chrome.notifications.create(`ff-gmail-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: `Gmail — ${snap.unread} unread`,
        message: `${added} new email${added === 1 ? "" : "s"} in your inbox.`,
        priority: 1,
      });
    } catch (e) {}
  }
}

function renderGmailSettings() {
  if (!gmailConfigured()) {
    el.gmailStatus.textContent = "Setup needed";
    el.gmailConnect.hidden = true;
    el.gmailDisconnect.hidden = true;
    el.gmailHint.innerHTML =
      `Gmail uses the same Google OAuth client as Calendar. Set up the client ID first (see the Google Calendar section), ` +
      `add the <code>gmail.metadata</code> scope on your OAuth consent screen, then reload.`;
    return;
  }
  el.gmailStatus.textContent = gmailConnected ? "Connected" : "Not connected";
  el.gmailConnect.hidden = gmailConnected;
  el.gmailDisconnect.hidden = !gmailConnected;
  el.gmailNotify.checked = gmailNotify;
  el.gmailHint.textContent = gmailConnected
    ? "Showing your inbox unread count (labels only — never message contents)."
    : "Connect to show your Gmail inbox unread count in the bar.";
}

el.gmailConnect.addEventListener("click", async () => {
  if (!gmailConfigured()) return;
  el.gmailStatus.textContent = "Connecting…";
  try {
    await getToken(true, GMAIL_SCOPES);
    gmailConnected = true;
    await chrome.storage.local.set({ gmailConnected: true });
    renderGmailSettings();
    loadGmail(true);
  } catch (e) {
    el.gmailStatus.textContent = "Connection failed";
    const detail = (e && e.message) ? e.message : String(e);
    console.error("[DevCockpit] Gmail getAuthToken failed:", detail, e);
    el.gmailHint.textContent =
      "Couldn't connect: " + detail +
      " — make sure the gmail.metadata scope is on your OAuth consent screen and you're signed into the right Google account.";
  }
});

el.gmailDisconnect.addEventListener("click", async () => {
  try { const t = await getToken(false, GMAIL_SCOPES); await new Promise((r) => chrome.identity.removeCachedAuthToken({ token: t }, r)); } catch (e) {}
  gmailConnected = false;
  await chrome.storage.local.set({ gmailConnected: false, gmailCache: null });
  renderGmailSettings();
  renderGmail(null);
});

el.gmailNotify.addEventListener("change", async () => {
  gmailNotify = el.gmailNotify.checked;
  await chrome.storage.local.set({ gmailNotify });
});

// ----------------------------- anthropic (AI) -----------------------------

function anthropicReady() { return !!(anthropicCfg && anthropicCfg.apiKey); }

function renderAnthropicSettings() {
  el.anthropicStatus.textContent = anthropicReady() ? "Key saved" : "Not set";
  el.anthropicModel.value = (anthropicCfg && anthropicCfg.model) || "claude-haiku-4-5";
  el.anthropicKey.value = ""; // never echo the stored key back into the field
}

el.anthropicSave.addEventListener("click", async () => {
  const typed = el.anthropicKey.value.trim();
  const apiKey = typed || (anthropicCfg && anthropicCfg.apiKey) || "";
  if (!apiKey) { el.anthropicStatus.textContent = "Enter a key"; return; }
  anthropicCfg = { apiKey, model: el.anthropicModel.value };
  await chrome.storage.local.set({ anthropic: anthropicCfg });
  el.anthropicKey.value = "";
  el.anthropicStatus.textContent = "Key saved";
  el.anthropicHint.textContent = "Saved on this device. Used by the Slack panel's AI buttons.";
});

el.anthropicModel.addEventListener("change", async () => {
  if (!anthropicReady()) return;
  anthropicCfg = { ...anthropicCfg, model: el.anthropicModel.value };
  await chrome.storage.local.set({ anthropic: anthropicCfg });
});

el.anthropicClear.addEventListener("click", async () => {
  anthropicCfg = null;
  await chrome.storage.local.remove("anthropic");
  renderAnthropicSettings();
});

// ----------------------------- storage sync -----------------------------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.timer) { timer = changes.timer.newValue; renderTimer(); startTick(); }
  if (changes.settings) { settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue }; applyTheme(); renderTimer(); }
  if (changes.slackCounts) renderSlack(changes.slackCounts.newValue);
  if (changes.slack) { slackCfg = changes.slack.newValue || null; }
  if ((changes.boards || changes.activeBoardId) && !isDragging && !isEditingBoard && !isAddingCard) {
    if (changes.boards && Array.isArray(changes.boards.newValue)) boards = changes.boards.newValue;
    if (changes.activeBoardId) activeBoardId = changes.activeBoardId.newValue || activeBoardId;
    syncActiveBoard();
    renderRail();
    renderBoard();
  }
  if (changes.globalList && changes.globalList.newValue && !isDragging && !isEditingBoard && !isAddingCard) {
    globalList = normalizeGlobalList(changes.globalList.newValue);
    renderGlobalList();
  }
  if (changes.widgetLayout && changes.widgetLayout.newValue && !isDragging && !isAddingCard) {
    widgetLayout = normalizeWidgetLayout(changes.widgetLayout.newValue);
    renderGlobalList();
    renderWidgetManager();
  }
  if (changes.ideas) {
    // Skip our own writes (we already updated state + DOM); re-render only on
    // cross-tab edits so we never wipe the note a user is currently typing in.
    if (ideasMutating) { ideasMutating = false; }
    else if (changes.ideas.newValue) {
      ideas = normalizeIdeas(changes.ideas.newValue);
      if (currentView === "ideas") renderIdeas();
    }
  }
});

// ===================== top-bar view switcher =====================

const VIEWS = ["boards", "ideas", "news"];

function setView(name) {
  if (!VIEWS.includes(name)) name = "boards";
  currentView = name;
  el.workspace.hidden = name !== "boards";
  el.ideasView.hidden = name !== "ideas";
  el.newsView.hidden = name !== "news";
  el.viewNav.querySelectorAll(".view-tab").forEach((tab) => {
    const on = tab.dataset.view === name;
    tab.classList.toggle("is-active", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (settings.view !== name) { settings = { ...settings, view: name }; chrome.storage.local.set({ settings }); }
  if (name === "ideas") renderIdeas();
  if (name === "news") { if (!newsInited) { newsInited = true; loadNews(false); } else renderNews(); }
}

el.viewNav.addEventListener("click", (e) => {
  const tab = e.target.closest(".view-tab");
  if (tab) setView(tab.dataset.view);
});

// ===================== Ideas: free-form sticky-note canvas =====================

// Note "types" — each is a preset look the user picks from the + Note dropdown.
const NOTE_TYPES = [
  { key: "sticky", label: "Sticky note", color: "#fff6c8" },
  { key: "idea", label: "Idea", color: "#cfe6ff" },
  { key: "todo", label: "To-do", color: "#d6f0d0" },
  { key: "question", label: "Question", color: "#ffd8cc" },
  { key: "highlight", label: "Highlight", color: "#e6d6ff" },
  { key: "plain", label: "Plain", color: "#ffffff" },
];
const NOTE_TYPE_BY_KEY = Object.fromEntries(NOTE_TYPES.map((t) => [t.key, t]));
function noteColor(note) {
  if (note.type && NOTE_TYPE_BY_KEY[note.type]) return NOTE_TYPE_BY_KEY[note.type].color;
  return note.color || NOTE_TYPES[0].color; // back-compat with older colour-based notes
}
const NOTE_W = 200, NOTE_H = 160, NOTE_MIN = 110;
let ideaPan = { x: 40, y: 40, zoom: 1 };
let ideasMutating = false; // suppress our own storage.onChanged re-render

function normalizeIdeas(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  let canvases = Array.isArray(r.canvases) ? r.canvases : [];
  canvases = canvases
    .filter((c) => c && typeof c === "object")
    .map((c) => ({
      id: typeof c.id === "string" ? c.id : newId(),
      name: typeof c.name === "string" ? c.name : "Canvas",
      notes: c.notes && typeof c.notes === "object" ? c.notes : {},
    }));
  if (!canvases.length) canvases = [{ id: newId(), name: "Canvas", notes: {} }];
  const activeId = canvases.some((c) => c.id === r.activeId) ? r.activeId : canvases[0].id;
  return { canvases, activeId };
}
function activeCanvas() { return ideas.canvases.find((c) => c.id === ideas.activeId) || ideas.canvases[0]; }
function saveIdeas() { ideasMutating = true; chrome.storage.local.set({ ideas }); }
function replaceCanvas(nextCanvas) {
  ideas = { ...ideas, canvases: ideas.canvases.map((c) => (c.id === nextCanvas.id ? nextCanvas : c)) };
}
function updateNote(id, patch) {
  const canvas = activeCanvas();
  const cur = canvas.notes[id]; if (!cur) return;
  replaceCanvas({ ...canvas, notes: { ...canvas.notes, [id]: { ...cur, ...patch } } });
  saveIdeas();
}
function deleteNote(id) {
  const canvas = activeCanvas();
  const nextNotes = { ...canvas.notes }; delete nextNotes[id];
  replaceCanvas({ ...canvas, notes: nextNotes });
  saveIdeas();
  renderIdeas();
}
function addNote(x, y, typeKey) {
  const canvas = activeCanvas();
  const id = newId();
  const type = NOTE_TYPE_BY_KEY[typeKey] ? typeKey : NOTE_TYPES[0].key;
  const note = { id, text: "", x: Math.round(x), y: Math.round(y), w: NOTE_W, h: NOTE_H, type, createdAt: Date.now() };
  replaceCanvas({ ...canvas, notes: { ...canvas.notes, [id]: note } });
  saveIdeas();
  renderIdeas();
  const body = el.ideasLayer.querySelector(`.idea-note[data-id="${id}"] .idea-note-body`);
  if (body) body.focus();
}

function applyIdeasTransform() {
  el.ideasLayer.style.transform = `translate(${ideaPan.x}px, ${ideaPan.y}px) scale(${ideaPan.zoom})`;
  if (el.ideasZoomReset) el.ideasZoomReset.textContent = Math.round(ideaPan.zoom * 100) + "%";
}

function buildNoteEl(note) {
  const root = document.createElement("div");
  root.className = "idea-note";
  root.dataset.id = note.id;
  root.style.left = note.x + "px";
  root.style.top = note.y + "px";
  root.style.width = note.w + "px";
  root.style.height = note.h + "px";
  root.style.setProperty("--note-bg", noteColor(note));

  const bar = document.createElement("div");
  bar.className = "idea-note-bar";
  const grip = document.createElement("span");
  grip.className = "idea-note-grip"; grip.setAttribute("aria-hidden", "true");
  bar.appendChild(grip);
  const del = document.createElement("button");
  del.type = "button"; del.className = "idea-note-del"; del.textContent = "✕"; del.title = "Delete note";
  del.addEventListener("click", (e) => { e.stopPropagation(); deleteNote(note.id); });
  bar.appendChild(del);
  root.appendChild(bar);

  const body = document.createElement("div");
  body.className = "idea-note-body";
  body.contentEditable = "true";
  body.spellcheck = false;
  body.dataset.placeholder = "Type an idea…";
  body.textContent = note.text || "";
  let saveT = null;
  body.addEventListener("input", () => { clearTimeout(saveT); const text = body.innerText; saveT = setTimeout(() => updateNote(note.id, { text }), 350); });
  root.appendChild(body);

  const resize = document.createElement("div");
  resize.className = "idea-note-resize";
  resize.addEventListener("pointerdown", (e) => startNoteResize(e, note.id, root));
  root.appendChild(resize);

  // The whole note is draggable. A click that doesn't move focuses the body for
  // editing; a drag past a small threshold moves the note. While the body is
  // already focused, pointer events on it edit text (move via the header grip).
  root.addEventListener("pointerdown", (e) => startNoteDrag(e, note, root, body));

  return root;
}

function startNoteDrag(e, note, root, body) {
  if (e.button !== 0) return;
  if (e.target.closest(".idea-note-del, .idea-note-resize")) return; // their own handlers
  const onBody = body.contains(e.target);
  if (onBody && document.activeElement === body) return; // editing — let text selection happen
  e.preventDefault(); // suppress native focus/selection; we focus manually on a plain click
  const sx = e.clientX, sy = e.clientY, ox = note.x, oy = note.y, z = ideaPan.zoom;
  let moved = false;
  const move = (ev) => {
    if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
    if (!moved) { moved = true; root.classList.add("dragging"); if (document.activeElement === body) body.blur(); }
    root.style.left = (ox + (ev.clientX - sx) / z) + "px";
    root.style.top = (oy + (ev.clientY - sy) / z) + "px";
  };
  const up = (ev) => {
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
    if (moved) {
      root.classList.remove("dragging");
      updateNote(note.id, { x: Math.round(ox + (ev.clientX - sx) / z), y: Math.round(oy + (ev.clientY - sy) / z) });
    } else if (onBody) {
      body.focus(); // plain click → edit
    }
  };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
}

function startNoteResize(e, id, root) {
  e.preventDefault(); e.stopPropagation();
  const note = activeCanvas().notes[id]; if (!note) return;
  const sx = e.clientX, sy = e.clientY, ow = note.w, oh = note.h, z = ideaPan.zoom;
  const move = (ev) => {
    const w = Math.max(NOTE_MIN, ow + (ev.clientX - sx) / z);
    const h = Math.max(NOTE_MIN, oh + (ev.clientY - sy) / z);
    root.style.width = w + "px"; root.style.height = h + "px";
  };
  const up = (ev) => {
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
    updateNote(id, { w: Math.round(Math.max(NOTE_MIN, ow + (ev.clientX - sx) / z)), h: Math.round(Math.max(NOTE_MIN, oh + (ev.clientY - sy) / z)) });
  };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
}

function renderIdeas() {
  const canvas = activeCanvas();
  const notes = canvas.notes || {};
  const ids = Object.keys(notes);
  el.ideasLayer.innerHTML = "";
  for (const id of ids) el.ideasLayer.appendChild(buildNoteEl(notes[id]));
  let hint = el.ideasViewport.querySelector(".ideas-empty");
  if (!ids.length && !hint) {
    hint = document.createElement("div");
    hint.className = "ideas-empty";
    hint.textContent = "Double-click anywhere to add your first idea.";
    el.ideasViewport.appendChild(hint);
  } else if (ids.length && hint) {
    hint.remove();
  }
  applyIdeasTransform();
}

function ideaLayerPoint(clientX, clientY) {
  const rect = el.ideasViewport.getBoundingClientRect();
  return { x: (clientX - rect.left - ideaPan.x) / ideaPan.zoom, y: (clientY - rect.top - ideaPan.y) / ideaPan.zoom };
}
function setZoom(z, cx, cy) {
  const rect = el.ideasViewport.getBoundingClientRect();
  if (cx == null) { cx = rect.width / 2; cy = rect.height / 2; }
  const next = Math.min(2.5, Math.max(0.25, z));
  const wx = (cx - ideaPan.x) / ideaPan.zoom, wy = (cy - ideaPan.y) / ideaPan.zoom;
  ideaPan.zoom = next; ideaPan.x = cx - wx * next; ideaPan.y = cy - wy * next;
  applyIdeasTransform();
}

el.ideasViewport.addEventListener("dblclick", (e) => {
  if (e.target.closest(".idea-note")) return;
  const p = ideaLayerPoint(e.clientX, e.clientY);
  addNote(p.x - NOTE_W / 2, p.y - NOTE_H / 2);
});
el.ideasViewport.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".idea-note")) return;
  e.preventDefault();
  el.ideasViewport.classList.add("is-panning");
  const sx = e.clientX, sy = e.clientY, ox = ideaPan.x, oy = ideaPan.y;
  const move = (ev) => { ideaPan.x = ox + (ev.clientX - sx); ideaPan.y = oy + (ev.clientY - sy); applyIdeasTransform(); };
  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); el.ideasViewport.classList.remove("is-panning"); };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
});
el.ideasViewport.addEventListener("wheel", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  const rect = el.ideasViewport.getBoundingClientRect();
  setZoom(ideaPan.zoom * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });
function addNoteAtCenter(typeKey) {
  const rect = el.ideasViewport.getBoundingClientRect();
  const p = ideaLayerPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  addNote(p.x - NOTE_W / 2, p.y - NOTE_H / 2, typeKey);
}
function buildIdeasTypeMenu() {
  el.ideasTypeMenu.innerHTML = "";
  for (const t of NOTE_TYPES) {
    const item = document.createElement("button");
    item.type = "button"; item.className = "ideas-type-item"; item.dataset.type = t.key; item.setAttribute("role", "menuitem");
    const dot = document.createElement("span"); dot.className = "ideas-type-dot"; dot.style.background = t.color;
    item.appendChild(dot); item.appendChild(document.createTextNode(t.label));
    el.ideasTypeMenu.appendChild(item);
  }
}
function closeIdeasTypeMenu() {
  if (el.ideasTypeMenu.hidden) return;
  el.ideasTypeMenu.hidden = true;
  el.ideasTypeBtn.setAttribute("aria-expanded", "false");
}
buildIdeasTypeMenu();
el.ideasAdd.addEventListener("click", () => addNoteAtCenter(NOTE_TYPES[0].key));
el.ideasTypeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = el.ideasTypeMenu.hidden;
  el.ideasTypeMenu.hidden = !open;
  el.ideasTypeBtn.setAttribute("aria-expanded", open ? "true" : "false");
});
el.ideasTypeMenu.addEventListener("click", (e) => {
  const item = e.target.closest(".ideas-type-item"); if (!item) return;
  addNoteAtCenter(item.dataset.type);
  closeIdeasTypeMenu();
});
document.addEventListener("click", (e) => { if (!el.ideasTypeMenu.hidden && !e.target.closest(".ideas-add-wrap")) closeIdeasTypeMenu(); });
el.ideasZoomIn.addEventListener("click", () => setZoom(ideaPan.zoom * 1.2));
el.ideasZoomOut.addEventListener("click", () => setZoom(ideaPan.zoom / 1.2));
el.ideasZoomReset.addEventListener("click", () => { ideaPan = { x: 40, y: 40, zoom: 1 }; applyIdeasTransform(); });

// ===================== News: developer feed =====================

const NEWS_TTL_MS = 15 * 60 * 1000;
let newsItems = [];

function newsAge(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}
function aiErrorText(error) {
  if (error === "no_key") return "Add your Claude API key in Settings → Integrations to use summaries.";
  if (error === "rate_limited") return "Claude is rate-limited — try again in a moment.";
  if (error === "overloaded") return "Claude is busy right now — try again shortly.";
  if (error === "auth") return "Your Claude API key was rejected. Check it in Settings.";
  return "Couldn’t summarize — please try again.";
}

function buildNewsItem(item) {
  const li = document.createElement("li");
  li.className = "news-item";

  const head = document.createElement("div");
  head.className = "news-item-head";
  const badge = document.createElement("span");
  badge.className = "news-source " + item.source;
  badge.textContent = item.source === "hn" ? "HN" : "Dev.to";
  head.appendChild(badge);
  const a = document.createElement("a");
  a.className = "news-title"; a.href = item.url; a.target = "_blank"; a.rel = "noopener noreferrer";
  a.textContent = item.title;
  head.appendChild(a);
  li.appendChild(head);

  const meta = document.createElement("div");
  meta.className = "news-meta";
  const bits = [];
  if (item.points) bits.push(`▲ ${item.points}`);
  if (item.comments) bits.push(`💬 ${item.comments}`);
  if (item.author) bits.push(item.author);
  const age = newsAge(item.time);
  if (age) bits.push(age);
  meta.appendChild(document.createTextNode(bits.join("  ·  ")));
  if (item.commentsUrl && item.commentsUrl !== item.url) {
    const cl = document.createElement("a");
    cl.className = "news-title"; cl.style.fontSize = "12px"; cl.style.fontWeight = "400";
    cl.href = item.commentsUrl; cl.target = "_blank"; cl.rel = "noopener noreferrer"; cl.textContent = "comments";
    meta.appendChild(document.createTextNode("  ·  ")); meta.appendChild(cl);
  }
  const sum = document.createElement("button");
  sum.type = "button"; sum.className = "news-summarize"; sum.textContent = "Summarize";
  meta.appendChild(sum);
  li.appendChild(meta);

  sum.addEventListener("click", async () => {
    let box = li.querySelector(".news-summary");
    if (!box) { box = document.createElement("div"); box.className = "news-summary"; li.appendChild(box); }
    box.classList.remove("err"); box.textContent = "Summarizing…";
    sum.disabled = true;
    const res = await aiSend("aiSummarize", { title: item.title, url: item.url });
    if (res && res.ok) { box.textContent = res.text; }
    else { box.textContent = aiErrorText(res && res.error); box.classList.add("err"); }
    sum.disabled = false; sum.textContent = "Summarize";
  });

  return li;
}

function renderNews(errors) {
  const list = newsFilter === "all" ? newsItems : newsItems.filter((i) => i.source === newsFilter);
  el.newsList.innerHTML = "";
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "drawer-empty";
    li.textContent = (errors && errors.length) ? "Couldn’t load news from " + errors.join(", ") + "." : "No stories to show.";
    el.newsList.appendChild(li);
    return;
  }
  for (const item of list) el.newsList.appendChild(buildNewsItem(item));
  if (errors && errors.length) {
    const li = document.createElement("li");
    li.className = "drawer-empty";
    li.textContent = "Couldn’t load: " + errors.join(", ") + ".";
    el.newsList.appendChild(li);
  }
}

async function loadNews(force) {
  if (!force) {
    const cache = (await chrome.storage.local.get("newsCache")).newsCache;
    if (cache && Array.isArray(cache.items)) {
      newsItems = cache.items;
      renderNews();
      if (Date.now() - (cache.ts || 0) < NEWS_TTL_MS) return; // fresh enough
    }
  }
  if (!newsItems.length) el.newsList.innerHTML = '<li class="drawer-empty">Loading developer news…</li>';
  try {
    const { items, errors } = await fetchAllNews();
    if (items.length) {
      newsItems = items;
      await chrome.storage.local.set({ newsCache: { items, ts: Date.now() } });
    }
    renderNews(errors);
  } catch (e) {
    if (!newsItems.length) el.newsList.innerHTML = '<li class="drawer-empty">Couldn’t load news. Check your connection and try Refresh.</li>';
  }
}

el.newsFilter.addEventListener("click", (e) => {
  const t = e.target.closest(".news-src-tab"); if (!t) return;
  newsFilter = t.dataset.src;
  el.newsFilter.querySelectorAll(".news-src-tab").forEach((x) => {
    const on = x.dataset.src === newsFilter;
    x.classList.toggle("is-active", on);
    x.setAttribute("aria-selected", on ? "true" : "false");
  });
  renderNews();
});
el.newsRefresh.addEventListener("click", () => loadNews(true));

// ----------------------------- init -----------------------------

async function init() {
  const data = await chrome.storage.local.get(["settings", "timer", "board", "boards", "activeBoardId", "globalList", "widgetLayout", "calConnected", "trelloSeeded", "slack", "slackCounts", "gmailConnected", "gmailNotify", "gmailCache", "anthropic", "ideas"]);
  settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  timer = data.timer || { isRunning: false, isPaused: false, mode: "focus", endTime: null, remaining: settings.focusMin * 60, completedFocusTotal: 0 };

  // boards: load existing, migrate a legacy single board, or seed defaults
  if (Array.isArray(data.boards) && data.boards.length) {
    boards = data.boards;
  } else if (data.board && Array.isArray(data.board.columns) && data.board.columns.length) {
    boards = [{ id: newId(), name: "My Board", icon: "📋", columns: data.board.columns, tasks: data.board.tasks || {} }];
  } else {
    boards = defaultBoards();
  }

  // one-time Trello import: replace the untouched starter boards, otherwise append
  if (!data.trelloSeeded) {
    const seeded = TRELLO_SEED.map(buildSeededBoard);
    boards = boards.every(boardIsEmpty) ? seeded : [...boards, ...seeded];
    activeBoardId = seeded[0].id;
    await chrome.storage.local.set({ trelloSeeded: true });
  }

  activeBoardId = (activeBoardId && boards.some((b) => b.id === activeBoardId)) ? activeBoardId
    : (data.activeBoardId && boards.some((b) => b.id === data.activeBoardId)) ? data.activeBoardId
    : boards[0].id;
  syncActiveBoard();
  await saveBoard();
  globalList = normalizeGlobalList(data.globalList);
  await saveGlobalList();
  widgetLayout = normalizeWidgetLayout(data.widgetLayout || DEFAULT_WIDGET_LAYOUT);
  calConnected = !!data.calConnected;
  slackCfg = data.slack || null;
  gmailConnected = !!data.gmailConnected;
  gmailNotify = !!data.gmailNotify;
  anthropicCfg = data.anthropic || null;
  ideas = normalizeIdeas(data.ideas);
  saveIdeas();

  applyTheme();
  renderTimer();
  startTick();
  renderRail();
  renderBoard();
  renderGlobalList();
  loadWeather();
  loadCalendar();
  renderSlack(data.slackCounts || null);
  if (slackConfigured()) send("slackRefresh");
  renderGmail(data.gmailCache || null);
  loadGmail();
  setView(settings.view || "boards");

  // refresh periodically while the tab stays open (daily driver)
  setInterval(() => loadWeather(), 30 * 60 * 1000);
  setInterval(() => loadCalendar(), 5 * 60 * 1000);
  setInterval(() => loadGmail(), 2 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadWeather(); loadCalendar(); loadGmail(); if (slackConfigured()) send("slackRefresh"); } });
}

init();
