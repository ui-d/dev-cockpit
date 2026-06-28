# DevCockpit — Board, Timer, Day

A board-first Chrome extension built to be your daily work surface. A slim top bar
carries a minimal Pomodoro timer, today's Google Calendar, and current weather — the
rest of the screen is a Trello-style board.

![DevCockpit board with the top bar — timer, calendar, weather, Slack and Gmail pills](screenshots/board.png)

The same top bar, up close — Pomodoro timer on the left; calendar, weather, Slack and
Gmail on the right:

![DevCockpit top bar close-up](screenshots/topbar.png)

It follows your system light/dark theme:

![DevCockpit in dark mode](screenshots/board-dark.png)

- **Timer** lives in the top bar: just the number and three icons — start/pause, reset,
  settings. Focus ↔ break only (no long break). A chime plays at every phase transition
  (the pitch nudges down going into a break, up going back to focus). Remaining time
  shows on the toolbar icon — ember while focusing, sage during a break, grey when paused.
  Keyboard: **Space** start/pause · **R** reset · **S** skip phase.
- **Calendar** pill shows the ongoing or next meeting; click it for the full agenda for
  **today and tomorrow**, split into two sections.
- **Weather** pill shows the current temperature alongside the day's high (↑) and low (↓);
  click it for feels-like, high/low, and wind.
- **Slack** pill shows your combined unread count (DMs + @mentions); click it for the
  DM/mention breakdown and a link to open Slack. The count also shows on the toolbar icon
  when the timer is idle, and you can opt into a desktop alert on new activity.
- **Gmail** pill (to the right of Slack) shows your inbox unread count; click it for the
  unread message/thread breakdown and a link to open Gmail. Uses the same Google sign-in
  as Calendar with a read-only `gmail.metadata` scope (label counts only — never message
  contents), and you can opt into a desktop alert when new mail arrives.
- **Board** fills the screen: lists and cards with drag & drop, add / rename / delete
  lists, add / edit / delete cards. Drag a card between lists, or grab a list by the **⠿**
  handle on its header to reorder the lists themselves left-to-right. Pressing **Enter**
  when adding a card saves it and keeps the input focused so you can add the next one
  immediately. Hover a card and press **C** to delete it. The **⤴** button on a list header
  moves that whole list (and its cards) to another board. Saved locally on this device.
- **Boards** — keep several boards (e.g. Personal, Work, Lifestyle). A rail of small board
  icons sits on the right edge, one under another. Click an icon to switch boards; click
  the active icon again to rename it, change its emoji, or delete it. Use **+** to add one.
- **Pinned list** — a single list docked on the right edge that stays visible on **every**
  board. Drag cards into it from any board (or back out), so anything you want to keep at
  hand follows you as you switch boards. The Slack, Gmail, Calendar and Weather panels float
  over it when opened.

## Install (unpacked)

1. Open `chrome://extensions`, turn on **Developer mode**.
2. Click **Load unpacked** and pick the `dev-cockpit` folder.
3. Click the toolbar icon — the full page opens in a new tab.

The extension uses a fixed ID: **`aiegllbeihjbphiilgeifggceklfffkn`**.

## Weather

Open settings (gear) → Weather → type a city, or click **Use my location**. Data comes
from Open-Meteo (no API key). It refreshes every 30 minutes.

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
7. Reload the extension at `chrome://extensions`, then in settings → Google Calendar →
   **Connect** and approve the read-only access.

Scopes requested are `calendar.readonly` and `gmail.metadata` — each is requested only
when you connect that feature, so connecting Calendar won't prompt for Gmail (or vice
versa). Until this is set up, the Calendar and Gmail pills just show a "connect in
settings" hint and the rest of the extension works normally.

## Gmail unread (optional)

The Gmail pill — to the right of the Slack badge — shows your **inbox unread count**. It
reuses the same Google OAuth client as Calendar (see above) but requests only the
read-only `gmail.metadata` scope, which exposes label counts and never message contents.

After the Google client is configured, open settings (gear) → **Gmail unread** →
**Connect** and approve. The count refreshes every couple of minutes while the tab is
open; click the pill for the unread message/thread breakdown and a link to open Gmail.
Tick **Desktop alerts for new Gmail** to be notified when the unread count climbs.

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

Then in DevCockpit: settings (gear) → **Slack unread** → paste the workspace URL, token, and
cookie → **Connect**. The pill updates within a couple of minutes and refreshes every ~2 min.

> ⚠️ This is an **unofficial** method. The tokens grant **full access to your Slack account**,
> they **reset when you log out** of Slack web (just re-paste), and they're stored only in this
> device's local extension storage. Enterprise Grid workspaces use a different endpoint and may
> not work. Use **Clear** in settings to remove the credentials and the `d` cookie.

## Backup & restore

Your boards live in this device's local extension storage, so the extension keeps
backups for you. Open settings (gear) → **Backup & restore**:

- **Download backup** writes a `devcockpit-backup-YYYY-MM-DD.json` to your Downloads —
  a snapshot of all boards and settings you can keep or move to another machine.
- **Restore from file…** reads one back. It validates the file first, asks you to
  confirm, and snapshots your current state before overwriting so a restore is undoable.
- **Auto-save a daily backup to Downloads** (on by default) writes that same file
  automatically once a day, but only when something has changed — one file per day.
- **Recent snapshots** — a rolling history (last 10) is captured automatically a couple
  of minutes after you make changes, kept inside the extension. Hit **Restore** on any
  snapshot to roll back an accidental delete or edit.

Backups contain **boards and settings only**. Slack and Google Calendar credentials are
never written to a backup file or snapshot — after a restore on a new machine you just
reconnect them once, as in first-time setup.

## How it works

- `background.js` (service worker) owns phase transitions, the toolbar badge, the chime
  and notifications via `chrome.alarms` — so they fire on time even with no tab open. It
  also polls Slack unread counts in the background.
- `slack.js` is the Slack `client.counts` reader (fetch + parse), imported by the worker.
- `app.html` / `app.js` / `app.css` is the full-page UI (timer, board, calendar, weather,
  Slack, Gmail). The Gmail inbox unread count is read app-side from the Gmail API
  `users.labels.get` (INBOX) using the `gmail.metadata` scope.
- `offscreen.html` / `offscreen.js` plays the chime when no tab is open.
- Storage is `chrome.storage.local` (this device only). `backup.js` defines the shared
  JSON backup format; the service worker takes rolling snapshots and the daily file
  export, and the settings panel offers manual download/restore (see **Backup & restore**).
