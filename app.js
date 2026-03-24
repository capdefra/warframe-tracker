import {
  loadCatalog, getUserState, getItemState,
  toggleOwned, toggleMastered, subsume, setForma, toggleExilus, toggleReactor, bulkUpdate,
  exportData, importData, resetAllData, computeStats,
  initSync, firstConnect, forceSync, forcePush, onSyncStatus, getSyncStatus
} from './data.js';
import { getToken, setToken, clearSync, validateToken, getGistId } from './gist.js';

let catalog = [];
let activeTab = 'warframe';
let filters = { search: '', subcategory: 'all', status: 'all', primeOnly: false };
let sortBy = 'alpha-asc';
let primeAvailableFor = new Set(); // base IDs that have a Prime variant

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
const cardMenu = $('card-menu');
const cardMenuItems = $('card-menu-items');
let currentMenuItemId = null;

// ── Prime index ──
function buildPrimeIndex() {
  primeAvailableFor.clear();
  for (const item of catalog) {
    if (item.has_prime) primeAvailableFor.add(item.id);
  }
}

// ── Init ──
async function init() {
  catalog = await loadCatalog();
  buildPrimeIndex();

  // Pull from Gist before rendering (Gist is authoritative)
  await initSync();

  loadUIState();
  renderDashboard();
  renderTabs();
  updateSubcategoryOptions();
  applyFiltersToUI();
  renderCards();
  attachEvents();
  initSyncUI();
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
  const { byCategory: bc, dedupByCategory: dbc, overallMastered, overallTotal, masteryPercent } = stats;
  const pct = overallTotal ? (overallMastered / overallTotal * 100) : 0;

  const dedupTip = (d) => {
    const p = d.totalFamilies ? ((d.ownedFamilies / d.totalFamilies) * 100).toFixed(1) : '0.0';
    return `${d.ownedFamilies}/${d.totalFamilies} unique items owned (${p}%)`;
  };

  dashboardEl.innerHTML = `
    <span class="dash-stat">
      <strong>Warframes</strong>
      <span class="teal" title="${dedupTip(dbc.warframe)}">${bc.warframe.owned}/${bc.warframe.total}</span> owned &middot;
      <span class="gold">${bc.warframe.mastered}</span> mastered
    </span>
    <span class="dash-stat">
      <strong>Weapons</strong>
      <span class="teal" title="${dedupTip(dbc.weapon)}">${bc.weapon.owned}/${bc.weapon.total}</span> owned &middot;
      <span class="gold">${bc.weapon.mastered}</span> mastered
    </span>
    <span class="dash-stat">
      <strong>Companions</strong>
      <span class="teal" title="${dedupTip(dbc.companion)}">${bc.companion.owned}/${bc.companion.total}</span> owned &middot;
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
      switch (filters.status) {
        case 'owned-mastered': return s.owned && s.mastered;
        case 'owned-not-mastered': return s.owned && !s.mastered;
        case 'not-owned-mastered': return !s.owned && s.mastered;
        case 'not-owned-not-mastered': return !s.owned && !s.mastered;
        case 'prime-available': {
          if (i.variant || !primeAvailableFor.has(i.id)) return false;
          const ps = state.items[i.id + '-prime'] || { owned: false };
          return s.owned && !ps.owned;
        }
        case 'feed-helminth': {
          if (i.variant || i.category !== 'warframe' || !primeAvailableFor.has(i.id)) return false;
          const ps = state.items[i.id + '-prime'] || { owned: false };
          return s.owned && s.mastered && ps.owned;
        }
        default: return true;
      }
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

    // Flags
    const flags = [];
    if (item.category === 'warframe' && s.subsumed) {
      flags.push('<span class="flag flag-subsumed">\u2714 Subsumed</span>');
    }
    if (!item.variant && primeAvailableFor.has(item.id)) {
      const primeState = getItemState(item.id + '-prime');
      if (s.owned && !primeState.owned) {
        flags.push('<span class="flag flag-prime-available">\u2714 Prime Available</span>');
      }
      if (item.category === 'warframe' && s.owned && s.mastered && primeState.owned) {
        flags.push('<span class="flag flag-helminth">\u2714 Feed to Helminth</span>');
      }
    }
    const flagsHtml = flags.length ? '<div class="card-flags">' + flags.join('') + '</div>' : '';

    return `<div class="${classes.join(' ')}" data-id="${item.id}">
      <div class="card-top">
        <span class="item-name">${item.name}</span>
        ${item.variant ? `<span class="badge badge-${item.variant}">${item.variant}</span>` : ''}
        <a href="${item.wiki_url}" target="_blank" rel="noopener" class="wiki-link" title="Wiki">&#x2197;</a>
        <button class="card-menu-btn" data-menu="${item.id}" title="Actions">&#x22EE;</button>
      </div>
      <div class="card-meta">
        <span>${item.subcategory}</span>
        ${item.mastery_rank > 0 ? `<span>MR ${item.mastery_rank}</span>` : ''}
        ${s.reactor ? `<span class="reactor-badge">${item.category === 'weapon' ? '\u2B23 Catalyst' : '\u2B23 Reactor'}</span>` : ''}
        ${s.exilus && (item.category === 'warframe' || item.category === 'weapon') ? '<span class="exilus-badge">\u2726 Exilus</span>' : ''}
        ${s.forma > 0 ? `<span class="forma-count">\u2B21 ${s.forma}</span>` : ''}
      </div>
      ${flagsHtml}
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
  const item = catalog.find(i => i.id === itemId);

  // Update classes (owned & mastered are independent)
  const classes = ['item-card'];
  if (s.owned) classes.push('owned');
  if (s.mastered) classes.push('mastered');
  el.className = classes.join(' ');

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

  // Update reactor/catalyst display
  const metaEl = el.querySelector('.card-meta');
  if (metaEl) {
    let reactorSpan = metaEl.querySelector('.reactor-badge');
    if (s.reactor) {
      if (!reactorSpan) {
        reactorSpan = document.createElement('span');
        reactorSpan.className = 'reactor-badge';
        metaEl.appendChild(reactorSpan);
      }
      reactorSpan.textContent = item.category === 'weapon' ? '\u2B23 Catalyst' : '\u2B23 Reactor';
    } else if (reactorSpan) {
      reactorSpan.remove();
    }

    // Update exilus display
    let exilusSpan = metaEl.querySelector('.exilus-badge');
    if (s.exilus && (item.category === 'warframe' || item.category === 'weapon')) {
      if (!exilusSpan) {
        exilusSpan = document.createElement('span');
        exilusSpan.className = 'exilus-badge';
        metaEl.appendChild(exilusSpan);
      }
      exilusSpan.textContent = '\u2726 Exilus';
    } else if (exilusSpan) {
      exilusSpan.remove();
    }

    // Update forma display
    let formaSpan = metaEl.querySelector('.forma-count');
    if (s.forma > 0) {
      if (!formaSpan) {
        formaSpan = document.createElement('span');
        formaSpan.className = 'forma-count';
        metaEl.appendChild(formaSpan);
      }
      formaSpan.textContent = '\u2B21 ' + s.forma;
    } else if (formaSpan) {
      formaSpan.remove();
    }
  }

  // Update flags
  if (item) {
    updateCardFlags(el, item, s);
  }
}

