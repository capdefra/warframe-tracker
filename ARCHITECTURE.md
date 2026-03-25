# Architecture

## Tech Stack and Dependencies

| Layer | Technology |
|-------|-----------|
| Language | Vanilla JavaScript (ES2020+) |
| Modules | Native ES modules (`<script type="module">`) |
| Styling | Plain CSS with custom properties |
| Storage | `localStorage` + optional GitHub Gist sync |
| Sync | GitHub Gist API (private gist, PAT with `gist` scope) |
| Hosting | GitHub Pages via GitHub Actions |
| Dependencies | **None** — zero npm packages, no build step |

The app runs entirely in the browser. There is no bundler, transpiler, or framework. The HTML file loads `app.js` as a module, which imports from `data.js` and `gist.js`.

---

## Project File Structure

```
warframe-tracker/
├── index.html                  # Single HTML shell — all sections, modals, and the shared card menu
├── app.js                      # Rendering, event handling, filtering, sorting, menus, sync UI (≈800 lines)
├── data.js                     # State management, localStorage CRUD, Gist sync orchestration, stats (≈375 lines)
├── gist.js                     # GitHub Gist API layer — token, load, save, validate (≈115 lines)
├── style.css                   # Dark theme, responsive grid, all component styles (≈600 lines)
├── warframe_tracker.json       # Static item catalog (580+ entries)
├── README.md                   # Project overview
├── ARCHITECTURE.md             # This file
├── .github/
│   └── workflows/
│       └── pages.yml           # GitHub Actions: deploy to GitHub Pages on push to main
└── .claude/
    └── launch.json             # Dev server config for local preview
```

---

## App Navigation and Tab System

The app is a single-page application with three category tabs:

```
┌──────────────────────────────────────────────────┐
│  Header (sync indicator, stats, share, export, import, reset) │
├──────────────────────────────────────────────────┤
│  Dashboard (sticky — live owned/mastered counts + progress bar) │
├──────────────────────────────────────────────────┤
│  Tabs: [ Warframes | Weapons | Companions ]      │
├──────────────────────────────────────────────────┤
│  Filters (search, subcategory, status, prime, sort) │
├──────────────────────────────────────────────────┤
│  Bulk Actions (toggle panel)                      │
├──────────────────────────────────────────────────┤
│  Card Grid (responsive auto-fill grid)            │
└──────────────────────────────────────────────────┘
```

- **Tab switching** sets `activeTab` to `"warframe"`, `"weapon"`, or `"companion"`, resets the subcategory filter, and re-renders cards.
- The active tab, all filter values, and sort order are persisted to `localStorage` under key `wf_tracker_ui` so the user returns to exactly where they left off.

---

## Data Flow

### Initialization

```
DOMContentLoaded
  → loadCatalog()          Fetches warframe_tracker.json, caches in memory
  → buildPrimeIndex()      Builds a Set of base item IDs that have a Prime variant
  → initSync()             If Gist token exists: pull from Gist → replace localStorage (Gist is authoritative)
  → loadUIState()          Restores activeTab, filters, sortBy from localStorage
  → renderDashboard()      Computes stats and renders the sticky dashboard
  → renderTabs() / updateSubcategoryOptions() / applyFiltersToUI()
  → renderCards()           Filters, sorts, and renders the card grid
  → attachEvents()          Sets up all event delegation
  → initSyncUI()           Wires up sync indicator and modal
```

### User Interaction Flow

```
User clicks "Owned" button on a card
  → Event delegation catches [data-action="owned"] click
  → toggleOwned(itemId)    Reads state from localStorage, flips owned, saves back
  →   save() writes to localStorage AND triggers debouncedGistSave() (1.5s debounce)
  → updateSingleCard()     Surgically updates that one card's DOM (no full re-render)
  → updateRelatedCards()   If a Prime was toggled, updates the base card's flags
  → renderDashboard()      Refreshes the sticky stats bar
```

### Storage

Four `localStorage` keys are used:

| Key | Purpose | Shape |
|-----|---------|-------|
| `wf_tracker_v1` | Item progress data | `{ items: { [itemId]: { owned, mastered, mastered_at, subsumed, forma, reactor, exilus } }, version: 1 }` |
| `wf_tracker_ui` | UI preferences | `{ activeTab, filters: { search, subcategory, status, primeOnly }, sortBy }` |
| `wf_tracker_gh_token` | GitHub PAT for Gist sync | Plain string (`ghp_...`) |
| `wf_tracker_gist_id` | Cached Gist ID | Plain string (hex) |

