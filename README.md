# DevCockpit — Board, Timer, Day

![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)
![Vanilla JS](https://img.shields.io/badge/Vanilla-JS-F7DF1E?logo=javascript&logoColor=black)
![No build step](https://img.shields.io/badge/build-none-brightgreen)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-2.3.0-orange)

A board-first Chrome extension built to be your daily work surface. A slim top bar
carries a minimal Pomodoro timer, today's Google Calendar, the current weather, and your
Slack + Gmail unread counts. Three buttons in the centre of the bar switch the main area
between **Boards** (Trello-style lists), **Ideas** (a free-form sticky-note canvas), and
**News** (a developer-news feed) — press **1 / 2 / 3** to jump between them. Everything
lives on one full-page tab that opens when you click the toolbar icon.

> Screenshots below use the built-in **Zed (One Dark)** theme. DevCockpit ships nine
> base themes and nine accent colors, and by default follows your system light/dark
> setting — see [Themes & appearance](#themes--appearance).

![DevCockpit board in the Zed (One Dark) theme — top bar with timer, weather, calendar, Slack and Gmail; three lists; a pinned list with the work-clock widget on the right](screenshots/board.png)

The slim top bar up close — Pomodoro timer and transport controls on the left; weather,
calendar, Slack and Gmail on the right:

![DevCockpit top bar close-up in the Zed theme](screenshots/topbar.png)

## Highlights

- **Views** — three buttons centred in the top bar switch the whole main area between
  **Boards**, **Ideas**, and **News** (keys **1 / 2 / 3**). The timer and the calendar /
  weather / Slack / Gmail pills stay live in the bar across all three. Your last-used view is
  remembered. See [Ideas](#ideas) and [News](#news).
- **Timer** lives in the top bar: just the number and three controls — start/pause, reset,
  and (in settings) the phase lengths. Focus ↔ break only (no long break). A chime plays at
  every phase transition (the pitch nudges down going into a break, up going back to focus).
  Remaining time shows on the toolbar icon — ember while focusing, sage during a break, grey
  when paused. Keyboard: **Space** start/pause · **R** reset · **S** skip phase · **F** focus ·
  **B** break · **+ / −** (or **↑ / ↓**) extend/shorten by a minute · **M** mute chime ·
  **A** toggle auto-start · **T** cycle theme · **?** show all shortcuts.
- **Calendar** pill shows the ongoing or next meeting; click it for the full agenda for
  **today and tomorrow**, split into two sections. A meeting in progress gives the pill an
  accent outline.
- **Weather** pill shows the current temperature alongside the day's high (↑) and low (↓);
  click it for feels-like, high/low, and wind.
- **Slack** pill shows your combined unread count (DMs + @mentions); click it for the
  per-conversation breakdown. The count also shows on the toolbar icon when the timer is
  idle, and you can opt into a desktop alert on new activity.
- **Gmail** pill (to the right of Slack) shows your inbox unread count; click it for the
  unread message/thread breakdown and a link to open Gmail. Uses the same Google sign-in
  as Calendar with a read-only `gmail.metadata` scope (label counts only — never message
  contents), and you can opt into a desktop alert when new mail arrives.
- **AI helpers (optional)** — with your own Anthropic API key, the Slack panel adds two
  per-message buttons: **Wyjaśnij (PL)** explains a message in Polish, and **Odpowiedz (EN)**
  drafts a ready-to-send English reply you can copy. See [AI helpers](#ai-helpers-optional).
- **Board** fills the screen: lists and cards with drag & drop, add / rename / delete
  lists, add / edit / delete cards. Drag a card between lists, or grab a list by the **⠿**
  handle on its header to reorder the lists themselves left-to-right. Pressing **Enter**
  when adding a card saves it and keeps the input focused so you can add the next one
  immediately. Hover a card and press **C** to delete it. The **⤴** button on a list header
  moves that whole list (and its cards) to another board. Saved locally on this device.
- **Boards** — keep several boards (e.g. Work, Personal, Lifestyle). A rail of small board
  icons sits on the **left** edge, one under another. Click an icon to switch boards; click
  the active icon again to rename it, change its emoji, or delete it. Use **+** to add one.
- **Pinned list** — a single list docked on the **right** edge that stays visible on
  **every** board. Its name is editable, and it has its own **+ Add a card** button (or press
  **N** anywhere to drop a card straight into it). Drag cards into it from any board (or back
  out), so anything you want to keep at hand follows you as you switch boards. Below it sits a small **widget tray** (see
  [Pinned list & widgets](#pinned-list--widgets)). The Slack, Gmail, Calendar and Weather
  panels float over the pinned list when opened.
- **Ideas** — a free-form, infinitely pannable/zoomable canvas of sticky notes, à la Apple
  Freeform. Double-click (or **+ Note**) to drop a note, drag it anywhere, resize it, and type
  inline. The **+ Note ▾** dropdown offers several note types (Sticky, Idea, To-do, Question,
  Highlight, Plain), each its own colour. See [Ideas](#ideas).
- **News** — a developer-news feed aggregating **Hacker News** and **Dev.to** into a
  three-column grid, with source filters and refresh. Each story can be **summarized** by
  Claude on demand (uses your Anthropic key). See [News](#news).
- **Themes** — nine base themes (including **Zed / One Dark**, Solarized, Sepia, Midnight
  OLED and a high-contrast dark) plus nine accent colors, or follow your system setting.

## Install (unpacked)

1. Open `chrome://extensions`, turn on **Developer mode**.
2. Click **Load unpacked** and pick this extension folder (the one containing
   `manifest.json`).
3. Click the toolbar icon — the full page opens in a new tab.

The extension ships a fixed key in `manifest.json`, so it always loads under the same ID:
**`aiegllbeihjbphiilgeifggceklfffkn`**. That stable ID is what the Google OAuth client is
tied to (see below).

## Themes & appearance

Open settings (gear, bottom-left) → **Appearance**:

![Settings → Appearance, with the Zed (One Dark) theme selected](screenshots/appearance.png)

- **Theme** — `System` (follows your OS light/dark setting), `Dark`, `Dark (High Contrast)`,
  `Light`, `Midnight (OLED)`, `Sepia`, `Solarized Dark`, `Solarized Light`, and
  `Zed (One Dark)`. The screenshots in this README use **Zed (One Dark)**.
- **Accent color** — `Ember` (default), `Ocean`, `Violet`, `Forest`, `Rose`, `Amber`,
  `Crimson`, `Teal`, `Graphite`. The accent tints the focusing timer, the in-progress
  calendar pill, links and focus rings; the break phase always uses a sage green so you can
  tell focus from break at a glance.

The choice is stored per-device and applies instantly.

## Pinned list & widgets

The pinned list is docked on the right edge and shown on every board. Under its cards is a
four-slot **widget tray**. Which widget sits in which slot is configurable: click the **⚙**
in the tray header (or any empty slot) to open **Manage widgets**, where you can add, remove,
and reorder widgets across the four slots. The layout is saved per device.

Available widgets:

- **Work clock.** An analog clock with a 9 AM → 5 PM band painted around the dial and a live
  countdown to 5 PM, so you can see how much of the workday is left at a glance.
- **Soundscapes.** Relaxing background audio over a dimmed, gently drifting waves graphic.
  Click a scene to play it; click it again to stop (no separate pause button). Five scenes:
  **Lofi, Ambient, Piano, Nature, Rain** — each backed by a real internet-radio stream for
  studio-quality audio (SomaFM, EPIC Classical, nature/rain stations), with a synthesized mix
  as an automatic offline fallback. **Lofi** is instrumental/no-vocal; clicking it again cycles
  through three SomaFM channels before switching off.

## Ideas

Switch to **Ideas** (centre of the top bar, or press **2**) for a free-form sticky-note
canvas modelled on Apple Freeform:

- **Add a note** — double-click empty canvas, or click **+ Note**. The **▾** next to it opens
  a menu of note **types** — *Sticky note, Idea, To-do, Question, Highlight, Plain* — each
  with its own colour; picking one drops that type at the centre.
- **Move / edit / resize** — drag a note anywhere to move it; a single click inside it places
  the caret so you can type; drag the bottom-right corner to resize. Hover a note and click
  **✕** to delete it.
- **Pan & zoom** — drag empty canvas to pan; **⌘/Ctrl + scroll** (or the **− / + / %**
  controls) to zoom from 25 % to 250 %; the **%** button resets the view.

Notes are saved per device in `chrome.storage.local` and are included in
[backups](#backup--restore).

## News

Switch to **News** (top bar, or press **3**) for a developer-news feed. It aggregates the
**Hacker News** front page and **Dev.to** top articles into a three-column card grid
(two columns, then one, on narrower windows), newest first.

- **Filter** by source with the **All / Hacker News / Dev.to** tabs; **↻ Refresh** re-fetches.
- Each card links out (opens in a new tab) and shows points, comments, author, and age.
- **Summarize** — if you've added an Anthropic API key (see [AI helpers](#ai-helpers-optional)),
  each card gets a **Summarize** button that asks Claude for a one-to-two-sentence plain-English
  summary. Without a key, the button explains where to add one.

Both sources are keyless public APIs fetched directly from the page; results are cached
locally for ~15 minutes so the feed shows instantly on open. Nothing here is stored in
backups.

## Weather

Open settings (gear) → **Integrations** → **Weather** → type a city, or click
**Use my location**. Data comes from Open-Meteo (no API key). It refreshes every 30 minutes
and is cached locally so the pill is populated immediately on open.

## Google Calendar (optional, one-time setup)

Calendar uses Google's official API via Chrome's identity flow. You need your own OAuth
client (free). Steps:

1. Go to **Google Cloud Console** → create or pick a project.
2. **APIs & Services → Library** → enable **Google Calendar API** (and **Gmail API** if
   you also want the Gmail unread pill).
3. **OAuth consent screen** → External → add your own Google account under **Test users**,
   and add the scopes `calendar.readonly` and (for Gmail) `gmail.metadata`.
4. **Credentials → Create credentials → OAuth client ID** → application type
   **Chrome extension** → Application/Item ID:
   `aiegllbeihjbphiilgeifggceklfffkn`
5. Copy the generated **Client ID** (looks like `…apps.googleusercontent.com`).
6. Open `manifest.json`, replace `oauth2.client_id` value with your Client ID, save.
7. Reload the extension at `chrome://extensions`, then in settings → Integrations →
   **Google Calendar** → **Connect** and approve the read-only access.

Scopes requested are `calendar.readonly` and `gmail.metadata` — each is requested only
when you connect that feature, so connecting Calendar won't prompt for Gmail (or vice
versa). Until this is set up, the Calendar and Gmail pills just show a "connect in
settings" hint and the rest of the extension works normally.

## Gmail unread (optional)

The Gmail pill — to the right of the Slack badge — shows your **inbox unread count**. It
reuses the same Google OAuth client as Calendar (see above) but requests only the
read-only `gmail.metadata` scope, which exposes label counts and never message contents.

After the Google client is configured, open settings (gear) → **Integrations** →
**Gmail unread** → **Connect** and approve. The count refreshes every couple of minutes
while the tab is open; click the pill for the unread message/thread breakdown and a link to
open Gmail. Tick **Desktop alerts for new Gmail** to be notified when the unread count climbs.

## Slack unread (optional)

The Slack pill shows one combined number — unread **DMs + @mentions** — by reading
Slack's internal `client.counts` endpoint, the same one the Slack web app polls. Because
that endpoint only accepts a **browser-session token**, you paste two values from a logged-in
Slack web session (there is no Slack app to create).

In Chrome, open your workspace at `https://<your-team>.slack.com`, then DevTools (⌥⌘I):

1. **Session token (`xoxc-…`)** — Console tab, run:
   `JSON.parse(localStorage.localConfig_v2).teams` and copy your team's `token`.
   (Alternatively, copy the `token` form field from any `client.*` request in the Network tab.)
2. **Cookie `d` (`xoxd-…`)** — Application tab → Cookies → your Slack URL → copy the value of
   the cookie named **`d`**.

Then in DevCockpit: settings (gear) → **Integrations** → **Slack unread** → paste the
workspace URL, token, and cookie → **Connect**. The pill updates within a couple of minutes
and refreshes every ~2 min.

> ⚠️ This is an **unofficial** method. The tokens grant **full access to your Slack account**,
> they **reset when you log out** of Slack web (just re-paste), and they're stored only in this
> device's local extension storage. Enterprise Grid workspaces use a different endpoint and may
> not work. Use **Clear** in settings to remove the credentials and the `d` cookie.

## AI helpers (optional)

When you add an Anthropic API key, the Slack panel gains two buttons under each message:

- **Wyjaśnij (PL)** — a 1–3 sentence Polish explanation of what the message is about and
  what the sender wants.
- **Odpowiedz (EN)** — drafts a natural, professional English reply you can send as-is, with
  a **Kopiuj** (copy) button.

Set it up in settings (gear) → **Integrations** → **AI (Anthropic)**:

1. Paste your key (`sk-ant-…`) and click **Save key**.
2. Pick a model — **Claude Haiku 4.5** (fast & cheap, the default) or **Claude Sonnet 4.6**
   (smarter).

The key is stored only in this device's local extension storage and is never written to a
backup, never logged, and never echoed back into the field. Calls go directly from the
extension's service worker to `api.anthropic.com`. Without a key, the two buttons are
disabled and everything else works as normal. Use **Clear** to remove the key.

## Backup & restore

Your boards live in this device's local extension storage, so the extension keeps
backups for you. Open settings (gear) → **Backup** → **Backup & restore**:

- **Download backup** writes a `devcockpit-backup-YYYY-MM-DD.json` to your Downloads —
  a snapshot of all boards, your pinned list, the Ideas canvas, and settings that you can
  keep or move to another machine.
- **Restore from file…** reads one back. It validates the file first, asks you to
  confirm, and snapshots your current state before overwriting so a restore is undoable.
- **Auto-save a daily backup to Downloads** (on by default) writes that same file
  automatically once a day, but only when something has changed — one file per day.
- **Recent snapshots** — a rolling history (last 10) is captured automatically a couple
  of minutes after you make changes, kept inside the extension. Hit **Restore** on any
  snapshot to roll back an accidental delete or edit.

Backups contain **boards, the pinned list, the Ideas canvas, and settings only**. Slack,
Google, and Anthropic credentials — and the cached News feed — are never written to a backup
file or snapshot; after a restore on a new machine you just reconnect the integrations once,
as in first-time setup.

## How it works

Built as a zero-dependency Manifest V3 extension — plain ES modules and vanilla DOM, **no
build step, no framework, no npm install**. Clone it, load it unpacked, and it runs.

```
manifest.json        MV3 manifest — permissions, OAuth client, CSP, stable extension key
background.js        Service worker — timer, badge, chime, notifications, Slack polling, AI, backups
app.html/.js/.css    Full-page UI — views (Boards · Ideas · News), timer, pinned list, widgets, calendar, weather, Slack, Gmail
slack.js             Slack client.counts reader (imported by the worker)
news.js              Hacker News + Dev.to fetchers/normalizers (imported by the page)
anthropic.js         Anthropic Messages API client (imported by the worker)
backup.js            Shared JSON backup format + helpers
offscreen.html/.js   Plays the chime when no tab is open
icons/ screenshots/  Extension icons · README images
```

> Working on the code? See [CLAUDE.md](CLAUDE.md) for architecture notes and constraints.

- `background.js` (service worker) owns phase transitions, the toolbar badge, the chime
  and notifications via `chrome.alarms` — so they fire on time even with no tab open. It
  also polls Slack unread counts in the background and runs the AI calls.
- `slack.js` is the Slack `client.counts` reader (fetch + parse), imported by the worker.
- `news.js` fetches and normalizes the Hacker News (Algolia) and Dev.to APIs for the News
  view; it's imported by the page and fetches directly (keyless, CORS-friendly), like weather.
- `anthropic.js` is the Anthropic Messages API client (imported by the worker) that powers
  the Slack panel's **Wyjaśnij (PL)** / **Odpowiedz (EN)** buttons and the News **Summarize**
  button.
- `app.html` / `app.js` / `app.css` is the full-page UI (timer, board, pinned list &
  widgets, calendar, weather, Slack, Gmail, settings). The Gmail inbox unread count is read
  app-side from the Gmail API `users.labels.get` (INBOX) using the `gmail.metadata` scope.
- `offscreen.html` / `offscreen.js` plays the chime when no tab is open.
- Storage is `chrome.storage.local` (this device only). `backup.js` defines the shared
  JSON backup format; the service worker takes rolling snapshots and the daily file
  export, and the settings panel offers manual download/restore (see **Backup & restore**).

## Permissions

Declared in `manifest.json`: `storage` (boards, settings, caches), `alarms` (timer &
background polling), `offscreen` (the chime), `notifications` (timer / Slack / Gmail
alerts), `identity` (Google sign-in), `cookies` (the Slack `d` cookie), and `downloads`
(backup files). Host access is limited to Open-Meteo, Google APIs, Slack, the Anthropic
API, and the Hacker News (Algolia) and Dev.to APIs that feed the News view.

## License

[MIT](LICENSE) © Dawid Nawrocki
