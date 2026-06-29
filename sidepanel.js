/**
 * ApexLens — Side Panel Controller
 * Main UI logic: org management, log display, detail viewer, settings
 */

import { LogParser } from './services/parser.js';
import { StorageService } from './services/storage.js';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  orgs: [],
  selectedOrgUrl: null,
  logs: [],            // All logs for selected org
  filteredLogs: [],    // After filter/search
  selectedLog: null,
  parsedLog: null,
  settings: StorageService.DEFAULT_SETTINGS,
  activeFilter: 'all',
  activeDTab: 'all',
  searchQuery: '',
  logSearchQuery: '',
  autoRefresh: true,
  stats: { success: 0, errors: 0, total: 0, avgSoql: 0 },
  logTypeCache: {},
  logTitleCache: {},
  logAnalysisAttempted: {}
};

// ─── Background Port ──────────────────────────────────────────────────────────
let port = null;
const TYPE_FILTERS = new Set(['trigger', 'batch', 'flow', 'queueable', 'future', 'platform']);
const hydratingTypeFilters = new Set();
let hydratingVisibleLogs = false;

function connectPort() {
  port = chrome.runtime.connect({ name: 'sidepanel' });
  port.onMessage.addListener(handleBackgroundMessage);
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connectPort, 1000); // Reconnect
  });
}

function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    if (port) {
      const requestId = Math.random().toString(36).slice(2);
      message.requestId = requestId;

      const handler = (msg) => {
        if (msg.requestId === requestId) {
          port.onMessage.removeListener(handler);
          resolve(msg);
        }
      };
      port.onMessage.addListener(handler);
      port.postMessage(message);

      setTimeout(() => {
        port.onMessage.removeListener(handler);
        reject(new Error('Timeout'));
      }, 15000);
    } else {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response || {});
      });
    }
  });
}

// ─── Message Handler ──────────────────────────────────────────────────────────
function handleBackgroundMessage(message) {
  switch (message.type) {
    case 'ORGS_UPDATED':
      state.orgs = message.orgs || [];
      renderOrgList();
      updateStatusBar();
      break;

    case 'NEW_LOGS':
      if (message.orgUrl === state.selectedOrgUrl) {
        // Prepend new logs
        const newLogs = message.logs || [];
        newLogs.forEach(log => {
          if (!state.logs.find(l => l.Id === log.Id)) {
            state.logs.unshift(log);
          }
        });
        // Trim to max
        if (state.logs.length > state.settings.maxLogs) {
          state.logs = state.logs.slice(0, state.settings.maxLogs);
        }
        applyFilterAndSearch();
        updateStats();
        updateLastRefresh();

        // Notify
        if (newLogs.length > 0) {
          const latest = newLogs[0];
          const isError = latest.Status === 'Error' || (latest.Operation || '').includes('Fail');
          showToast(
            isError ? 'error' : 'success',
            `${newLogs.length === 1 ? 'New log' : newLogs.length + ' new logs'}`,
            latest.Operation || latest.Request || 'Apex Execution'
          );
        }
      }
      break;
  }
}

// ─── DOM References ───────────────────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const els = {
  orgList:         $('#org-list'),
  orgIndicator:    $('#org-indicator'),
  orgLabel:        $('#org-label'),
  statusDot:       $('#org-indicator .status-dot'),
  traceBadge:      $('#trace-badge'),
  lastRefresh:     $('#last-refresh'),
  autoRefreshBtn:  $('#btn-auto-refresh'),
  logList:         $('#log-list'),
  logListWrap:     $('#log-list-wrap'),
  emptyState:      $('#empty-state'),
  logCountLabel:   $('#log-count-label'),
  cntSuccess:      $('#cnt-success'),
  cntError:        $('#cnt-error'),
  searchInput:     $('#search-input'),
  filterBtns:      $$('#filter-btns .filter-btn'),
  // Stats
  statSuccess:     $('#stat-success'),
  statErrors:      $('#stat-errors'),
  statTotal:       $('#stat-total'),
  statSoql:        $('#stat-soql'),
  // Detail
  detailEmpty:     $('#detail-empty'),
  detailContent:   $('#detail-content'),
  detailTitle:     $('#detail-title'),
  detailStatusDot: $('#detail-status-dot'),
  detailUser:      $('#detail-user'),
  detailTime:      $('#detail-time'),
  detailSize:      $('#detail-size'),
  detailDuration:  $('#detail-duration'),
  detailTabs:      $$('.dtab'),
  limitsPanel:     $('#limits-panel'),
  governorGrid:    $('#governor-grid'),
  logSearch:       $('#log-search'),
  logSearchCount:  $('#log-search-count'),
  logLoading:      $('#log-loading'),
  logBody:         $('#log-body'),
  logBodyWrap:     $('#log-body-wrap'),
  logSearchWrap:   $('#log-search-wrap'),
  tabCntErrors:    $('#tab-cnt-errors'),
  tabCntDebug:     $('#tab-cnt-debug'),
  tabCntSoql:      $('#tab-cnt-soql'),
  tabCntDml:       $('#tab-cnt-dml'),
  toastContainer:  $('#toast-container'),
  // Settings
  settingsOverlay: $('#settings-overlay'),
  traceOverlay:    $('#trace-overlay'),
  traceFlagList:   $('#trace-flag-list'),
  traceUserSearch: $('#trace-user-search'),
  traceUserResults:$('#trace-user-results'),
};

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  connectPort();
  state.settings = await StorageService.getSettings();
  applySettings();
  bindEvents();

  // Request current orgs
  try {
    const res = await sendToBackground({ type: 'GET_ORGS' });
    state.orgs = res.orgs || [];
    renderOrgList();
  } catch {}
}

