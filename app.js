// DevCockpit v2 — board-first daily driver.
// Top bar: minimal timer + Google Calendar + weather. Main area: the board.

import { BACKUP_DATA_KEYS, buildBackup, readBackup, backupFileName } from "./backup.js";

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
  if (e.target.matches("input, textarea, select")) return;
  if (document.querySelector("dialog[open]")) return;
  if (e.code === "Space") { e.preventDefault(); if (timer) send(timer.isRunning ? "pause" : "start"); }
  else if (e.key.toLowerCase() === "r") send("reset");
  else if (e.key.toLowerCase() === "s") send("skip");
  else if (e.key.toLowerCase() === "c") {
    const hovered = document.querySelector(".card:hover");
    if (hovered && hovered.dataset.taskId) deleteCardById(hovered.dataset.taskId);
  }
});

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
  el.settingsDialog.showModal();
}

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
  const label = document.createElement("span"); label.textContent = globalList.title || "Pinned";
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

  host.append(head, list, addBtn);
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
  if (changes.globalList && changes.globalList.newValue && !isDragging && !isAddingCard) {
    globalList = normalizeGlobalList(changes.globalList.newValue);
    renderGlobalList();
  }
});

// ----------------------------- init -----------------------------

async function init() {
  const data = await chrome.storage.local.get(["settings", "timer", "board", "boards", "activeBoardId", "globalList", "calConnected", "trelloSeeded", "slack", "slackCounts", "gmailConnected", "gmailNotify", "gmailCache", "anthropic"]);
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
  calConnected = !!data.calConnected;
  slackCfg = data.slack || null;
  gmailConnected = !!data.gmailConnected;
  gmailNotify = !!data.gmailNotify;
  anthropicCfg = data.anthropic || null;

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

  // refresh periodically while the tab stays open (daily driver)
  setInterval(() => loadWeather(), 30 * 60 * 1000);
  setInterval(() => loadCalendar(), 5 * 60 * 1000);
  setInterval(() => loadGmail(), 2 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadWeather(); loadCalendar(); loadGmail(); if (slackConfigured()) send("slackRefresh"); } });
}

init();
