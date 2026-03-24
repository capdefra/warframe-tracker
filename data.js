import { getToken, loadFromGist, saveToGist } from './gist.js';

const STORAGE_KEY = 'wf_tracker_v1';
let _catalog = null;

// ── Gist sync state ──
let _syncStatus = 'idle'; // 'idle' | 'syncing' | 'synced' | 'error' | 'offline'
let _syncTimeout = null;
let _syncListeners = [];
const DEBOUNCE_MS = 1500;

export function onSyncStatus(fn) {
  _syncListeners.push(fn);
  return () => { _syncListeners = _syncListeners.filter(f => f !== fn); };
}

export function getSyncStatus() {
  return _syncStatus;
}

function setSyncStatus(status) {
  _syncStatus = status;
  for (const fn of _syncListeners) fn(status);
}

export async function loadCatalog() {
  if (_catalog) return _catalog;
  const res = await fetch('warframe_tracker.json');
  _catalog = await res.json();
  return _catalog;
}

// ── Pull from Gist on startup (Gist wins) ──
export async function initSync() {
  const token = getToken();
  if (!token) {
    setSyncStatus('offline');
    return;
  }

  setSyncStatus('syncing');
  try {
    const remote = await loadFromGist(token);
    // Gist is authoritative — replace local with remote
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
    setSyncStatus('synced');
  } catch {
    setSyncStatus('error');
  }
}

// ── Force sync: pull from Gist then push merged result ──
export async function forceSync() {
  const token = getToken();
  if (!token) return;

  setSyncStatus('syncing');
  try {
    const remote = await loadFromGist(token);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
    setSyncStatus('synced');
  } catch {
    setSyncStatus('error');
  }
}

// ── Force push: overwrite Gist with current local state ──
export async function forcePush() {
  const token = getToken();
  if (!token) return;

  setSyncStatus('syncing');
  try {
    const state = getUserState();
    await saveToGist(token, state);
    setSyncStatus('synced');
  } catch {
    setSyncStatus('error');
  }
}

export function getUserState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const state = JSON.parse(raw);
      if (state && state.items) return state;
    }
  } catch {}
  return { items: {}, version: 1 };
}

function save(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  debouncedGistSave(state);
}

// ── Debounced Gist push ──
function debouncedGistSave(state) {
  const token = getToken();
  if (!token) return;

  if (_syncTimeout) clearTimeout(_syncTimeout);
  _syncTimeout = setTimeout(async () => {
    setSyncStatus('syncing');
    try {
      await saveToGist(token, state);
      setSyncStatus('synced');
    } catch {
      setSyncStatus('error');
    }
  }, DEBOUNCE_MS);
}

const DEFAULT_ITEM = { owned: false, mastered: false, mastered_at: null, subsumed: false, forma: 0, reactor: false, exilus: false };

export function getItemState(itemId) {
  const state = getUserState();
  return { ...DEFAULT_ITEM, ...state.items[itemId] };
}

export function toggleOwned(itemId) {
  const state = getUserState();
  const cur = state.items[itemId] || { owned: false, mastered: false, mastered_at: null };
  cur.owned = !cur.owned;
  state.items[itemId] = cur;
  save(state);
  return cur;
}

export function toggleMastered(itemId) {
  const state = getUserState();
  const cur = state.items[itemId] || { owned: false, mastered: false, mastered_at: null };
  cur.mastered = !cur.mastered;
  if (cur.mastered) {
    cur.mastered_at = new Date().toISOString();
  } else {
    cur.mastered_at = null;
  }
  state.items[itemId] = cur;
  save(state);
  return cur;
}

export function subsume(itemId) {
  const state = getUserState();
  const cur = { ...DEFAULT_ITEM, ...state.items[itemId] };
  cur.owned = false;
  cur.subsumed = true;
  cur.forma = 0;
  cur.reactor = false;
  cur.exilus = false;
  state.items[itemId] = cur;
  save(state);
  return cur;
}

export function setForma(itemId, count) {
  const state = getUserState();
  const cur = { ...DEFAULT_ITEM, ...state.items[itemId] };
  cur.forma = Math.max(0, Math.floor(count));
  state.items[itemId] = cur;
  save(state);
  return cur;
}

export function toggleExilus(itemId) {
  const state = getUserState();
  const cur = { ...DEFAULT_ITEM, ...state.items[itemId] };
  cur.exilus = !cur.exilus;
  state.items[itemId] = cur;
  save(state);
  return cur;
}

export function toggleReactor(itemId) {
  const state = getUserState();
  const cur = { ...DEFAULT_ITEM, ...state.items[itemId] };
  cur.reactor = !cur.reactor;
  state.items[itemId] = cur;
  save(state);
  return cur;
}