// ─── Event Binding ────────────────────────────────────────────────────────────
function bindEvents() {
  // Theme toggle
  $('#btn-theme').addEventListener('click', toggleTheme);

  // Settings
  $('#btn-settings').addEventListener('click', () => els.settingsOverlay.classList.remove('hidden'));
  $('#btn-close-settings').addEventListener('click', () => els.settingsOverlay.classList.add('hidden'));
  els.settingsOverlay.addEventListener('click', (e) => { if (e.target === els.settingsOverlay) els.settingsOverlay.classList.add('hidden'); });
  $('#btn-save-settings').addEventListener('click', saveSettings);
  $('#btn-reset-settings').addEventListener('click', resetSettings);

  // Auto refresh
  els.autoRefreshBtn.addEventListener('click', toggleAutoRefresh);

  // Org rescan
  $('#btn-refresh-orgs').addEventListener('click', async () => {
    const res = await sendToBackground({ type: 'GET_ORGS' });
    state.orgs = res.orgs || [];
    renderOrgList();
  });

  // Search
  els.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    applyFilterAndSearch();
  });

  // Filter buttons
  els.filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeFilter = btn.dataset.filter;
      els.filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilterAndSearch();
    });
  });

  // Clear logs
  $('#btn-clear-logs').addEventListener('click', () => {
    state.logs = [];
    state.filteredLogs = [];
    state.selectedLog = null;
    state.logTypeCache = {};
    state.logTitleCache = {};
    state.logAnalysisAttempted = {};
    renderLogList();
    showDetailEmpty();
    updateStats();
  });

  // Detail tabs
  els.detailTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      state.activeDTab = tab.dataset.dtab;
      els.detailTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderDetailTab();
    });
  });

  // Log search
  els.logSearch.addEventListener('input', (e) => {
    state.logSearchQuery = e.target.value;
    highlightLogSearch();
  });

  // Copy log
  $('#btn-copy-log').addEventListener('click', copyLog);

  // Download log
  $('#btn-download-log').addEventListener('click', downloadLog);

  // Open in SF
  $('#btn-open-sf').addEventListener('click', openInSalesforce);

  // Trace flag
  $('#btn-new-trace').addEventListener('click', () => {
    if (!state.selectedOrgUrl) return showToast('warning', 'No org connected', 'Connect an org first');
    els.traceOverlay.classList.remove('hidden');
    loadTraceUsers();
  });
  $('#btn-close-trace').addEventListener('click', () => els.traceOverlay.classList.add('hidden'));
  els.traceOverlay.addEventListener('click', (e) => { if (e.target === els.traceOverlay) els.traceOverlay.classList.add('hidden'); });
  $('#btn-create-trace').addEventListener('click', createTraceFlag);

  // Trace user search
  els.traceUserSearch.addEventListener('input', debounce(searchTraceUsers, 350));

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      els.searchInput.focus();
      els.searchInput.select();
    }
    if (e.key === 'Escape') {
      els.settingsOverlay.classList.add('hidden');
      els.traceOverlay.classList.add('hidden');
    }
  });
}

// ─── Org Rendering ────────────────────────────────────────────────────────────
function renderOrgList() {
  els.orgList.innerHTML = '';

  if (!state.orgs.length) {
    els.orgList.innerHTML = `
      <div class="empty-state-small">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <p>Open a Salesforce org in any tab</p>
      </div>`;
    return;
  }

  state.orgs.forEach((org, idx) => {
    const card = document.createElement('div');
    card.className = `org-card ${org.status === 'connected' ? 'connected' : ''} ${state.selectedOrgUrl === org.orgUrl ? 'selected' : ''}`;
    card.style.animationDelay = `${idx * 40}ms`;

    const typeColors = { Production: '#10B981', Sandbox: '#F59E0B', Developer: '#7C3AED', Scratch: '#06B6D4' };
    const statusDotClass = {
      detected: 'dot-idle',
      connecting: 'dot-connecting',
      connected: 'dot-connected',
      error: 'dot-error'
    }[org.status] || 'dot-idle';

    const btnLabel = org.status === 'connected' ? 'Live' : org.status === 'connecting' ? '...' : 'Connect';
    const btnClass = org.status === 'connected' ? 'connected' : '';

    card.innerHTML = `
      <span class="status-dot ${statusDotClass}"></span>
      <div class="org-card-info">
        <div class="org-card-name" title="${org.orgUrl}">${escapeHtml(org.orgName)}</div>
        <div class="org-card-type" style="color:${typeColors[org.orgType] || '#94A3B8'}">${org.orgType}</div>
      </div>
      <button class="org-connect-btn ${btnClass}" data-org-url="${org.orgUrl}" data-tab-id="${org.tabId}">
        ${btnLabel}
      </button>`;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('org-connect-btn')) return;
      selectOrg(org.orgUrl);
    });

    card.querySelector('.org-connect-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (org.status === 'connected') {
        disconnectOrg(org.orgUrl);
      } else {
        connectOrg(org.orgUrl, org.tabId);
      }
    });

    els.orgList.appendChild(card);
  });
}

function selectOrg(orgUrl) {
  state.selectedOrgUrl = orgUrl;
  state.logs = [];
  state.filteredLogs = [];
  state.logTypeCache = {};
  state.logTitleCache = {};
  state.logAnalysisAttempted = {};
  renderOrgList();
  renderLogList();
  showDetailEmpty();
  updateStatusBar();
  loadTraceFlagsForOrg();
}

