import {
  loadCatalog, getUserState, getItemState,
  toggleOwned, toggleMastered, bulkUpdate,
  exportData, importData, resetAllData, computeStats
} from './data.js';

let catalog = [];
let activeTab = 'warframe';
let filters = { search: '', subcategory: 'all', status: 'all', primeOnly: false };
let sortBy = 'alpha-asc';

// ── DOM refs ──
const $ = id => document.getElementById(id);
const dashboardEl = $('dashboard');
const cardGrid = $('card-grid');
const searchEl = $('search');
const subcatEl = $('filter-subcategory');
const statusEl = $('filter-status');
const primeEl = $('filter-prime');
const sortEl = $('sort-by');
const itemCountEl = $('item-count');

// ── Init ──
async function init() {
  catalog = await loadCatalog();
  loadUIState();
  renderDashboard();
  renderTabs();
  updateSubcategoryOptions();
  applyFiltersToUI();
  renderCards();
  attachEvents();
}

function loadUIState() {
  try {
    const raw = localStorage.getItem('wf_tracker_ui');
    if (raw) {
      const ui = JSON.parse(raw);
      if (ui.activeTab) activeTab = ui.activeTab;
      if (ui.filters) Object.assign(filters, ui.filters);
      if (ui.sortBy) sortBy = ui.sortBy;
    }
  } catch {}
}

function saveUIState() {
  localStorage.setItem('wf_tracker_ui', JSON.stringify({ activeTab, filters, sortBy }));
}

// ── Dashboard ──
function renderDashboard() {
  const stats = computeStats(catalog);
  const { byCategory: bc, overallMastered, overallTotal, masteryPercent } = stats;
  const pct = overallTotal ? (overallMastered / overallTotal * 100) : 0;

  dashboardEl.innerHTML = `
    <span class="dash-stat">
      <strong>Warframes</strong>
      <span class="teal">${bc.warframe.owned}/${bc.warframe.total}</span> owned &middot;
      <span class="gold">${bc.warframe.mastered}</span> mastered
    </span>
    <span class="dash-stat">
      <strong>Weapons</strong>
      <span class="teal">${bc.weapon.owned}/${bc.weapon.total}</span> owned &middot;
      <span class="gold">${bc.weapon.mastered}</span> mastered
    </span>
    <span class="dash-stat">
      <strong>Companions</strong>
      <span class="teal">${bc.companion.owned}/${bc.companion.total}</span> owned &middot;
      <span class="gold">${bc.companion.mastered}</span> mastered
    </span>
    <div class="dash-bar-wrap">
      <div class="dash-bar"><div class="dash-bar-fill" style="width:${pct}%"></div></div>
      <span class="dash-bar-label">${overallMastered}/${overallTotal} (${masteryPercent}%)</span>
    </div>
  `;
}

// ── Tabs ──
function renderTabs() {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === activeTab);
  });
}

function updateSubcategoryOptions() {
  const items = catalog.filter(i => i.category === activeTab);
  const subs = [...new Set(items.map(i => i.subcategory))].sort();
  subcatEl.innerHTML = '<option value="all">All Types</option>' +
    subs.map(s => `<option value="${s}" ${filters.subcategory === s ? 'selected' : ''}>${s}</option>`).join('');
}

function applyFiltersToUI() {
  searchEl.value = filters.search;
  statusEl.value = filters.status;
  primeEl.checked = filters.primeOnly;
  sortEl.value = sortBy;
}

// ── Filtering & Sorting ──
function getFilteredItems() {
  const state = getUserState();
  let items = catalog.filter(i => i.category === activeTab);

  if (filters.search) {
    const q = filters.search.toLowerCase();
    items = items.filter(i => i.name.toLowerCase().includes(q));
  }
  if (filters.subcategory !== 'all') {
    items = items.filter(i => i.subcategory === filters.subcategory);
  }
  if (filters.primeOnly) {
    items = items.filter(i => i.variant);
  }
  if (filters.status !== 'all') {
    items = items.filter(i => {
      const s = state.items[i.id] || { owned: false, mastered: false };
      if (filters.status === 'unowned') return !s.owned;
      if (filters.status === 'owned-not-mastered') return s.owned && !s.mastered;
      if (filters.status === 'mastered') return s.mastered;
      return true;
    });
  }

  // Sort
  const st = state.items;
  items.sort((a, b) => {
    switch (sortBy) {
      case 'alpha-asc': return a.name.localeCompare(b.name);
      case 'alpha-desc': return b.name.localeCompare(a.name);
      case 'release-desc': return b.release_date.localeCompare(a.release_date);
      case 'release-asc': return a.release_date.localeCompare(b.release_date);
      case 'mr-asc': return a.mastery_rank - b.mastery_rank;
      case 'mr-desc': return b.mastery_rank - a.mastery_rank;
      case 'status': {
        const sa = st[a.id], sb = st[b.id];
        const va = sa ? (sa.mastered ? 2 : sa.owned ? 1 : 0) : 0;
        const vb = sb ? (sb.mastered ? 2 : sb.owned ? 1 : 0) : 0;
        return va - vb || a.name.localeCompare(b.name);
      }
      default: return 0;
    }
  });

  return items;
}

