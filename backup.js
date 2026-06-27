// DevCockpit — shared backup format + helpers.
// Imported by both the page (app.js) and the service worker (background.js).
// Pure functions only: no chrome.* calls, no DOM — so it runs in either context.

export const BACKUP_APP = "devcockpit";
// Backups written before the rename carried this id; still accept them on import.
export const LEGACY_BACKUP_APPS = ["focusflow"];
export const BACKUP_VERSION = 1;

// The only keys a backup carries. Deliberately excludes:
//   - caches that regenerate on their own: weatherCache, calCache, slackCounts
//   - secrets that must never leave the device: slack tokens, calConnected
//   - internal flags: trelloSeeded
export const BACKUP_DATA_KEYS = ["boards", "activeBoardId", "settings"];

// How many rolling in-app snapshots we keep.
export const MAX_SNAPSHOTS = 10;

// Pick just the backup keys out of a storage bag (skips undefined values).
function pickData(data) {
  const out = {};
  for (const key of BACKUP_DATA_KEYS) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return out;
}

// Build the file/snapshot envelope from a storage bag.
export function buildBackup(data, exportedAt) {
  return {
    app: BACKUP_APP,
    type: "backup",
    version: BACKUP_VERSION,
    exportedAt: exportedAt || new Date().toISOString(),
    data: pickData(data),
  };
}

// Validate a parsed backup object and return its data bag.
// Throws Error with a user-facing message on anything malformed.
export function readBackup(obj) {
  const appOk = obj && typeof obj === "object" &&
    (obj.app === BACKUP_APP || LEGACY_BACKUP_APPS.includes(obj.app));
  if (!appOk) {
    throw new Error("This file isn't a DevCockpit backup.");
  }
  if (typeof obj.version !== "number" || obj.version > BACKUP_VERSION) {
    throw new Error("This backup was made by a newer version of DevCockpit.");
  }
  const data = obj.data;
  if (!data || typeof data !== "object") {
    throw new Error("This backup is missing its data.");
  }
  if (!Array.isArray(data.boards) || data.boards.length === 0) {
    throw new Error("This backup has no boards in it.");
  }
  for (const b of data.boards) {
    if (!b || typeof b !== "object" || !Array.isArray(b.columns) || typeof b.tasks !== "object") {
      throw new Error("This backup's board data looks corrupted.");
    }
  }
  return {
    boards: data.boards,
    activeBoardId: typeof data.activeBoardId === "string" ? data.activeBoardId : data.boards[0].id,
    settings: data.settings && typeof data.settings === "object" ? data.settings : null,
  };
}

// A cheap content fingerprint so auto-backup / snapshots skip unchanged data.
export function fingerprint(data) {
  const s = JSON.stringify(pickData(data));
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${s.length}:${h}`;
}

// Dated filename: devcockpit-backup-2026-06-27.json
export function backupFileName(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `devcockpit-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}