async function connectOrg(orgUrl, tabId) {
  showToast('info', 'Connecting…', orgUrl.replace('https://', ''));
  try {
    const res = await sendToBackground({ type: 'CONNECT_ORG', orgUrl, tabId });
    if (res.error) {
      showToast('error', 'Connection failed', res.error);
    } else {
      state.selectedOrgUrl = orgUrl;
      state.logTypeCache = {};
      state.logTitleCache = {};
      state.logAnalysisAttempted = {};
      showToast('success', 'Connected!', res.identity?.username || orgUrl);
      loadTraceFlagsForOrg();
    }
  } catch (e) {
    showToast('error', 'Connection error', e.message);
  }
}

async function disconnectOrg(orgUrl) {
  await sendToBackground({ type: 'DISCONNECT_ORG', orgUrl });
  if (state.selectedOrgUrl === orgUrl) {
    state.logs = [];
    state.filteredLogs = [];
    state.logTypeCache = {};
    state.logTitleCache = {};
    state.logAnalysisAttempted = {};
    renderLogList();
    showDetailEmpty();
  }
  showToast('info', 'Disconnected', '');
}

// ─── Status Bar ───────────────────────────────────────────────────────────────
function updateStatusBar() {
  const connectedOrg = state.orgs.find(o => o.orgUrl === state.selectedOrgUrl && o.status === 'connected');
  const anyConnected = state.orgs.find(o => o.status === 'connected');

  if (connectedOrg) {
    els.orgLabel.textContent = connectedOrg.orgName;
    setStatusDot('connected');
  } else if (state.orgs.length > 0) {
    const detected = state.orgs[0];
    els.orgLabel.textContent = `${state.orgs.length} org${state.orgs.length > 1 ? 's' : ''} detected`;
    setStatusDot('detecting');
  } else {
    els.orgLabel.textContent = 'No Salesforce org detected';
    setStatusDot('idle');
  }
}

function setStatusDot(type) {
  const dot = els.orgIndicator.querySelector('.status-dot');
  if (!dot) return;
  dot.className = `status-dot dot-${type}`;
}

