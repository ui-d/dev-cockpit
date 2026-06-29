# CLAUDE.md — DevCockpit

Guidance for Claude (and other AI assistants) working in this repository. Read this first.

## What this is

**DevCockpit** is a Manifest V3 Chrome extension — a board-first daily work surface.
A slim top bar carries a Pomodoro timer, Google Calendar, weather, and Slack + Gmail
unread counts; the rest of the page is a Trello-style multi-board. Everything opens on
one full-page tab from the toolbar icon.

End-user documentation lives in [`README.md`](README.md). This file is for *changing* the
code, not using the app.

## Hard constraints (read before editing)

- **No build step, no framework, no dependencies.** Plain ES modules + vanilla DOM. There is
  no `package.json`, no bundler, no transpiler. Do **not** introduce npm packages, a build
  tool, TypeScript compilation, or a framework without explicit instruction — it would break
  the "load unpacked and go" workflow.
- **Manifest V3 service worker.** `background.js` is a module service worker. It has no DOM
  and no persistent global state — it can be torn down at any time. Persist everything to
  `chrome.storage.local`; never rely on a module-level variable surviving between events.
- **Never commit or back up secrets.** Anthropic API keys, Slack tokens/cookies, and Google
  OAuth tokens live only in `chrome.storage.local`. They must never be logged, echoed into a
  field, or written into a backup file/snapshot. The backup allowlist is `BACKUP_DATA_KEYS`
  in `backup.js` (`boards`, `activeBoardId`, `settings`, `globalList`, `ideas`) — keep
  credential keys (and regenerable caches like `newsCache`) out of it.
- **Keep the extension ID stable.** The fixed `key` in `manifest.json` pins the ID to
  `aiegllbeihjbphiilgeifggceklfffkn`, which the Google OAuth client is bound to. Don't remove
  or change `key`.
- **CSP is strict.** `manifest.json` sets `content_security_policy` for extension pages.
  Adding a new audio/media source (e.g. a soundscape stream) means adding its origin to
  `media-src`. No remote scripts — `script-src 'self'` only.

## File map

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest: permissions, host permissions, OAuth client, CSP, stable `key`. |
| `background.js` | Service worker. Timer phase transitions, toolbar badge, chime + notifications via `chrome.alarms`; background Slack polling; Anthropic AI calls; rolling snapshots + daily auto-backup. |
| `app.html` / `app.js` / `app.css` | The full-page UI. Three top-bar views — **Boards**, **Ideas** (free-form sticky-note canvas), **News** (HN + Dev.to feed) — plus timer, pinned list, widgets, calendar, weather, Slack, Gmail, settings. `app.js` is large (~3k lines) but split into clearly labelled sections. |
| `slack.js` | Slack `client.counts` reader (fetch + parse). Imported by the worker. |
| `news.js` | Hacker News (Algolia) + Dev.to fetchers/normalizers for the News view. Imported by the **page** and fetched directly (keyless, CORS-friendly), like weather. |
| `anthropic.js` | Anthropic Messages API client powering the Slack panel's PL-explain / EN-reply buttons. |
| `i18n.js` | DOM-free, dependency-free message catalogue (English + Polish) and `t()` lookup. Imported by the page and the worker. See **Internationalization** below. |
| `backup.js` | Shared JSON backup format + helpers (`buildBackup`, `readBackup`, `fingerprint`). Defines `BACKUP_DATA_KEYS`. |
| `offscreen.html` / `offscreen.js` | Offscreen document that plays the chime when no tab is open. |
| `icons/` | Toolbar/extension icons. `screenshots/` | README images. |

## Architecture notes

- **Worker owns time, the UI reflects it.** All timer truth (phase, end time, badge,
  notifications) lives in `background.js` and fires on `chrome.alarms` so it works with no tab
  open. `app.js` sends commands and renders state — it does not own the countdown.
- **App ↔ worker messaging** is `chrome.runtime.sendMessage({ type, ... })`; the worker's
  `onMessage` switch dispatches to `cmd*` handlers (`cmdStart`, `cmdAdjust`, etc.). To add a
  timer/worker action: add a `cmd*` handler and a `case` in the switch, then call it from the app.
- **State sync** is via `chrome.storage.local` + an `onChanged` listener in `app.js`, so a
  change in one place re-renders the UI. Prefer updating storage over poking the DOM directly.
- **`app.js` section dividers** (`// ----- timer -----`, `// ----- soundscape widget -----`,
  etc.) are the table of contents — grep them to navigate. Keep new code inside the right
  section and add a divider for a genuinely new area.
