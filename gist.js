// ── GitHub Gist Sync Layer ──

const TOKEN_KEY = 'wf_tracker_gh_token';
const GIST_ID_KEY = 'wf_tracker_gist_id';
const GIST_FILENAME = 'warframe-tracker-data.json';

// ── Token management ──

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearSync() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(GIST_ID_KEY);
}

export function getGistId() {
  return localStorage.getItem(GIST_ID_KEY);
}

// ── GitHub API helper ──

async function apiRequest(path, token, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  return res;
}

// ── Find or create gist ──

async function ensureGist(token) {
  // 1. Check cached gist ID
  const existingId = localStorage.getItem(GIST_ID_KEY);
  if (existingId) {
    try {
      await apiRequest(`/gists/${existingId}`, token);
      return existingId;
    } catch { /* gist deleted or inaccessible, continue */ }
  }

  // 2. Search user's gists for our filename
  const res = await apiRequest('/gists?per_page=100', token);
  const gists = await res.json();
  for (const gist of gists) {
    if (gist.files[GIST_FILENAME]) {
      localStorage.setItem(GIST_ID_KEY, gist.id);
      return gist.id;
    }
  }

  // 3. Create new private gist
  const createRes = await apiRequest('/gists', token, {
    method: 'POST',
    body: JSON.stringify({
      description: 'Warframe Tracker — collection progress data',
      public: false,
      files: { [GIST_FILENAME]: { content: JSON.stringify({ items: {}, version: 1 }, null, 2) } },
    }),
  });
  const created = await createRes.json();
  localStorage.setItem(GIST_ID_KEY, created.id);
  return created.id;
}

// ── Load data from gist ──

export async function loadFromGist(token) {
  const gistId = await ensureGist(token);
  const res = await apiRequest(`/gists/${gistId}`, token);
  const gist = await res.json();
  const file = gist.files[GIST_FILENAME];
  if (file && file.content) {
    const data = JSON.parse(file.content);
    if (data && data.items) return data;
  }
  return { items: {}, version: 1 };
}

// ── Save data to gist ──

export async function saveToGist(token, data) {
  const gistId = await ensureGist(token);
  await apiRequest(`/gists/${gistId}`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      files: { [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) } },
    }),
  });
}

// ── Validate token ──

export async function validateToken(token) {
  try {
    const res = await apiRequest('/user', token);
    const user = await res.json();
    return user.login || null;
  } catch {
    return null;
  }
}