function updateLastRefresh() {
  const now = new Date();
  els.lastRefresh.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── Log Filtering ────────────────────────────────────────────────────────────
function getLogText(log) {
  return [
    state.logTitleCache[log.Id],
    log.Operation,
    log.Request,
    log.Application,
    log.Location,
    log.LogUser?.Name
  ].filter(Boolean).join(' ').toLowerCase();
}

function extractLogOrigin(rawBody = '') {
  const lines = rawBody.split('\n');
  const isHelperName = (name) => /^(system|logger|database|test|pattern|string)\b/i.test(name);
  const normalizeOriginName = (name) => {
    const parts = name.split('.');
    if (parts.length === 2 && parts[0] === parts[1]) return parts[0];
    return name;
  };

  for (const line of lines) {
    const anonymousCall = line.match(/Execute Anonymous:\s*([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)\s*\(/i);
    if (anonymousCall && !isHelperName(anonymousCall[1])) {
      return normalizeOriginName(anonymousCall[1]);
    }
  }

  for (const line of lines) {
    const method = line.match(/\|METHOD_ENTRY\|[^|]*\|(?:[A-Za-z0-9]{15,18}\|)?([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)\s*\(/);
    if (method && !isHelperName(method[1])) return normalizeOriginName(method[1]);
  }

  for (const line of lines) {
    const trigger = line.match(/\|CODE_UNIT_STARTED\|[^|]*\|(?:[A-Za-z0-9]{15,18}\|)?([A-Za-z_][\w$]*)\s+on\s+\w+\s+trigger event/i);
    if (trigger) return trigger[1];
  }

  for (const line of lines) {
    const className = line.match(/\|CODE_UNIT_STARTED\|[^|]*\|(?:[A-Za-z0-9]{15,18}\|)?([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)/);
    if (className && !/executeanonymous|execute_anonymous|anonymous/i.test(className[1]) && !isHelperName(className[1])) {
      return normalizeOriginName(className[1]);
    }
  }

  return '';
}

function getLogTitle(log) {
  return state.logTitleCache[log.Id] || log.Operation || log.Request || 'Apex Log';
}

function classifyLogTypes(log, rawBody = '') {
  const metaText = getLogText(log);
  const bodyText = rawBody.toLowerCase();
  const text = `${metaText} ${bodyText}`;
  const types = new Set();

  if (/\btrigger\b|trigger event|code_unit_started\|[^|]*trigger|__trigger/.test(text)) types.add('trigger');
  if (/\bbatch\b|batch_apex|batchable|database\.batchable|batch_execute/.test(text)) types.add('batch');
  if (/\bflow\b|flow_interview|flow_start_interview/.test(text)) types.add('flow');
  if (/\bqueueable\b|queueable_execute|system\.queueable|queueable apex/.test(metaText) ||
      /\|(?:code_unit_started|method_entry)\|[^|]*(queueable_execute|system\.queueable|queueable apex|queueable)/.test(bodyText)) {
    types.add('queueable');
  }
  if (/\bfuture\b|future_handler|@future|future method/.test(metaText) ||
      /\|(?:code_unit_started|method_entry)\|[^|]*(future_handler|@future|future method)/.test(bodyText)) {
    types.add('future');
  }
  if (/platform event|eventbus|__e\b|publish event|process event/.test(text)) types.add('platform');

  return [...types];
}

function cacheLogBodyAnalysis(log, rawBody = '') {
  state.logTypeCache[log.Id] = classifyLogTypes(log, rawBody);

  const origin = extractLogOrigin(rawBody);
  if (origin) {
    state.logTitleCache[log.Id] = origin;
  }
}

function matchesLogFilter(log, filter) {
  const status = (log.Status || '').toLowerCase();

  switch (filter) {
    case 'success': return status === 'success';
    case 'error': return status === 'error' || status === 'failed';
    case 'warning': return status === 'warning';
    default: {
      const cachedTypes = state.logTypeCache[log.Id];
      const types = cachedTypes || classifyLogTypes(log);
      return types.includes(filter);
    }
  }
}

async function hydrateLogTypesForFilter(filter) {
  if (!TYPE_FILTERS.has(filter) || hydratingTypeFilters.has(filter) || !state.selectedOrgUrl) return;

  const candidates = state.logs
    .filter(log => !state.logAnalysisAttempted[log.Id] && !state.logTypeCache[log.Id] && !classifyLogTypes(log).includes(filter))
    .slice(0, 40);

  if (!candidates.length) return;

  hydratingTypeFilters.add(filter);
  try {
    for (const log of candidates) {
      state.logAnalysisAttempted[log.Id] = true;
      const res = await sendToBackground({
        type: 'FETCH_LOG_BODY',
        orgUrl: state.selectedOrgUrl,
        logId: log.Id
      });
      if (!res.error) {
        cacheLogBodyAnalysis(log, res.body || '');
      }
    }
  } finally {
    hydratingTypeFilters.delete(filter);
  }

  if (state.activeFilter === filter) {
    applyFilterAndSearch();
  }
}

async function hydrateVisibleLogAnalysis() {
  if (hydratingVisibleLogs || !state.selectedOrgUrl) return;

  const candidates = state.filteredLogs
    .filter(log => !state.logAnalysisAttempted[log.Id] && (!state.logTypeCache[log.Id] || !state.logTitleCache[log.Id]))
    .slice(0, 15);

  if (!candidates.length) return;

  hydratingVisibleLogs = true;
  try {
    for (const log of candidates) {
      state.logAnalysisAttempted[log.Id] = true;
      const res = await sendToBackground({
        type: 'FETCH_LOG_BODY',
        orgUrl: state.selectedOrgUrl,
        logId: log.Id
      });
      if (!res.error) {
        cacheLogBodyAnalysis(log, res.body || '');
      }
    }
  } finally {
    hydratingVisibleLogs = false;
  }

  applyFilterAndSearch();
}

function applyFilterAndSearch() {
  let logs = [...state.logs];

  // Filter by type
  const f = state.activeFilter;
  if (f !== 'all') {
    logs = logs.filter(log => matchesLogFilter(log, f));
  }

  // Search
  const q = state.searchQuery.toLowerCase().trim();
  if (q) {
    logs = logs.filter(log =>
      getLogText(log).includes(q) ||
      (log.Status || '').toLowerCase().includes(q) ||
      (state.logTypeCache[log.Id] || []).some(type => type.includes(q))
    );
  }

  state.filteredLogs = logs;
  renderLogList();
  updateCountBar();

  if (TYPE_FILTERS.has(f)) {
    hydrateLogTypesForFilter(f);
  }

  hydrateVisibleLogAnalysis();
}

// ─── Log List Rendering ───────────────────────────────────────────────────────
let _renderedLogIds = new Set();

function renderLogList() {
  const logs = state.filteredLogs;

  if (!logs.length) {
    els.emptyState.classList.remove('hidden');
    els.logList.innerHTML = '';
    _renderedLogIds.clear();
    return;
  }
  els.emptyState.classList.add('hidden');

  // Detect truly new logs (not yet rendered)
  const newIds = new Set(logs.map(l => l.Id));
  const addedIds = [...newIds].filter(id => !_renderedLogIds.has(id));

  // Full re-render for filter changes, partial for new logs
  if (addedIds.length > 0 && _renderedLogIds.size > 0) {
    // Prepend new cards
    addedIds.forEach(id => {
      const log = logs.find(l => l.Id === id);
      if (log) {
        const card = createLogCard(log, true);
        els.logList.insertBefore(card, els.logList.firstChild);
      }
    });
    // Sync removed
    _renderedLogIds.forEach(id => {
      if (!newIds.has(id)) {
        const el = els.logList.querySelector(`[data-log-id="${id}"]`);
        if (el) el.remove();
      }
    });
  } else {
    // Full render
    els.logList.innerHTML = '';
    logs.forEach((log, idx) => {
      const card = createLogCard(log, false, idx);
      els.logList.appendChild(card);
    });
  }

  _renderedLogIds = newIds;
}

function createLogCard(log, isNew = false, idx = 0) {
  const status = getLogStatus(log);
  const card = document.createElement('div');
  card.className = `log-card ${status.cls} ${isNew ? 'new-log' : ''}`;
  card.dataset.logId = log.Id;
  card.setAttribute('role', 'listitem');
  if (!isNew) card.style.animationDelay = `${Math.min(idx * 25, 300)}ms`;

  const title = getLogTitle(log);
  const user = log.LogUser?.Name || 'Unknown';
  const time = formatTime(log.LastModifiedDate);
  const size = formatSize(log.LogLength || 0);
  const duration = log.DurationMilliseconds ? `${log.DurationMilliseconds}ms` : '—';
  const sizePct = Math.min((log.LogLength || 0) / 52428800 * 100, 100); // 50MB max

  card.innerHTML = `
    <div class="log-card-top">
      <div class="log-card-title">${escapeHtml(title)}</div>
      <span class="log-status-badge ${status.badgeCls}">${status.label}</span>
    </div>
    <div class="log-card-meta">
      <span class="log-meta-item">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        ${escapeHtml(user)}
      </span>
      <span class="log-meta-item">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${time}
      </span>
      <span class="log-meta-item">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
        ${size}
      </span>
    </div>
    <div class="log-card-footer">
      <div class="log-size-bar"><div class="log-size-fill" style="width:${sizePct.toFixed(1)}%"></div></div>
      <span class="log-duration">${duration}</span>
    </div>`;

  card.addEventListener('click', () => selectLog(log));

  return card;
}

function getLogStatus(log) {
  const s = (log.Status || '').toLowerCase();
  if (s === 'success') return { cls: 'success', badgeCls: 'status-success', label: 'Success' };
  if (s === 'error' || s === 'failed') return { cls: 'error', badgeCls: 'status-error', label: 'Error' };
  return { cls: 'warning', badgeCls: 'status-warning', label: log.Status || 'Unknown' };
}

// ─── Log Selection & Detail ───────────────────────────────────────────────────
async function selectLog(log) {
  state.selectedLog = log;
  state.parsedLog = null;

  // Highlight selected card
  $$('.log-card').forEach(c => c.classList.remove('selected'));
  const card = els.logList.querySelector(`[data-log-id="${log.Id}"]`);
  if (card) card.classList.add('selected');

  // Show detail panel
  els.detailEmpty.classList.add('hidden');
  els.detailContent.classList.remove('hidden');

  // Fill header
  const status = getLogStatus(log);
  els.detailStatusDot.className = `status-dot-lg ${status.cls}`;
  els.detailTitle.textContent = getLogTitle(log);
  els.detailUser.lastChild.textContent = ` ${log.LogUser?.Name || 'Unknown'}`;
  els.detailTime.lastChild.textContent = ` ${formatTime(log.LastModifiedDate)}`;
  els.detailSize.lastChild.textContent = ` ${formatSize(log.LogLength || 0)}`;
  els.detailDuration.lastChild.textContent = ` ${log.DurationMilliseconds ? log.DurationMilliseconds + 'ms' : '—'}`;

  // Reset tabs
  state.activeDTab = state.settings.defaultTab || 'all';
  els.detailTabs.forEach(t => {
    t.classList.toggle('active', t.dataset.dtab === state.activeDTab);
  });

  // Show loading
  showLogLoading();

  // Fetch log body
  try {
    const res = await sendToBackground({
      type: 'FETCH_LOG_BODY',
      orgUrl: state.selectedOrgUrl,
      logId: log.Id
    });

    if (res.error) throw new Error(res.error);

    const rawBody = res.body || '';
    state.logAnalysisAttempted[log.Id] = true;
    cacheLogBodyAnalysis(log, rawBody);
    state.parsedLog = LogParser.parse(rawBody);
    els.detailTitle.textContent = getLogTitle(log);
    const titleEl = card?.querySelector('.log-card-title');
    if (titleEl) titleEl.textContent = getLogTitle(log);

    // Update tab counts
    if (state.parsedLog) {
      els.tabCntErrors.textContent = state.parsedLog.summary.errorCount;
      els.tabCntDebug.textContent  = state.parsedLog.summary.debugCount;
      els.tabCntSoql.textContent   = state.parsedLog.summary.soqlCount;
      els.tabCntDml.textContent    = state.parsedLog.summary.dmlCount;
    }

    renderDetailTab();
  } catch (err) {
    hideLogLoading();
    showLogError(err.message);
  }
}

function renderDetailTab() {
  if (!state.parsedLog) return;
  const tab = state.activeDTab;

  // Show/hide limits panel
  const isLimits = tab === 'limits';
  els.limitsPanel.classList.toggle('hidden', !isLimits);
  els.logBodyWrap.classList.toggle('hidden', isLimits);
  els.logSearchWrap.classList.toggle('hidden', isLimits);

  if (isLimits) {
    renderGovernorDashboard();
    return;
  }

  switch (tab) {
    case 'all':      renderRawLog(state.parsedLog.raw); break;
    case 'errors':   renderStructured(state.parsedLog.errors, 'error'); break;
    case 'debug':    renderStructured(state.parsedLog.debugStatements, 'debug'); break;
    case 'soql':     renderStructured(state.parsedLog.soqlQueries, 'soql'); break;
    case 'dml':      renderStructured(state.parsedLog.dmlOperations, 'dml'); break;
    case 'flow':     renderStructured(state.parsedLog.flowExecutions, 'flow'); break;
    case 'callouts': renderStructured(state.parsedLog.callouts, 'callout'); break;
    default:         renderRawLog(state.parsedLog.raw);
  }
}

function renderRawLog(raw) {
  hideLogLoading();
  els.logBody.classList.remove('hidden');

  // Syntax highlight the raw log
  const highlighted = syntaxHighlight(raw);
  els.logBody.innerHTML = highlighted;

  // Re-apply search highlight
  if (state.logSearchQuery) highlightLogSearch();
}

function syntaxHighlight(raw) {
  const lines = raw.split('\n');
  return lines.map(line => {
    const esc = escapeHtml(line);
    if (/FATAL_ERROR|EXCEPTION_THROWN/.test(line)) return `<span class="line-error">${esc}</span>`;
    if (/USER_DEBUG/.test(line)) return `<span class="line-debug">${esc}</span>`;
    if (/SOQL_EXECUTE/.test(line)) return `<span class="line-soql">${esc}</span>`;
    if (/DML_BEGIN|DML_END/.test(line)) return `<span class="line-dml">${esc}</span>`;
    if (/METHOD_ENTRY|METHOD_EXIT/.test(line)) return `<span class="line-method">${esc}</span>`;
    if (/FLOW_/.test(line)) return `<span class="line-flow">${esc}</span>`;
    if (/^\d{2}:\d{2}:\d{2}/.test(line)) {
      const ts = esc.match(/^(\d{2}:\d{2}:\d{2}\.\d+\s+\(\d+\))/)?.[1] || '';
      const rest = esc.slice(ts.length);
      return `<span class="line-ts">${ts}</span>${rest}`;
    }
    return esc;
  }).join('\n');
}

function renderStructured(items, type) {
  hideLogLoading();
  els.logBody.classList.add('hidden');

  // Replace log body wrap with structured panel
  const existing = els.logBodyWrap.querySelector('.structured-panel');
  if (existing) existing.remove();

  if (!items || !items.length) {
    const empty = document.createElement('div');
    empty.className = 'structured-panel';
    empty.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:12px">No ${type} entries in this log</div>`;
    els.logBodyWrap.appendChild(empty);
    return;
  }

  const panel = document.createElement('div');
  panel.className = 'structured-panel';

  items.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'structured-item';
    card.style.animationDelay = `${Math.min(idx * 20, 200)}ms`;
    card.innerHTML = buildStructuredCard(item, type);
    panel.appendChild(card);
  });

  els.logBodyWrap.appendChild(panel);
}

function buildStructuredCard(item, type) {
  switch (type) {
    case 'error':
      return `
        <div class="si-header">
          <span class="si-type error">${item.severity === 'fatal' ? 'FATAL ERROR' : 'EXCEPTION'}</span>
          <span class="si-badge">Line ${item.lineNum || '?'}</span>
        </div>
        <div class="si-body">${escapeHtml(item.message || '')}</div>`;

    case 'debug':
      return `
        <div class="si-header">
          <span class="si-type debug">DEBUG</span>
          <div class="si-meta">
            <span class="si-badge">${item.logLine || ''}</span>
            <span class="si-badge">${item.timestamp || ''}</span>
          </div>
        </div>
        <div class="si-body">${escapeHtml(item.message || '')}</div>`;

    case 'soql':
      return `
        <div class="si-header">
          <span class="si-type soql">SOQL</span>
          <div class="si-meta">
            <span class="si-badge ${(item.rows || 0) > 1000 ? 'highlight' : ''}">
              ${item.rows || 0} rows
            </span>
          </div>
        </div>
        <div class="si-body">${escapeHtml(item.query || item.rest || '')}</div>`;

    case 'dml':
      return `
        <div class="si-header">
          <span class="si-type dml">${item.operation || 'DML'}</span>
          <div class="si-meta">
            <span class="si-badge">${item.objectName || ''}</span>
            <span class="si-badge ${(item.rows || 0) > 1000 ? 'highlight' : ''}">${item.rows || 0} rows</span>
          </div>
        </div>`;

    case 'callout':
      return `
        <div class="si-header">
          <span class="si-type callout">HTTP</span>
          <span class="si-badge">${item.timestamp || ''}</span>
        </div>
        <div class="si-body">${escapeHtml((item.details || '') + '\n' + (item.response || ''))}</div>`;

    case 'flow':
      return `
        <div class="si-header">
          <span class="si-type flow">${item.type === 'start' ? 'FLOW START' : 'FLOW END'}</span>
          <span class="si-badge">${item.timestamp || ''}</span>
        </div>
        <div class="si-body">${escapeHtml(item.name || '')}</div>`;

    default:
      return `<div class="si-body">${escapeHtml(JSON.stringify(item, null, 2))}</div>`;
  }
}

function renderGovernorDashboard() {
  if (!state.parsedLog) return;
  const limits = LogParser.getGovernorLimits(state.parsedLog.limits || {});

  els.governorGrid.innerHTML = '';
  limits.forEach((limit, idx) => {
    const card = document.createElement('div');
    card.className = `governor-card ${limit.status}`;
    card.style.animationDelay = `${idx * 40}ms`;

    card.innerHTML = `
      <div class="governor-card-top">
        <div class="governor-label">
          <span>${limit.icon}</span>
          ${escapeHtml(limit.label)}
        </div>
        <div class="governor-values">
          <span class="gov-used">${limit.used}${limit.unit}</span>
          <span class="gov-sep">/</span>
          <span class="gov-max">${limit.max || '—'}${limit.unit}</span>
        </div>
      </div>
      <div class="governor-bar">
        <div class="governor-fill" style="width: 0%" data-target="${limit.percentage}"></div>
      </div>
      <div class="gov-pct">${limit.max > 0 ? limit.percentage + '%' : 'No data in log'}</div>`;

    els.governorGrid.appendChild(card);

    // Animate progress bar
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const fill = card.querySelector('.governor-fill');
        if (fill) fill.style.width = `${limit.percentage}%`;
      });
    });
  });
}