// ── Render Cards ──
function renderCards() {
  const items = getFilteredItems();
  const total = catalog.filter(i => i.category === activeTab).length;
  itemCountEl.textContent = `Showing ${items.length} of ${total}`;

  if (items.length === 0) {
    cardGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-secondary)">No items match your filters</div>';
    return;
  }

  cardGrid.innerHTML = items.map(item => {
    const s = getItemState(item.id);
    const classes = ['item-card'];
    if (s.owned) classes.push('owned');
    if (s.mastered) classes.push('mastered');

    return `<div class="${classes.join(' ')}" data-id="${item.id}">
      <div class="card-top">
        <span class="item-name">${item.name}</span>
        ${item.variant ? `<span class="badge badge-${item.variant}">${item.variant}</span>` : ''}
        <a href="${item.wiki_url}" target="_blank" rel="noopener" class="wiki-link" title="Wiki">&#x2197;</a>
      </div>
      <div class="card-meta">
        <span>${item.subcategory}</span>
        ${item.mastery_rank > 0 ? `<span>MR ${item.mastery_rank}</span>` : ''}
      </div>
      <div class="card-actions">
        <button class="toggle-btn ${s.owned ? 'active-owned' : ''}" data-action="owned" data-id="${item.id}">
          ${s.owned ? '\u2714' : '\u25CB'} Owned
        </button>
        <button class="toggle-btn ${s.mastered ? 'active-mastered' : ''}" data-action="mastered" data-id="${item.id}">
          ${s.mastered ? '\u2605' : '\u2606'} Mastered
        </button>
      </div>
    </div>`;
  }).join('');
}

function updateSingleCard(itemId) {
  const el = cardGrid.querySelector(`[data-id="${itemId}"]`);
  if (!el) return;
  const s = getItemState(itemId);
  el.className = 'item-card' + (s.mastered ? ' mastered' : s.owned ? ' owned' : '');
  const ownBtn = el.querySelector('[data-action="owned"]');
  const masBtn = el.querySelector('[data-action="mastered"]');
  if (ownBtn) {
    ownBtn.className = 'toggle-btn' + (s.owned ? ' active-owned' : '');
    ownBtn.innerHTML = (s.owned ? '\u2714' : '\u25CB') + ' Owned';
  }
  if (masBtn) {
    masBtn.className = 'toggle-btn' + (s.mastered ? ' active-mastered' : '');
    masBtn.innerHTML = (s.mastered ? '\u2605' : '\u2606') + ' Mastered';
  }
}