- **Top-bar views.** `setView('boards'|'ideas'|'news')` toggles the three main containers
  (`#workspace`, `#ideasView`, `#newsView`) by setting their `hidden` attribute and persists
  the choice to `settings.view`. Because each view sets `display:flex`, `[hidden]` is re-forced
  to `display:none` in CSS (a plain `[hidden]` UA rule would lose to the author `display`).
  Adding a view means: a `.view-tab` button, a container, a branch in `setView`, and (if it has
  state) a storage key + `BACKUP_DATA_KEYS` entry.
- **Ideas vs. News data flow.** Ideas is local state (`ideas` in storage, immutable updates,
  `saveIdeas()`); an `ideasMutating` flag suppresses our own `onChanged` re-render so a note
  being typed in isn't wiped. News is fetched from public APIs via `news.js` straight from the
  page (no worker round-trip) and cached in `newsCache`; the per-story **Summarize** button is
  the one News→worker call (`aiSummarize` → `runAiTask('summarize')` → `anthropic.js`).
- **Legacy name.** The project was renamed FocusFlow → DevCockpit. `chrome.alarms` are still
  prefixed `ff-`, and `backup.js` accepts `focusflow` backups via `LEGACY_BACKUP_APPS`. Don't
  "fix" these names — they preserve compatibility with existing installs.
- **Internationalization.** UI copy is **English + Polish**, chosen via `settings.language`
  (`'en'|'pl'`, defaults to `detectLang()` from the browser). Chrome's native `chrome.i18n`
  isn't used — it keys off the browser UI locale and can't be switched at runtime — so `i18n.js`
  is a custom `t(key, vars)` catalogue with `{var}` interpolation. Static markup carries
  `data-i18n` / `data-i18n-title` / `data-i18n-aria` / `data-i18n-placeholder` attributes
  (text attributes go on **leaf** elements so the walker never wipes child inputs/SVGs);
  dynamically-generated strings call `t(...)`. `applyStaticI18n()` translates the page and
  `applyLanguage()` re-runs the renderers for a live switch (mirrors `applyTheme()`), wired into
  the settings submit, a live-preview `change` listener, and the `onChanged` settings handler.
  `i18n.js` stays DOM-free so the worker imports it for notification strings. To add a string:
  add the key to **both** `EN` and `PL` in `i18n.js` (keep them at parity), then reference it via
  `data-i18n*` or `t()`. User content (board/card/note text) is never translated; the Slack-panel
  AI buttons stay intentionally bilingual.

## Storage keys (chrome.storage.local)

`settings` (includes `view`, the last-active top-bar view, and `language`, `'en'|'pl'`), `timer`, `boards`,
`activeBoardId`, `globalList`, `widgetLayout`, `ideas` (Ideas canvas: `{ canvases, activeId }`),
`newsCache` (regenerable News feed, ~15 min TTL), `slack` (creds), `slackCounts`, `slackUsers`,
`slackConvos`, `anthropic` (creds), `backups` (rolling snapshots), `lastAutoBackup`. Backups
serialize only `BACKUP_DATA_KEYS`.

## Conventions

- Vanilla DOM with a `$ = (s) => document.querySelector(s)` helper and a cached `el` object
  of element references at the top of `app.js`. Follow that pattern rather than re-querying.
- Treat state updates immutably (spread into a new object/array, then write to storage) —
  matches the existing code and avoids stale-render bugs.
- Plain English in user-facing copy; the Slack AI buttons are intentionally bilingual
  (Polish explain / English reply).
- Keep functions small and within their labelled section. Files are already focused; prefer
  extending a section over adding a new top-level file unless it's a distinct module.

## Running, testing, verifying

- **Run:** `chrome://extensions` → Developer mode → **Load unpacked** → pick this folder →
  click the toolbar icon. Reload from that page after edits (the service worker too).
- **Syntax check (do this before committing):** `for f in *.js; do node --check "$f"; done`.
- **No automated test suite exists.** There is no runner, no coverage tooling. If asked to
  add tests, confirm the approach first — a headless-Chrome harness is a significant addition
  to a zero-dependency repo. For now, verify changes manually in the loaded extension and
  check the service-worker console (`chrome://extensions` → *Inspect views: service worker*).
- **Debugging:** app page via normal DevTools; worker via the service-worker inspector;
  the offscreen chime via the offscreen document's console.

## Git / GitHub

- Remote: `github.com/ui-d/dev-cockpit`. Default branch `main`.
- `.claude/` and `.playwright-mcp/` are gitignored — never commit them.
- Commit style is conventional commits (`feat:`, `fix:`, `docs:`, `chore:`). Bump
  `manifest.json` `version` for user-visible releases.
- When a change adds a feature, update `README.md` in the same commit so docs never drift.