// ─── Log Search Highlight ─────────────────────────────────────────────────────
function highlightLogSearch() {
  const q = state.logSearchQuery.trim();
  if (!q) {
    // Reset
    if (state.parsedLog) renderRawLog(state.parsedLog.raw);
    els.logSearchCount.classList.add('hidden');
    return;
  }

  const raw = els.logBody.textContent;
  const regex = new RegExp(escapeRegex(q), 'gi');
  const matches = [...raw.matchAll(regex)];
  els.logSearchCount.textContent = `${matches.length} match${matches.length !== 1 ? 'es' : ''}`;
  els.logSearchCount.classList.toggle('hidden', matches.length === 0);

  // Re-highlight HTML with marks
  const highlighted = syntaxHighlight(state.parsedLog?.raw || raw);
  const withMarks = highlighted.replace(new RegExp(`(${escapeRegex(q)})`, 'gi'),
    '<mark class="highlight-match">$1</mark>');
  els.logBody.innerHTML = withMarks;
}

// ─── Stats ─────────────────────────────────────────────────────────────────── 
function updateStats() {
  const logs = state.logs;
  const success = logs.filter(l => (l.Status || '').toLowerCase() === 'success').length;
  const errors  = logs.filter(l => ['error','failed'].includes((l.Status || '').toLowerCase())).length;

  els.statSuccess.textContent = success;
  els.statErrors.textContent  = errors;
  els.statTotal.textContent   = logs.length;
  // Avg SOQL placeholder
  els.statSoql.textContent    = '—';
}

