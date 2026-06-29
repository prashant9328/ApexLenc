/**
 * ApexLens — Component Modules
 * Reusable UI components for better architecture
 */

// ─── Log List Component ───────────────────────────────────────────────────────
export class LogListComponent {
  constructor(containerEl, onSelectLog) {
    this.container = containerEl;
    this.onSelect = onSelectLog;
    this.logs = [];
    this.rendered = new Set();
  }

  render(logs, selectedId = null) {
    this.logs = logs;

    if (!logs.length) {
      this.container.innerHTML = '';
      return;
    }

    const newIds = new Set(logs.map(l => l.Id));
    const added = [...newIds].filter(id => !this.rendered.has(id));

    // Detect if we should do partial or full render
    if (added.length > 0 && this.rendered.size > 0 && added.length < logs.length * 0.3) {
      // Prepend new cards
      added.forEach(id => {
        const log = logs.find(l => l.Id === id);
        if (log) {
          const card = this.createCard(log, true);
          this.container.insertBefore(card, this.container.firstChild);
        }
      });
      // Remove deleted
      this.rendered.forEach(id => {
        if (!newIds.has(id)) {
          const el = this.container.querySelector(`[data-log-id="${id}"]`);
          if (el) el.remove();
        }
      });
    } else {
      // Full render
      this.container.innerHTML = '';
      logs.forEach((log, idx) => {
        const card = this.createCard(log, false, idx);
        this.container.appendChild(card);
      });
    }

    // Update selection highlight
    this.container.querySelectorAll('[data-log-id]').forEach(el => {
      el.classList.toggle('selected', el.dataset.logId === selectedId);
    });

    this.rendered = newIds;
  }

  createCard(log, isNew = false, idx = 0) {
    const div = document.createElement('div');
    const status = this.getStatus(log);
    div.className = `log-card ${status.cls} ${isNew ? 'new-log' : ''}`;
    div.dataset.logId = log.Id;
    if (!isNew) div.style.animationDelay = `${Math.min(idx * 25, 300)}ms`;

    const title = log.Operation || log.Request || 'Apex Log';
    const user = log.LogUser?.Name || 'Unknown';
    const time = this.formatTime(log.LastModifiedDate);
    const size = this.formatSize(log.LogLength || 0);
    const duration = log.DurationMilliseconds ? `${log.DurationMilliseconds}ms` : '—';
    const pct = Math.min((log.LogLength || 0) / 52428800 * 100, 100);

    div.innerHTML = `
      <div class="log-card-top">
        <div class="log-card-title">${this.esc(title)}</div>
        <span class="log-status-badge ${status.badgeCls}">${status.label}</span>
      </div>
      <div class="log-card-meta">
        <span class="log-meta-item"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${this.esc(user)}</span>
        <span class="log-meta-item"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${time}</span>
        <span class="log-meta-item"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>${size}</span>
      </div>
      <div class="log-card-footer">
        <div class="log-size-bar"><div class="log-size-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <span class="log-duration">${duration}</span>
      </div>`;

    div.addEventListener('click', () => this.onSelect(log));
    return div;
  }

  getStatus(log) {
    const s = (log.Status || '').toLowerCase();
    if (s === 'success') return { cls: 'success', badgeCls: 'status-success', label: 'Success' };
    if (s === 'error' || s === 'failed') return { cls: 'error', badgeCls: 'status-error', label: 'Error' };
    return { cls: 'warning', badgeCls: 'status-warning', label: log.Status || 'Unknown' };
  }

  formatTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  formatSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

// ─── Org Selector Component ────────────────────────────────────────────────────
export class OrgSelectorComponent {
  constructor(containerEl, onSelectOrg, onConnectOrg, onDisconnectOrg) {
    this.container = containerEl;
    this.onSelect = onSelectOrg;
    this.onConnect = onConnectOrg;
    this.onDisconnect = onDisconnectOrg;
  }