export function bulkUpdate(itemIds, field, value) {
  const state = getUserState();
  for (const id of itemIds) {
    const cur = state.items[id] || { owned: false, mastered: false, mastered_at: null };
    if (field === 'owned') {
      cur.owned = value;
    } else if (field === 'mastered') {
      cur.mastered = value;
      if (value) {
        if (!cur.mastered_at) cur.mastered_at = new Date().toISOString();
      } else {
        cur.mastered_at = null;
      }
    } else if (field === 'reset') {
      cur.owned = false;
      cur.mastered = false;
      cur.mastered_at = null;
    }
    state.items[id] = cur;
  }
  save(state);
}

export function exportData() {
  const state = getUserState();
  state.exported_at = new Date().toISOString();
  return JSON.stringify(state, null, 2);
}

export function importData(jsonString) {
  const data = JSON.parse(jsonString);
  if (!data || typeof data.items !== 'object') {
    throw new Error('Invalid format: missing "items" object');
  }
  // Merge into existing state
  const state = getUserState();
  for (const [id, val] of Object.entries(data.items)) {
    if (val && typeof val.owned === 'boolean') {
      state.items[id] = {
        owned: !!val.owned,
        mastered: !!val.mastered,
        mastered_at: val.mastered_at || null,
        subsumed: !!val.subsumed,
        forma: val.forma || 0,
        reactor: !!val.reactor,
        exilus: !!val.exilus,
      };
    }
  }
  save(state);
}

export function resetAllData() {
  localStorage.removeItem(STORAGE_KEY);
}

export function computeStats(catalog) {
  const state = getUserState();
  const byCategory = {};
  for (const cat of ['warframe', 'weapon', 'companion']) {
    const items = catalog.filter(i => i.category === cat);
    let owned = 0, mastered = 0;
    for (const item of items) {
      const s = state.items[item.id];
      if (s) {
        if (s.owned) owned++;
        if (s.mastered) mastered++;
      }
    }
    byCategory[cat] = { total: items.length, owned, mastered };
  }

  // Deduplicated family stats (base + Prime = 1 family)
  const allIds = new Set(catalog.map(i => i.id));
  const dedupByCategory = {};
  for (const cat of ['warframe', 'weapon', 'companion']) {
    const items = catalog.filter(i => i.category === cat);
    const families = new Map();
    for (const item of items) {
      if (item.variant === 'Prime' && item.id.endsWith('-prime')) {
        const baseId = item.id.slice(0, -6);
        if (allIds.has(baseId)) {
          if (!families.has(baseId)) families.set(baseId, [baseId]);
          families.get(baseId).push(item.id);
        } else {
          families.set(item.id, [item.id]);
        }
      } else if (!item.variant) {
        if (!families.has(item.id)) families.set(item.id, [item.id]);
      } else {
        families.set(item.id, [item.id]);
      }
    }
    let ownedFamilies = 0;
    for (const [, ids] of families) {
      if (ids.some(id => { const s = state.items[id]; return s && s.owned; })) ownedFamilies++;
    }
    dedupByCategory[cat] = { totalFamilies: families.size, ownedFamilies };
  }

  const overallTotal = catalog.length;
  const overallOwned = Object.values(byCategory).reduce((s, c) => s + c.owned, 0);
  const overallMastered = Object.values(byCategory).reduce((s, c) => s + c.mastered, 0);
  const overallFamilies = Object.values(dedupByCategory).reduce((s, c) => s + c.totalFamilies, 0);
  const overallFamiliesOwned = Object.values(dedupByCategory).reduce((s, c) => s + c.ownedFamilies, 0);

  // Mastered this week/month
  const now = new Date();
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(now); monthAgo.setMonth(monthAgo.getMonth() - 1);
  let masteredThisWeek = 0, masteredThisMonth = 0;
  const masteryDates = [];

  for (const val of Object.values(state.items)) {
    if (val.mastered && val.mastered_at) {
      const d = new Date(val.mastered_at);
      if (d >= weekAgo) masteredThisWeek++;
      if (d >= monthAgo) masteredThisMonth++;
      masteryDates.push(d);
    }
  }

  // Mastery streak: consecutive days ending today with at least 1 mastery
  let streak = 0;
  if (masteryDates.length > 0) {
    const daySet = new Set(masteryDates.map(d =>
      `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    ));
    const check = new Date(now);
    while (true) {
      const key = `${check.getFullYear()}-${check.getMonth()}-${check.getDate()}`;
      if (daySet.has(key)) {
        streak++;
        check.setDate(check.getDate() - 1);
      } else {
        break;
      }
    }
  }

  // Rarest owned: highest MR weapon or newest warframe
  let rarestOwned = null;
  let highestMR = -1;
  for (const item of catalog) {
    const s = state.items[item.id];
    if (s && s.owned && item.mastery_rank > highestMR) {
      highestMR = item.mastery_rank;
      rarestOwned = item;
    }
  }

  return {
    byCategory,
    dedupByCategory,
    overallTotal,
    overallOwned,
    overallMastered,
    overallFamilies,
    overallFamiliesOwned,
    masteryPercent: overallTotal ? ((overallMastered / overallTotal) * 100).toFixed(1) : '0.0',
    masteredThisWeek,
    masteredThisMonth,
    streak,
    rarestOwned,
  };
}