function updateCountBar() {
  const logs = state.filteredLogs;
  const ok  = logs.filter(l => (l.Status || '').toLowerCase() === 'success').length;
  const err = logs.filter(l => ['error','failed'].includes((l.Status || '').toLowerCase())).length;
  els.logCountLabel.textContent = `${logs.length} log${logs.length !== 1 ? 's' : ''}`;
  els.cntSuccess.textContent = `${ok} ok`;
  els.cntError.textContent   = `${err} err`;
}

// ─── Trace Flags ──────────────────────────────────────────────────────────────
async function loadTraceFlagsForOrg() {
  if (!state.selectedOrgUrl) return;
  els.traceFlagList.innerHTML = '<p class="hint-text">Loading…</p>';
  try {
    const res = await sendToBackground({ type: 'GET_TRACE_FLAGS', orgUrl: state.selectedOrgUrl });
    if (res.error) { els.traceFlagList.innerHTML = `<p class="hint-text" style="color:var(--error)">${res.error}</p>`; return; }

    const flags = res.flags || [];
    els.traceBadge.classList.toggle('hidden', flags.length === 0);

    if (!flags.length) {
      els.traceFlagList.innerHTML = '<p class="hint-text">No active trace flags</p>';
      return;
    }

    els.traceFlagList.innerHTML = '';
    flags.forEach(flag => {
      const expiry = new Date(flag.ExpirationDate);
      const minsLeft = Math.round((expiry - Date.now()) / 60000);
      const expiringSoon = minsLeft < 15;

      const item = document.createElement('div');
      item.className = 'trace-item';
      item.innerHTML = `
        <div class="trace-item-name">${escapeHtml(flag.TracedEntity?.Name || 'Unknown')}</div>
        <div class="trace-item-expiry ${expiringSoon ? 'expiring-soon' : ''}">
          ${expiringSoon ? '⚠ ' : ''}Expires in ${minsLeft}m
        </div>
        <div class="trace-actions">
          <button class="trace-action-btn" data-extend="${flag.Id}">+60m</button>
          <button class="trace-action-btn del" data-delete="${flag.Id}">Delete</button>
        </div>`;

      item.querySelector('[data-extend]').addEventListener('click', () => extendTrace(flag.Id));
      item.querySelector('[data-delete]').addEventListener('click', () => deleteTrace(flag.Id));
      els.traceFlagList.appendChild(item);
    });
  } catch (e) {
    els.traceFlagList.innerHTML = '<p class="hint-text">Connect an org first</p>';
  }
}