### Export / Import

- **Export** serializes the full `wf_tracker_v1` state to a JSON file (`wf_progress_YYYY-MM-DD.json`) downloaded via a Blob URL.
- **Import** reads a JSON file, validates it has an `items` object, and merges entries into the existing state (additive, does not clear unmentioned items).

### Gist Sync

The Gist sync layer provides cross-device progress sharing via a private GitHub Gist.

**Design principle: Gist is always authoritative.** On every app load, if a token is configured, the app pulls from the Gist and replaces local state. This prevents stale local caches on other devices from overwriting newer remote data.

```
┌─────────────────────────────────────────────────────────┐
│  App Load (token exists)                                │
│    → Pull from Gist → Replace localStorage              │
│    → Gist wins. Local cache is just a write-through.    │
├─────────────────────────────────────────────────────────┤
│  User makes a change                                    │
│    → save() writes to localStorage immediately          │
│    → debouncedGistSave() pushes to Gist after 1.5s     │
├─────────────────────────────────────────────────────────┤
│  First connect (new device)                             │
│    → Pull from Gist first                               │
│    → If Gist has data → use it (don't overwrite)        │
│    → If Gist is empty → push local data to it           │
└─────────────────────────────────────────────────────────┘
```

**Gist structure:** A single private Gist containing one file (`warframe-tracker-data.json`) with the same shape as `wf_tracker_v1`. The Gist is auto-discovered by filename or created on first connect.

**Status indicator:** The header shows a sync status button (`idle`, `syncing`, `synced`, `error`) that opens a modal with Pull/Push/Disconnect controls.

---

## Component Responsibilities

### `index.html`
The static HTML shell. Contains:
- Header with sync indicator and action buttons
- Dashboard container (populated by JS)
- Tab navigation
- Filter bar with search, dropdowns, and checkbox
- Bulk actions panel (hidden by default)
- Card grid container
- Stats modal
- Sync modal (connect token / pull / push / disconnect)
- Shared card context menu (`#card-menu`) — a single `<div>` repositioned on each ⋮ click
- Toast notification
- Hidden file input for import

### `app.js` — Rendering & Interaction

| Function | Responsibility |
|----------|---------------|
| `init()` | Boot sequence — load data, sync from Gist, restore UI, render, attach events |
| `renderDashboard()` | Computes stats and updates the sticky dashboard bar |
| `renderCards()` | Full re-render of the card grid (used on tab/filter changes) |
| `updateSingleCard(id)` | Surgical DOM update for one card (used after toggle clicks) |
| `updateCardFlags(el, item, state)` | Rebuilds the flag section (Subsumed, Prime Available, Feed to Helminth) |
| `updateRelatedCards(id)` | When toggling a Prime, refreshes the base card's flags |
| `getFilteredItems()` | Applies all active filters and sort order, returns matching items |
| `openCardMenu(id, anchor)` | Populates and positions the shared context menu |
| `closeCardMenu()` | Hides the menu and clears the tracked item ID |
| `renderStatsModal()` | Fills the stats modal with detailed mastery breakdown |
| `generateShareText()` | Produces a formatted text snapshot for clipboard sharing |
| `showToast(msg)` | Displays a temporary notification at the bottom of the screen |
| `initSyncUI()` | Wires up the sync indicator button and modal open/close |
| `updateSyncIndicator(status)` | Updates the header sync badge text and color class |
| `renderSyncModal()` | Renders the sync modal — connect form (no token) or status/actions (token exists) |

### `gist.js` — GitHub Gist API Layer

| Function | Responsibility |
|----------|---------------|
| `getToken()` / `setToken(token)` | Read/write the GitHub PAT from localStorage |
| `clearSync()` | Removes both the token and cached Gist ID from localStorage |
| `getGistId()` | Returns the cached Gist ID |
| `ensureGist(token)` | Finds an existing Gist by cached ID or filename search, or creates a new private Gist |
| `loadFromGist(token)` | Fetches the Gist and parses the JSON content |
| `saveToGist(token, data)` | Patches the Gist with updated JSON content |
| `validateToken(token)` | Validates a PAT by calling `/user` and returns the login name or null |

### `data.js` — State Management & Sync Orchestration