// ── Events ──
function attachEvents() {
  // Card clicks (event delegation)
  cardGrid.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'owned') toggleOwned(id);
    else if (action === 'mastered') toggleMastered(id);
    updateSingleCard(id);
    renderDashboard();
  });

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeTab = tab.dataset.tab;
      filters.subcategory = 'all';
      renderTabs();
      updateSubcategoryOptions();
      renderCards();
      saveUIState();
    });
  });

  // Filters
  let searchTimer;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.search = searchEl.value;
      renderCards();
      saveUIState();
    }, 150);
  });

  subcatEl.addEventListener('change', () => {
    filters.subcategory = subcatEl.value;
    renderCards();
    saveUIState();
  });

  statusEl.addEventListener('change', () => {
    filters.status = statusEl.value;
    renderCards();
    saveUIState();
  });

  primeEl.addEventListener('change', () => {
    filters.primeOnly = primeEl.checked;
    renderCards();
    saveUIState();
  });

  sortEl.addEventListener('change', () => {
    sortBy = sortEl.value;
    renderCards();
    saveUIState();
  });

  // Bulk actions toggle
  $('btn-bulk-toggle').addEventListener('click', () => {
    const panel = $('bulk-panel');
    panel.hidden = !panel.hidden;
  });

  $('btn-bulk-own').addEventListener('click', () => {
    const items = getFilteredItems();
    if (!confirm(`Mark ${items.length} items as Owned?`)) return;
    bulkUpdate(items.map(i => i.id), 'owned', true);
    renderCards();
    renderDashboard();
  });

  $('btn-bulk-master').addEventListener('click', () => {
    const items = getFilteredItems();
    if (!confirm(`Mark ${items.length} items as Mastered?`)) return;
    bulkUpdate(items.map(i => i.id), 'mastered', true);
    renderCards();
    renderDashboard();
  });

  $('btn-bulk-uncheck').addEventListener('click', () => {
    const items = getFilteredItems();
    if (!confirm(`Reset ${items.length} items to unchecked?`)) return;
    bulkUpdate(items.map(i => i.id), 'reset', true);
    renderCards();
    renderDashboard();
  });

  // Export
  $('btn-export').addEventListener('click', () => {
    const json = exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `wf_progress_${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Import
  const importFileEl = $('import-file');
  $('btn-import').addEventListener('click', () => importFileEl.click());
  importFileEl.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      importData(text);
      renderCards();
      renderDashboard();
      showToast('Progress imported successfully!');
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    importFileEl.value = '';
  });

  // Reset
  $('btn-reset').addEventListener('click', () => {
    if (!confirm('Are you sure you want to reset ALL progress?')) return;
    if (!confirm('This cannot be undone. Reset everything?')) return;
    resetAllData();
    renderCards();
    renderDashboard();
    showToast('All progress reset.');
  });

  // Stats modal
  $('btn-stats').addEventListener('click', () => {
    renderStatsModal();
    $('stats-modal').hidden = false;
  });
  $('btn-close-stats').addEventListener('click', () => {
    $('stats-modal').hidden = true;
  });
  $('stats-modal').addEventListener('click', e => {
    if (e.target === $('stats-modal')) $('stats-modal').hidden = true;
  });

  // Share
  $('btn-share').addEventListener('click', () => {
    const text = generateShareText();
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard!');
    }).catch(() => {
      // Fallback: show in modal
      renderStatsModal();
      $('stats-modal').hidden = false;
    });
  });
}

// ── Stats Modal ──
function renderStatsModal() {
  const stats = computeStats(catalog);
  const { byCategory: bc, overallMastered, overallTotal, masteryPercent,
          masteredThisWeek, masteredThisMonth, streak, rarestOwned } = stats;

  $('stats-body').innerHTML = `
    <div class="stat-row"><span class="stat-label">Total Mastered</span><span class="stat-value">${overallMastered} / ${overallTotal}</span></div>
    <div class="stat-row"><span class="stat-label">Mastery %</span><span class="stat-value">${masteryPercent}%</span></div>
    <div class="stat-row"><span class="stat-label">Mastered this week</span><span class="stat-value">${masteredThisWeek}</span></div>
    <div class="stat-row"><span class="stat-label">Mastered this month</span><span class="stat-value">${masteredThisMonth}</span></div>
    <div class="stat-row"><span class="stat-label">Mastery streak</span><span class="stat-value">${streak} day${streak !== 1 ? 's' : ''}</span></div>
    <div class="stat-row"><span class="stat-label">Highest MR item owned</span><span class="stat-value">${rarestOwned ? `${rarestOwned.name} (MR ${rarestOwned.mastery_rank})` : 'None'}</span></div>
    <div class="share-box">${generateShareText()}</div>
    <button class="share-btn" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent);this.textContent='Copied!'">Copy to Clipboard</button>
  `;
}

function generateShareText() {
  const stats = computeStats(catalog);
  const { byCategory: bc, overallMastered, overallTotal, masteryPercent } = stats;
  const date = new Date().toISOString().slice(0, 10);
  const pad = (n, w) => String(n).padStart(w);
  return [
    `Warframe Tracker \u2014 ${date}`,
    `Warframes  ${pad(bc.warframe.owned,3)}/${bc.warframe.total} \u2714  ${pad(bc.warframe.mastered,3)}\u2605`,
    `Weapons   ${pad(bc.weapon.owned,3)}/${bc.weapon.total} \u2714  ${pad(bc.weapon.mastered,3)}\u2605`,
    `Companions ${pad(bc.companion.owned,2)}/${bc.companion.total}  \u2714   ${pad(bc.companion.mastered,2)}\u2605`,
    `Overall: ${masteryPercent}% mastered (${overallMastered}/${overallTotal})`,
  ].join('\n');
}

// ── Toast ──
function showToast(msg) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.hidden = false;
  toast.style.animation = 'none';
  toast.offsetHeight; // reflow
  toast.style.animation = '';
  setTimeout(() => { toast.hidden = true; }, 2200);
}

// ── Boot ──
document.addEventListener('DOMContentLoaded', init);