async function createTraceFlag() {
  const duration = parseInt($('#trace-duration').value, 10) || 60;
  const traceType = $('#trace-type').value || 'USER_DEBUG';
  const userId = $('#trace-user-search').dataset.userId;

  if (!userId) {
    showToast('warning', 'Select a user', 'Search and select a user first');
    return;
  }

  try {
    const res = await sendToBackground({
      type: 'CREATE_TRACE_FLAG',
      orgUrl: state.selectedOrgUrl,
      userId,
      duration,
      traceType
    });
    if (res.error) throw new Error(res.error);
    showToast('success', 'Trace flag created', `Active for ${duration} minutes`);
    els.traceOverlay.classList.add('hidden');
    loadTraceFlagsForOrg();
  } catch (e) {
    showToast('error', 'Failed to create trace flag', e.message);
  }
}

async function extendTrace(flagId) {
  try {
    const res = await sendToBackground({ type: 'EXTEND_TRACE_FLAG', orgUrl: state.selectedOrgUrl, traceFlagId: flagId, minutes: 60 });
    if (res.error) throw new Error(res.error);
    showToast('success', 'Trace extended', '+60 minutes');
    loadTraceFlagsForOrg();
  } catch (e) {
    showToast('error', 'Failed to extend', e.message);
  }
}

async function deleteTrace(flagId) {
  try {
    const res = await sendToBackground({ type: 'DELETE_TRACE_FLAG', orgUrl: state.selectedOrgUrl, traceFlagId: flagId });
    if (res.error) throw new Error(res.error);
    showToast('info', 'Trace flag deleted', '');
    loadTraceFlagsForOrg();
  } catch (e) {
    showToast('error', 'Failed to delete', e.message);
  }
}