| Function | Responsibility |
|----------|---------------|
| `loadCatalog()` | Fetches and caches `warframe_tracker.json` |
| `getUserState()` | Reads the full state object from localStorage |
| `getItemState(id)` | Returns a single item's state merged with defaults |
| `toggleOwned(id)` | Flips the `owned` boolean |
| `toggleMastered(id)` | Flips `mastered` and sets/clears `mastered_at` timestamp |
| `subsume(id)` | Sets `owned=false, subsumed=true` and clears forma, reactor, exilus |
| `setForma(id, count)` | Sets the forma count (clamped to 0+) |
| `toggleReactor(id)` | Flips the `reactor` boolean |
| `toggleExilus(id)` | Flips the `exilus` boolean |
| `bulkUpdate(ids, field, value)` | Batch-updates owned/mastered/reset for an array of item IDs |
| `computeStats(catalog)` | Calculates per-category counts, deduped family counts, mastery streak, weekly/monthly mastered, and highest MR owned item |
| `exportData()` | Serializes state to JSON string |
| `importData(json)` | Parses and merges imported JSON into existing state |
| `resetAllData()` | Removes the localStorage key entirely |
| `initSync()` | On startup: if token exists, pull from Gist and replace localStorage |
| `firstConnect()` | On first token entry: pull Gist first; only push local if Gist is empty |
| `forceSync()` | Manual pull: replace localStorage with Gist data |
| `forcePush()` | Manual push: overwrite Gist with current localStorage |
| `onSyncStatus(fn)` | Register a listener for sync status changes |
| `getSyncStatus()` | Returns current sync status (`idle`, `syncing`, `synced`, `error`, `offline`) |

### `style.css` — Theming & Layout

- Dark theme defined via CSS custom properties on `:root`
- Card grid uses `auto-fill` with `minmax(280px, 1fr)` for responsive columns
- Card states (`.owned`, `.mastered`) change border color and background
- Variant badges (`.badge-Prime`, `.badge-Kuva`, etc.) use distinct color palettes
- Context menu (`.card-menu`) uses `position: fixed` and is repositioned via JS
- Sync indicator (`.sync-indicator`) with color-coded states: `.sync-synced` (green), `.sync-syncing` (blue), `.sync-error` (red), `.sync-offline` (grey)
- Sync modal reuses `.modal` / `.stats-body` patterns from the stats modal
- Responsive breakpoints at 768px (single column, smaller padding) and 480px (icon-only header buttons)

---

## Static Game Data File

### `warframe_tracker.json`

A flat JSON array of 580+ item objects. Each entry has this shape:

```json
{
  "id": "ash",
  "name": "Ash",
  "category": "warframe",
  "subcategory": "Warframe",
  "variant": null,
  "mastery_rank": 0,
  "release_date": "2012-11-01",
  "wiki_url": "https://warframe.fandom.com/wiki/Ash",
  "has_prime": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique kebab-case identifier (e.g. `"ash-prime"`, `"braton-vandal"`) |
| `name` | string | Display name |
| `category` | string | One of `"warframe"`, `"weapon"`, `"companion"` |
| `subcategory` | string | Finer type — e.g. `"Rifle"`, `"Shotgun"`, `"Sentinel"`, `"Warframe"` |
| `variant` | string \| null | `"Prime"`, `"Wraith"`, `"Kuva"`, `"Tenet"`, etc., or `null` for base items |
| `mastery_rank` | number | Minimum mastery rank required (0–16) |
| `release_date` | string | ISO date (`"YYYY-MM-DD"`) |
| `wiki_url` | string | Link to the Warframe Wiki page |
| `has_prime` | boolean | `true` if this base item has a released Prime variant |

**Conventions:**
- Prime variants have `id` = `"{base-id}-prime"` (e.g. `ash` → `ash-prime`)
- `has_prime` is only `true` on the **base** item, never on the Prime itself
- Items are ordered by category groups (warframes first, then weapons, then companions), alphabetically within each group

---

## Utility Functions

### Parser / Catalog

- `loadCatalog()` — one-shot fetch of the JSON file, cached in a module-level `_catalog` variable. Subsequent calls return the cached reference.
- `buildPrimeIndex()` — scans the catalog for items with `has_prime === true` and populates a `Set<string>` of base IDs. Used for Prime Available and Feed to Helminth flag logic.

### Storage

- `getUserState()` / `save(state)` — read/write the full state object from/to `localStorage`. Every mutation function calls `getUserState()`, modifies the result, then calls `save()`. `save()` also triggers a debounced Gist push if a token is configured.
- `getItemState(id)` — spreads `DEFAULT_ITEM` with the stored item to fill in missing fields. This makes the schema forward-compatible: new fields added to `DEFAULT_ITEM` automatically apply to old saved data.
- `debouncedGistSave(state)` — called by `save()`. Waits 1.5s after the last change before pushing to Gist, so rapid toggles don't flood the API.

### Gist Sync

- `ensureGist(token)` — finds the Gist by cached ID, then by filename scan across user's gists, then creates a new private one. Caches the Gist ID in localStorage.
- `loadFromGist(token)` / `saveToGist(token, data)` — thin wrappers around the GitHub Gist API. Load parses the JSON file content; save patches it.
- `validateToken(token)` — calls `GET /user` to verify the PAT is valid and has the `gist` scope.

### Stats

- `computeStats(catalog)` — a single function that computes everything the dashboard and stats modal need:
  - Per-category owned/mastered/total counts
  - Deduplicated family counts (base + Prime = 1 family)
  - Overall mastery percentage
  - Mastered this week / this month
  - Mastery streak (consecutive days with at least one mastery)
  - Highest MR item currently owned

---

## Development and Deployment Commands

### Local Development

```bash
# Serve the project directory (any static file server works)
npx serve -s .