  render(orgs, selectedOrgUrl = null) {
    this.container.innerHTML = '';

    if (!orgs.length) {
      this.container.innerHTML = `
        <div class="empty-state-small">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <p>Open a Salesforce org in any tab</p>
        </div>`;
      return;
    }

    orgs.forEach((org, idx) => {
      const card = document.createElement('div');
      card.className = `org-card ${org.status === 'connected' ? 'connected' : ''} ${selectedOrgUrl === org.orgUrl ? 'selected' : ''}`;
      card.style.animationDelay = `${idx * 40}ms`;

      const typeColor = { Production: '#10B981', Sandbox: '#F59E0B', Developer: '#7C3AED', Scratch: '#06B6D4' }[org.orgType] || '#94A3B8';
      const dotClass = { detected: 'dot-idle', connecting: 'dot-connecting', connected: 'dot-connected', error: 'dot-error' }[org.status] || 'dot-idle';
      const btnLabel = org.status === 'connected' ? 'Live' : org.status === 'connecting' ? '...' : 'Connect';
      const btnClass = org.status === 'connected' ? 'connected' : '';

      card.innerHTML = `
        <span class="status-dot ${dotClass}"></span>
        <div class="org-card-info">
          <div class="org-card-name" title="${org.orgUrl}">${this.esc(org.orgName)}</div>
          <div class="org-card-type" style="color:${typeColor}">${org.orgType}</div>
        </div>
        <button class="org-connect-btn ${btnClass}" data-org-url="${org.orgUrl}" data-tab-id="${org.tabId}">${btnLabel}</button>`;

      card.addEventListener('click', (e) => {
        if (!e.target.classList.contains('org-connect-btn')) {
          this.onSelect(org.orgUrl);
        }
      });

      const btn = card.querySelector('.org-connect-btn');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (org.status === 'connected') {
          this.onDisconnect(org.orgUrl);
        } else {
          this.onConnect(org.orgUrl, org.tabId);
        }
      });

      this.container.appendChild(card);
    });
  }

  esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

// ─── Governor Dashboard Component ──────────────────────────────────────────────
export class GovernorDashboardComponent {
  constructor(containerEl) {
    this.container = containerEl;
  }

  render(limits) {
    if (!limits) return;

    this.container.innerHTML = '';

    const cards = [
      { key: 'soqlQueries', label: 'SOQL Queries', icon: '🔍' },
      { key: 'soqlRows', label: 'Query Rows', icon: '📋' },
      { key: 'dmlStatements', label: 'DML Statements', icon: '✏️' },
      { key: 'dmlRows', label: 'DML Rows', icon: '📝' },
      { key: 'cpuTime', label: 'CPU Time', icon: '⚡' },
      { key: 'heapSize', label: 'Heap Size', icon: '💾' },
      { key: 'callouts', label: 'Callouts', icon: '🌐' },
      { key: 'emailInvocations', label: 'Emails', icon: '📧' },
      { key: 'queueableJobs', label: 'Queueable', icon: '⏳' },
      { key: 'futureCalls', label: 'Future Calls', icon: '🔮' }
    ];

    cards.forEach((def, idx) => {
      const data = limits[def.key] || { used: 0, max: 0 };
      const pct = data.max > 0 ? Math.round((data.used / data.max) * 100) : 0;
      const status = pct >= 90 ? 'critical' : pct >= 75 ? 'warning' : 'ok';

      const card = document.createElement('div');
      card.className = `governor-card ${status}`;
      card.style.animationDelay = `${idx * 40}ms`;

      card.innerHTML = `
        <div class="governor-card-top">
          <div class="governor-label"><span>${def.icon}</span>${def.label}</div>
          <div class="governor-values">
            <span class="gov-used">${data.used}</span>
            <span class="gov-sep">/</span>
            <span class="gov-max">${data.max || '—'}</span>
          </div>
        </div>
        <div class="governor-bar">
          <div class="governor-fill" style="width: 0%" data-target="${pct}"></div>
        </div>
        <div class="gov-pct">${data.max > 0 ? pct + '%' : 'No data'}</div>`;

      this.container.appendChild(card);

      // Animate
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const fill = card.querySelector('.governor-fill');
          if (fill) fill.style.width = `${pct}%`;
        });
      });
    });
  }
}

// ─── Filter Component ─────────────────────────────────────────────────────────
export class FilterComponent {
  constructor(containerEl, onFilterChange) {
    this.container = containerEl;
    this.onChange = onFilterChange;
    this.active = 'all';
  }