async function loadTraceUsers() {
  // Pre-populate search
}

async function searchTraceUsers(e) {
  const q = e.target.value.trim();
  if (!q) { els.traceUserResults.classList.add('hidden'); return; }

  try {
    const org = state.orgs.find(o => o.orgUrl === state.selectedOrgUrl);
    if (!org || org.status !== 'connected') {
      els.traceUserResults.innerHTML = '<div class="autocomplete-item">Connect org first</div>';
      els.traceUserResults.classList.remove('hidden');
      return;
    }

    const res = await sendToBackground({
      type: 'SEARCH_USERS',
      orgUrl: state.selectedOrgUrl,
      query: q
    });
    if (res.error) throw new Error(res.error);
    const users = res.users || [];

    els.traceUserResults.innerHTML = '';
    if (!users.length) {
      els.traceUserResults.innerHTML = '<div class="autocomplete-item">No users found</div>';
    } else {
      users.forEach(u => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.innerHTML = `${escapeHtml(u.Name)}<small>${escapeHtml(u.Username)}</small>`;
        item.addEventListener('click', () => {
          els.traceUserSearch.value = u.Name;
          els.traceUserSearch.dataset.userId = u.Id;
          els.traceUserResults.classList.add('hidden');
        });
        els.traceUserResults.appendChild(item);
      });
    }
    els.traceUserResults.classList.remove('hidden');
  } catch (e) {
    els.traceUserResults.innerHTML = `<div class="autocomplete-item">${escapeHtml(e.message)}</div>`;
    els.traceUserResults.classList.remove('hidden');
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function applySettings() {
  const s = state.settings;
  $('#set-polling').value      = s.pollingInterval || 5000;
  $('#set-max-logs').value     = s.maxLogs || 100;
  $('#set-default-tab').value  = s.defaultTab || 'all';
  $('#set-font-size').value    = s.fontSize || 'sm';
  $('#set-notifications').checked = s.notifications !== false;
  $('#set-notify-errors').checked = s.notifyErrors !== false;
  $('#set-wrap-lines').checked = s.wrapLines === true;

  // Apply to body
  document.body.classList.toggle('wrap-lines', s.wrapLines === true);
  document.body.className = document.body.className.replace(/font-\w+/, '');
  document.body.classList.add(`font-${s.fontSize || 'sm'}`);
}

async function saveSettings() {
  const newSettings = {
    pollingInterval: parseInt($('#set-polling').value, 10),
    maxLogs:         parseInt($('#set-max-logs').value, 10),
    defaultTab:      $('#set-default-tab').value,
    fontSize:        $('#set-font-size').value,
    notifications:   $('#set-notifications').checked,
    notifyErrors:    $('#set-notify-errors').checked,
    wrapLines:       $('#set-wrap-lines').checked,
    theme:           state.settings.theme
  };
  state.settings = newSettings;
  await StorageService.saveSettings(newSettings);
  applySettings();
  els.settingsOverlay.classList.add('hidden');
  showToast('success', 'Settings saved', '');
}

async function resetSettings() {
  state.settings = { ...StorageService.DEFAULT_SETTINGS };
  await StorageService.saveSettings(state.settings);
  applySettings();
  showToast('info', 'Reset to defaults', '');
}

// ─── Theme ────────────────────────────────────────────────────────────────────
function toggleTheme() {
  const isDark = document.body.classList.contains('theme-dark');
  document.body.classList.toggle('theme-dark', !isDark);
  document.body.classList.toggle('theme-light', isDark);
  state.settings.theme = isDark ? 'light' : 'dark';
  StorageService.saveSettings(state.settings);
}

// ─── Auto Refresh ─────────────────────────────────────────────────────────────
function toggleAutoRefresh() {
  state.autoRefresh = !state.autoRefresh;
  els.autoRefreshBtn.classList.toggle('active', state.autoRefresh);
}

// ─── Copy / Download ──────────────────────────────────────────────────────────
async function copyLog() {
  const text = state.parsedLog?.raw || '';
  await navigator.clipboard.writeText(text).catch(() => {});
  showToast('success', 'Copied to clipboard', '');
}

function downloadLog() {
  const log = state.selectedLog;
  if (!log || !state.parsedLog) return;
  const blob = new Blob([state.parsedLog.raw], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ApexLog_${log.Operation || 'log'}_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('success', 'Log downloaded', '');
}

function openInSalesforce() {
  if (!state.selectedLog || !state.selectedOrgUrl) return;
  const url = `${state.selectedOrgUrl}/${state.selectedLog.Id}`;
  chrome.tabs.create({ url });
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function showDetailEmpty() {
  els.detailEmpty.classList.remove('hidden');
  els.detailContent.classList.add('hidden');
}

function showLogLoading() {
  els.logLoading.classList.remove('hidden');
  els.logBody.classList.add('hidden');
  const panel = els.logBodyWrap.querySelector('.structured-panel');
  if (panel) panel.remove();
}

function hideLogLoading() {
  els.logLoading.classList.add('hidden');
}

function showLogError(msg) {
  els.logBody.classList.remove('hidden');
  els.logBody.innerHTML = `<span class="line-error">Error loading log: ${escapeHtml(msg)}\n\nMake sure you are connected to the Salesforce org and have proper permissions.</span>`;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(type, title, msg) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-dot"></div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${msg ? `<div class="toast-msg">${escapeHtml(msg)}</div>` : ''}
    </div>`;
  els.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