# Or use Python
python3 -m http.server 8000
```

No build step, no compilation, no `npm install`.

### Deployment

Deployment is automatic. Pushing to `main` triggers the GitHub Actions workflow:

```yaml
# .github/workflows/pages.yml
- actions/checkout@v4
- actions/configure-pages@v5
- actions/upload-pages-artifact@v3  (uploads the entire repo root)
- actions/deploy-pages@v4
```

The workflow uploads the repo as-is (no build) and deploys to GitHub Pages.

---

## Recurring Code Patterns and Conventions

### Event Delegation
All card interactions use a single `click` listener on `#card-grid` that checks `e.target.closest('[data-action]')` or `e.target.closest('[data-menu]')`. This avoids attaching listeners to 500+ individual buttons and handles dynamically rendered cards.

### Surgical DOM Updates
After a toggle click, `updateSingleCard(id)` modifies only the affected card's DOM nodes (class list, button text, badges, flags) instead of calling `renderCards()` to re-render the entire grid. Full re-renders only happen on tab switches or filter changes.

### Shared Singleton Menu
The card context menu is a single `<div id="card-menu">` in the DOM. On each ⋮ click, `openCardMenu()` populates it with the relevant actions for that item (category-aware), positions it near the button, and shows it. This avoids creating 500+ hidden dropdowns.

### Default Spread Pattern
Every state mutation reads the stored item and spreads it over `DEFAULT_ITEM`:
```js
const cur = { ...DEFAULT_ITEM, ...state.items[itemId] };
```
This ensures new fields (like `exilus`, `reactor`) are initialized to their defaults even for items saved before those fields existed.

### Category-Aware Labels
The context menu adjusts labels based on `item.category`:
- Warframes/Companions → "Orokin Reactor"
- Weapons → "Orokin Catalyst"
- Exilus Adapter → warframes and weapons only (not companions)
- Feed to Helminth → warframes only

### CSS Custom Properties
All colors are defined as CSS variables on `:root`, making the theme easy to modify:
- `--bg-primary`, `--bg-card`, `--bg-card-owned`, `--bg-card-mastered` for backgrounds
- `--accent-gold` (mastered/primary accent), `--accent-teal` (owned accent)
- `--text-primary`, `--text-secondary` for typography

### State Shape Stability
The localStorage schema uses a `version` field and `importData()` validates incoming data before merging. New fields are always optional with defaults, so old exports remain importable.

### Gist-Authoritative Sync
The sync layer follows a "pull-first, push-on-change" pattern. On load, the Gist always replaces local state — localStorage is treated as a write-through cache. On first connect from a new device, the app pulls from Gist first and only pushes if the Gist is empty, preventing an empty local cache from overwriting existing remote progress. Every `save()` call triggers a debounced push (1.5s) so changes propagate without flooding the API.

### Observable Sync Status
Sync status is managed via a simple listener pattern (`onSyncStatus(fn)`). The UI registers a listener at init that updates the header indicator whenever status changes between `idle`, `syncing`, `synced`, `error`, and `offline`.
