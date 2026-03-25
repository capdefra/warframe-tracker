# Warframe Tracker

A collection tracker for Warframe — track ownership, mastery, and upgrades for every warframe, weapon, and companion in the game.

**Live:** [https://capdefra.github.io/warframe-tracker/](https://capdefra.github.io/warframe-tracker/)

## Features

- **Track ownership & mastery** for 580+ items across warframes, weapons, and companions
- **Dashboard** with live stats — owned/total counts, mastery percentage, and a progress bar
- **Context menu (⋮)** on each card with item-specific actions:
  - **Feed to Helminth** (warframes only) — marks a warframe as subsumed and clears all upgrades
  - **Orokin Reactor / Catalyst** — toggle whether the item has a reactor (warframes/companions) or catalyst (weapons) installed
  - **Exilus Adapter** — toggle exilus adapter installation (warframes and weapons)
  - **Forma counter** — track how many forma have been applied with +/- buttons or direct input
- **Smart flags** on cards:
  - *Prime Available* — highlights base items whose Prime variant you don't own yet
  - *Feed to Helminth* — shows when a base warframe is owned, mastered, and its Prime is also owned
  - *Subsumed* — marks warframes that have been fed to the Helminth
- **Filters & sorting** — search by name, filter by subcategory/type, ownership status, special conditions (Prime Available, Feed to Helminth), and sort by name, release date, mastery rank, or status
- **Prime / Variant toggle** — quickly filter to show only Prime and variant items
- **Bulk actions** — mark all filtered items as owned, mastered, or reset them
- **Stats modal** with detailed breakdown including mastery streak, weekly/monthly mastered counts, and highest MR item owned
- **Share snapshot** — copy a formatted text summary of your progress to the clipboard
- **Export / Import** — save your progress as a JSON file and restore it later
- **GitHub Gist sync** — sync progress across devices via a private GitHub Gist. Gist is always authoritative on load to prevent stale local data from overwriting newer remote changes. Debounced push (1.5s) on every local change.
- **Persistent state** — all data is saved to `localStorage`, including filter and sort preferences

## Tech Stack

- **Vanilla JavaScript** with ES modules (`<script type="module">`)
- **No build step, no dependencies** — pure HTML, CSS, and JS
- **localStorage** for persistence, with optional **GitHub Gist** sync via the GitHub API
- **GitHub Pages** for hosting via GitHub Actions

## Project Structure

```
warframe-tracker/
├── index.html              # Single-page HTML shell
├── app.js                  # Main application logic (rendering, events, menus)
├── data.js                 # Data layer (localStorage CRUD, stats, Gist sync orchestration)
├── gist.js                 # GitHub Gist API layer (token, load, save, validate)
├── style.css               # Full dark-theme styling
├── warframe_tracker.json   # Item catalog (580+ items with metadata)
└── .github/
    └── workflows/
        └── pages.yml       # GitHub Actions deployment to GitHub Pages
```

### Key Files

- **`warframe_tracker.json`** — the complete item catalog. Each entry has:
  - `id`, `name`, `category` (warframe/weapon/companion), `subcategory`, `variant` (Prime, Wraith, etc.)
  - `mastery_rank`, `release_date`, `wiki_url`, `has_prime`

- **`data.js`** — all state management and Gist sync orchestration. Exports functions like `toggleOwned`, `toggleMastered`, `subsume`, `setForma`, `toggleReactor`, `toggleExilus`, `bulkUpdate`, `computeStats`, sync functions (`initSync`, `firstConnect`, `forceSync`, `forcePush`), and import/export utilities. State is stored in `localStorage` under the key `wf_tracker_v1`, with debounced push to Gist on every change.

- **`gist.js`** — GitHub Gist API layer. Handles token storage, Gist discovery/creation, reading/writing data, and token validation. Uses a private Gist with the file `warframe-tracker-data.json`.

- **`app.js`** — handles rendering, filtering, sorting, event delegation, the context menu, the stats modal, share/export/import flows, and the Gist sync UI (connect/disconnect, pull/push buttons, status indicator). UI state (active tab, filters, sort order) is persisted separately under `wf_tracker_ui`.

## Running Locally

No build step required. Serve the directory with any static file server:

```bash
npx serve -s .
```

Then open `http://localhost:3000` in your browser.

## Deployment

Pushes to `main` trigger a GitHub Actions workflow (`.github/workflows/pages.yml`) that deploys the entire repo as a static site to GitHub Pages.