function updateCardFlags(el, item, s) {
  let flagsDiv = el.querySelector('.card-flags');

  // Determine which flags should show
  const showSubsumed = item.category === 'warframe' && s.subsumed;
  let showPrimeAvail = false;
  let showHelminth = false;

  if (!item.variant && primeAvailableFor.has(item.id)) {
    const primeState = getItemState(item.id + '-prime');
    showPrimeAvail = s.owned && !primeState.owned;
    showHelminth = item.category === 'warframe' && s.owned && s.mastered && primeState.owned;
  }

  if (!showSubsumed && !showPrimeAvail && !showHelminth) {
    if (flagsDiv) flagsDiv.remove();
    return;
  }

  // Create container if missing
  if (!flagsDiv) {
    const actions = el.querySelector('.card-actions');
    flagsDiv = document.createElement('div');
    flagsDiv.className = 'card-flags';
    el.insertBefore(flagsDiv, actions);
  }

  // Rebuild flags content
  let html = '';
  if (showSubsumed) html += '<span class="flag flag-subsumed">\u2714 Subsumed</span>';
  if (showPrimeAvail) html += '<span class="flag flag-prime-available">\u2714 Prime Available</span>';
  if (showHelminth) html += '<span class="flag flag-helminth">\u2714 Feed to Helminth</span>';
  flagsDiv.innerHTML = html;
}

// When toggling a Prime item, also update the base card's flags
function updateRelatedCards(itemId) {
  if (itemId.endsWith('-prime')) {
    const baseId = itemId.slice(0, -6);
    const baseItem = catalog.find(i => i.id === baseId);
    if (baseItem && primeAvailableFor.has(baseId)) {
      const baseEl = cardGrid.querySelector(`[data-id="${baseId}"]`);
      if (baseEl) {
        const baseState = getItemState(baseId);
        updateCardFlags(baseEl, baseItem, baseState);
      }
    }
  }
}