  render() {
    const filters = [
      'all', 'success', 'error', 'warning', 'trigger', 'batch', 'flow', 'queueable', 'future', 'platform'
    ];

    this.container.innerHTML = '';
    filters.forEach(f => {
      const btn = document.createElement('button');
      btn.className = `filter-btn ${f === 'all' ? 'active' : ''}`;
      btn.dataset.filter = f;
      btn.textContent = f.charAt(0).toUpperCase() + f.slice(1);

      if (f === 'success') btn.classList.add('success');
      else if (f === 'error') btn.classList.add('error');
      else if (f === 'warning') btn.classList.add('warning');

      btn.addEventListener('click', () => {
        this.container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.active = f;
        this.onChange(f);
      });

      this.container.appendChild(btn);
    });
  }

  getActive() {
    return this.active;
  }
}

// ─── Log Viewer Component ─────────────────────────────────────────────────────
export class LogViewerComponent {
  constructor(containerEl) {
    this.container = containerEl;
    this.currentLog = null;
    this.currentTab = 'all';
  }

  render(log, logBody, parsedLog, tab = 'all') {
    this.currentLog = log;
    this.currentTab = tab;

    if (!log || !logBody) {
      this.container.innerHTML = '<div class="log-loading"><div class="spinner"></div>Loading…</div>';
      return;
    }

    const rendered = this.renderTab(logBody, parsedLog, tab);
    this.container.innerHTML = rendered;
  }

  renderTab(body, parsed, tab) {
    if (!parsed) return this.syntaxHighlight(body);

    switch (tab) {
      case 'errors':
        return this.renderStructured(parsed.errors, 'error');
      case 'debug':
        return this.renderStructured(parsed.debugStatements, 'debug');
      case 'soql':
        return this.renderStructured(parsed.soqlQueries, 'soql');
      case 'dml':
        return this.renderStructured(parsed.dmlOperations, 'dml');
      case 'flow':
        return this.renderStructured(parsed.flowExecutions, 'flow');
      case 'callouts':
        return this.renderStructured(parsed.callouts, 'callout');
      default:
        return this.syntaxHighlight(body);
    }
  }

  syntaxHighlight(raw) {
    const lines = raw.split('\n');
    return lines.map(line => {
      const esc = this.esc(line);
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

  renderStructured(items, type) {
    if (!items || !items.length) {
      return `<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:12px">No ${type} entries</div>`;
    }

    let html = '';
    items.forEach((item, idx) => {
      html += this.buildStructuredItem(item, type);
    });
    return `<div class="structured-panel">${html}</div>`;
  }

  buildStructuredItem(item, type) {
    let card = '<div class="structured-item">';
    switch (type) {
      case 'error':
        card += `
          <div class="si-header">
            <span class="si-type error">${item.severity === 'fatal' ? 'FATAL' : 'ERROR'}</span>
            <span class="si-badge">L${item.lineNum || '?'}</span>
          </div>
          <div class="si-body">${this.esc(item.message || '')}</div>`;
        break;
      case 'debug':
        card += `
          <div class="si-header">
            <span class="si-type debug">DEBUG</span>
            <span class="si-badge">${item.timestamp || ''}</span>
          </div>
          <div class="si-body">${this.esc(item.message || '')}</div>`;
        break;
      case 'soql':
        card += `
          <div class="si-header">
            <span class="si-type soql">SOQL</span>
            <span class="si-badge ${(item.rows || 0) > 1000 ? 'highlight' : ''}">${item.rows || 0} rows</span>
          </div>
          <div class="si-body">${this.esc(item.query || '')}</div>`;
        break;
      case 'dml':
        card += `
          <div class="si-header">
            <span class="si-type dml">${item.operation || 'DML'}</span>
            <span class="si-badge">${item.objectName || ''} × ${item.rows || 0}</span>
          </div>`;
        break;
      case 'flow':
        card += `
          <div class="si-header">
            <span class="si-type flow">${item.type === 'start' ? 'START' : 'END'}</span>
            <span class="si-badge">${item.timestamp || ''}</span>
          </div>
          <div class="si-body">${this.esc(item.name || '')}</div>`;
        break;
      case 'callout':
        card += `
          <div class="si-header">
            <span class="si-type callout">HTTP</span>
          </div>
          <div class="si-body">${this.esc((item.details || '') + '\n' + (item.response || ''))}</div>`;
        break;
    }
    card += '</div>';
    return card;
  }

  esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