// ── Events ──
function attachEvents() {
  // Card clicks (event delegation)
  cardGrid.addEventListener('click', e => {
    // Menu button click
    const menuBtn = e.target.closest('[data-menu]');
    if (menuBtn) {
      e.stopPropagation();
      openCardMenu(menuBtn.dataset.menu, menuBtn);
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'owned') toggleOwned(id);
    else if (action === 'mastered') toggleMastered(id);
    updateSingleCard(id);
    updateRelatedCards(id);
    renderDashboard();
  });

  // Card menu actions
  cardMenuItems.addEventListener('click', e => {
    const action = e.target.closest('[data-menu-action]');
    if (!action) return;
    const act = action.dataset.menuAction;
    const itemId = currentMenuItemId;
    if (!itemId) return;

    if (act === 'subsume') {
      subsume(itemId);
      updateSingleCard(itemId);
      renderDashboard();
      closeCardMenu();
    } else if (act === 'reactor') {
      toggleReactor(itemId);
      updateSingleCard(itemId);
      closeCardMenu();
    } else if (act === 'exilus') {
      toggleExilus(itemId);
      updateSingleCard(itemId);
      closeCardMenu();
    } else if (act === 'forma-set') {
      const input = cardMenuItems.querySelector('.forma-input');
      if (input) {
        setForma(itemId, parseInt(input.value, 10) || 0);
        updateSingleCard(itemId);
      }
      closeCardMenu();
    } else if (act === 'forma-inc') {
      const input = cardMenuItems.querySelector('.forma-input');
      if (input) input.value = Math.min(99, (parseInt(input.value, 10) || 0) + 1);
    } else if (act === 'forma-dec') {
      const input = cardMenuItems.querySelector('.forma-input');
      if (input) input.value = Math.max(0, (parseInt(input.value, 10) || 0) - 1);
    }
  });

  // Forma input Enter key
  cardMenuItems.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('forma-input')) {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && currentMenuItemId) {
        setForma(currentMenuItemId, val);
        updateSingleCard(currentMenuItemId);
      }
      closeCardMenu();
    }
  });

  // Close menu on outside click
  document.addEventListener('click', e => {
    if (!cardMenu.hidden && !cardMenu.contains(e.target) && !e.target.closest('[data-menu]')) {
      closeCardMenu();
    }
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

// ── Card Menu ──
function openCardMenu(itemId, anchorEl) {
  const item = catalog.find(i => i.id === itemId);
  if (!item) return;
  const s = getItemState(itemId);
  currentMenuItemId = itemId;

  let html = '';

  // Feed to Helminth (warframes only, when owned and not already subsumed)
  if (item.category === 'warframe' && s.owned && !s.subsumed) {
    html += '<button class="card-menu-item" data-menu-action="subsume">\uD83D\uDD2C Feed to Helminth</button>';
  }
  // Already subsumed indicator
  if (item.category === 'warframe' && s.subsumed) {
    html += '<div class="card-menu-item card-menu-item-subsumed">\u2714 Subsumed</div>';
  }

  // Orokin Reactor/Catalyst toggle
  const orokinLabel = item.category === 'weapon' ? 'Orokin Catalyst' : 'Orokin Reactor';
  html += `<button class="card-menu-item ${s.reactor ? 'card-menu-item-active' : ''}" data-menu-action="reactor">
    ${s.reactor ? '\u2B23' : '\u2B22'} ${s.reactor ? orokinLabel + ' \u2714' : 'Install ' + orokinLabel}
  </button>`;

  // Exilus Adapter toggle (warframes and weapons only)
  if (item.category === 'warframe' || item.category === 'weapon') {
    html += `<button class="card-menu-item ${s.exilus ? 'card-menu-item-active' : ''}" data-menu-action="exilus">
      ${s.exilus ? '\u2726' : '\u2727'} ${s.exilus ? 'Exilus Adapter \u2714' : 'Install Exilus Adapter'}
    </button>`;
  }

  // Set Forma (always available)
  html += `<div class="card-menu-forma">
    <label>\u2B21 Forma</label>
    <div class="forma-controls">
      <button class="forma-btn" data-menu-action="forma-dec">\u2212</button>
      <input type="number" class="forma-input" value="${s.forma}" min="0" max="99" />
      <button class="forma-btn" data-menu-action="forma-inc">+</button>
      <button class="forma-set-btn" data-menu-action="forma-set">Set</button>
    </div>
  </div>`;

  cardMenuItems.innerHTML = html;

  // Position near anchor
  const rect = anchorEl.getBoundingClientRect();
  cardMenu.hidden = false;
  const menuRect = cardMenu.getBoundingClientRect();
  let top = rect.bottom + 4;
  let left = rect.right - menuRect.width;

  // Keep in viewport
  if (left < 8) left = 8;
  if (top + menuRect.height > window.innerHeight - 8) {
    top = rect.top - menuRect.height - 4;
  }

  cardMenu.style.top = top + 'px';
  cardMenu.style.left = left + 'px';
}

function closeCardMenu() {
  cardMenu.hidden = true;
  currentMenuItemId = null;
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

// ── Sync UI ──
function initSyncUI() {
  const syncIndicator = $('sync-indicator');
  const syncModal = $('sync-modal');

  // Update indicator on status changes
  updateSyncIndicator(getSyncStatus());
  onSyncStatus(status => updateSyncIndicator(status));

  // Open sync settings
  syncIndicator.addEventListener('click', () => {
    renderSyncModal();
    syncModal.hidden = false;
  });

  // Close sync modal
  $('btn-close-sync').addEventListener('click', () => { syncModal.hidden = true; });
  syncModal.addEventListener('click', e => {
    if (e.target === syncModal) syncModal.hidden = true;
  });
}

function updateSyncIndicator(status) {
  const el = $('sync-indicator');
  el.className = 'sync-indicator sync-' + status;
  const labels = {
    idle: '\u25CB Local only',
    offline: '\u25CB Local only',
    syncing: '\u21BB Syncing...',
    synced: '\u2714 Synced',
    error: '\u26A0 Sync error',
  };
  el.textContent = labels[status] || status;
}

function renderSyncModal() {
  const token = getToken();
  const gistId = getGistId();
  const body = $('sync-body');

  if (token) {
    body.innerHTML = `
      <div class="sync-connected">
        <div class="stat-row"><span class="stat-label">Status</span><span class="stat-value sync-status-label">${getSyncStatus()}</span></div>
        ${gistId ? `<div class="stat-row"><span class="stat-label">Gist ID</span><span class="stat-value" style="font-size:0.75rem">${gistId}</span></div>` : ''}
        <div class="sync-actions">
          <button id="btn-force-sync" class="btn-secondary">Pull from Gist</button>
          <button id="btn-force-push" class="btn-secondary">Push to Gist</button>
          <button id="btn-disconnect-sync" class="btn-danger">Disconnect</button>
        </div>
        <p class="sync-hint">Pull replaces local data with Gist. Push overwrites Gist with local data.</p>
      </div>
    `;
    $('btn-force-sync').addEventListener('click', async () => {
      await forceSync();
      renderCards();
      renderDashboard();
      renderSyncModal();
      showToast('Pulled from Gist');
    });
    $('btn-force-push').addEventListener('click', async () => {
      await forcePush();
      renderSyncModal();
      showToast('Pushed to Gist');
    });
    $('btn-disconnect-sync').addEventListener('click', () => {
      if (!confirm('Disconnect Gist sync? Local data will be kept.')) return;
      clearSync();
      updateSyncIndicator('offline');
      renderSyncModal();
      showToast('Gist sync disconnected');
    });
  } else {
    body.innerHTML = `
      <p class="sync-description">Sync your progress across devices using a GitHub Gist. Create a <a href="https://github.com/settings/tokens/new?scopes=gist&description=Warframe+Tracker" target="_blank" rel="noopener">Personal Access Token</a> with the <strong>gist</strong> scope.</p>
      <div class="sync-connect-form">
        <input type="password" id="sync-token-input" class="sync-input" placeholder="ghp_..." autocomplete="off" />
        <button id="btn-connect-sync" class="btn-secondary">Connect</button>
      </div>
      <p id="sync-connect-error" class="sync-error" hidden></p>
    `;
    $('btn-connect-sync').addEventListener('click', async () => {
      const input = $('sync-token-input');
      const errorEl = $('sync-connect-error');
      const tokenVal = input.value.trim();
      if (!tokenVal) return;

      errorEl.hidden = true;
      $('btn-connect-sync').textContent = 'Validating...';
      $('btn-connect-sync').disabled = true;

      const login = await validateToken(tokenVal);
      if (login) {
        setToken(tokenVal);
        // Pull from Gist first; only push if Gist is empty
        await firstConnect();
        renderCards();
        renderDashboard();
        renderSyncModal();
        showToast('Connected as ' + login);
      } else {
        errorEl.textContent = 'Invalid token. Make sure it has the gist scope.';
        errorEl.hidden = false;
        $('btn-connect-sync').textContent = 'Connect';
        $('btn-connect-sync').disabled = false;
      }
    });
  }
}

// ── Boot ──
document.addEventListener('DOMContentLoaded', init);
