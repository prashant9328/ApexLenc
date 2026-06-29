/**
 * ApexLens - Salesforce API Service
 * Handles all Salesforce REST API calls using the active browser session
 */

export class SalesforceAPI {
  constructor(orgUrl, tabId) {
    this.orgUrl = orgUrl;
    this.tabId = tabId;
    this.apiVersion = 'v59.0';
    this.baseUrl = `${orgUrl}/services/data/${this.getVersionPath()}`;
  }

  getVersionPath() {
    return this.apiVersion.startsWith('v') ? this.apiVersion : `v${this.apiVersion}`;
  }

  // ─── Core Request ──────────────────────────────────────────────────────────
  async request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;

    // Use chrome.cookies to get session - more reliable than content script
    const cookies = await this.getSessionCookies();

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers
    };

    if (cookies.sid) {
      headers['Authorization'] = `Bearer ${cookies.sid}`;
    }

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'include'
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errors = JSON.parse(errorText);
        if (Array.isArray(errors) && errors[0]?.message) {
          errorMsg = errors[0].message;
        }
      } catch {}
      throw new Error(errorMsg);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  async getSessionCookies() {
    const cookies = {};
    try {
      const allCookies = await chrome.cookies.getAll({ domain: new URL(this.orgUrl).hostname });
      allCookies.forEach(c => {
        cookies[c.name] = c.value;
        if (c.name === 'sid') cookies.sid = c.value;
      });
    } catch (e) {
      console.warn('[ApexLens] Could not get cookies:', e);
    }
    return cookies;
  }

  // ─── Identity ──────────────────────────────────────────────────────────────
  async getIdentity() {
    return this.request('/chatter/users/me');
  }

  async getOrgInfo() {
    const query = "SELECT Id, Name, InstanceName, OrganizationType FROM Organization LIMIT 1";
    const result = await this.query(query);
    return result.records?.[0] || null;
  }

  // ─── SOQL Query ───────────────────────────────────────────────────────────
  async query(soql) {
    const encoded = encodeURIComponent(soql);
    return this.request(`/query?q=${encoded}`);
  }

  async queryAll(soql) {
    const encoded = encodeURIComponent(soql);
    return this.request(`/queryAll?q=${encoded}`);
  }

  async toolingRequest(endpoint, options = {}) {
    return this.request(`/tooling${endpoint}`, options);
  }

  async toolingQuery(soql) {
    const encoded = encodeURIComponent(soql);
    return this.toolingRequest(`/query?q=${encoded}`);
  }

  // ─── Apex Logs ────────────────────────────────────────────────────────────
  async getApexLogs(limit = 50) {
    const soql = `
      SELECT Id, LogUser.Name, LogLength, LastModifiedDate,
             Request, Status, DurationMilliseconds, Application,
             Location, Operation
      FROM ApexLog
      ORDER BY LastModifiedDate DESC
      LIMIT ${limit}
    `;
    const result = await this.query(soql);
    return result.records || [];
  }

  async getLogsSince(timestamp, limit = 20) {
    const iso = new Date(timestamp).toISOString();
    const soql = `
      SELECT Id, LogUser.Name, LogLength, LastModifiedDate,
             Request, Status, DurationMilliseconds, Application,
             Location, Operation
      FROM ApexLog
      WHERE LastModifiedDate > ${iso}
      ORDER BY LastModifiedDate DESC
      LIMIT ${limit}
    `;
    const result = await this.query(soql);
    return result.records || [];
  }

  async getLogBody(logId) {
    const cookies = await this.getSessionCookies();
    const response = await fetch(`${this.orgUrl}/services/data/${this.getVersionPath()}/sobjects/ApexLog/${logId}/Body`, {
      credentials: 'include', 
        headers: {
                'Accept': 'text/plain',
                'Authorization': `Bearer ${cookies.sid}`
            }
    });
    if (!response.ok) throw new Error(`Failed to fetch log body: ${response.status}`);
    return response.text();
  }

  async deleteLog(logId) {
    return this.request(`/sobjects/ApexLog/${logId}`, { method: 'DELETE' });
  }

  async deleteAllLogs() {
    const logs = await this.getApexLogs(200);
    const promises = logs.map(l => this.deleteLog(l.Id).catch(() => {}));
    return Promise.allSettled(promises);
  }

  // ─── Trace Flags ──────────────────────────────────────────────────────────
  async getTraceFlags() {
    try {
      const soql = `
        SELECT Id, LogType, StartDate, ExpirationDate, DebugLevel.DeveloperName,
               DebugLevel.ApexCode, TracedEntityId, TracedEntity.Name
        FROM TraceFlag
        WHERE ExpirationDate > ${new Date().toISOString()}
        ORDER BY ExpirationDate DESC
      `;
      const result = await this.toolingQuery(soql);
      return result.records || [];
    } catch (e) {
      console.warn('[ApexLens] TraceFlag relationship query failed, trying minimal Tooling query:', e.message);
      try {
        const flags = await this.getTraceFlagsViaTooling();
        return this.addTraceEntityNames(flags);
      } catch (toolingError) {
        console.warn('[ApexLens] Minimal Tooling API TraceFlag query also failed:', toolingError.message);
        return [];
      }
    }
  }

  async getTraceFlagsViaTooling() {
    const query = `
      SELECT Id, TracedEntityId, StartDate, ExpirationDate, LogType, DebugLevelId
      FROM TraceFlag
      WHERE ExpirationDate > ${new Date().toISOString()}
      ORDER BY ExpirationDate DESC
    `;
    const data = await this.toolingQuery(query);
    return data.records || [];
  }

  async addTraceEntityNames(flags) {
    const userIds = flags
      .map(f => f.TracedEntityId)
      .filter(id => id && id.startsWith('005'));

    if (userIds.length === 0) return flags;

    const quotedIds = [...new Set(userIds)].map(id => `'${id}'`).join(',');
    const users = await this.query(`SELECT Id, Name FROM User WHERE Id IN (${quotedIds})`);
    const names = new Map((users.records || []).map(u => [u.Id, u.Name]));

    return flags.map(flag => ({
      ...flag,
      TracedEntity: flag.TracedEntity || { Name: names.get(flag.TracedEntityId) || flag.TracedEntityId }
    }));
  }

  async getDebugLevels() {
    const soql = "SELECT Id, DeveloperName, ApexCode, Workflow, Callout, System, Database FROM DebugLevel ORDER BY DeveloperName";
    const result = await this.toolingQuery(soql);
    return result.records || [];
  }

  async createDebugLevel(name) {
    return this.toolingRequest('/sobjects/DebugLevel', {
      method: 'POST',
      body: {
        DeveloperName: name,
        MasterLabel: name,
        ApexCode: 'DEBUG',
        ApexProfiling: 'INFO',
        Callout: 'INFO',
        Database: 'INFO',
        System: 'DEBUG',
        Validation: 'INFO',
        Visualforce: 'INFO',
        Wave: 'INFO',
        Workflow: 'INFO'
      }
    });
  }

  async createTraceFlag(tracedEntityId, durationMinutes = 60, logType = 'USER_DEBUG') {
    // Get or create debug level
    let debugLevels = await this.getDebugLevels();
    let debugLevelId;

    const existingDebugLevel = debugLevels.find(d => d.DeveloperName === 'ApexLens_Debug');
    if (existingDebugLevel) {
      debugLevelId = existingDebugLevel.Id;
    } else {
      const newLevel = await this.createDebugLevel('ApexLens_Debug');
      debugLevelId = newLevel.id;
    }

    const start = new Date();
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    const existingTraceFlag = await this.findActiveTraceFlag(tracedEntityId, logType);

    if (existingTraceFlag) {
      await this.deleteTraceFlag(existingTraceFlag.Id);
    }

    return this.toolingRequest('/sobjects/TraceFlag', {
      method: 'POST',
      body: {
        DebugLevelId: debugLevelId,
        LogType: logType,
        StartDate: start.toISOString(),
        ExpirationDate: end.toISOString(),
        TracedEntityId: tracedEntityId
      }
    });
  }

  async findActiveTraceFlag(tracedEntityId, logType = 'USER_DEBUG') {
    const soql = `
      SELECT Id
      FROM TraceFlag
      WHERE TracedEntityId = '${tracedEntityId}'
      AND LogType = '${logType}'
      AND ExpirationDate > ${new Date().toISOString()}
      ORDER BY ExpirationDate DESC
      LIMIT 1
    `;
    const result = await this.toolingQuery(soql);
    return result.records?.[0] || null;
  }

  async deleteTraceFlag(traceFlagId) {
    return this.toolingRequest(`/sobjects/TraceFlag/${traceFlagId}`, { method: 'DELETE' });
  }

  async extendTraceFlag(traceFlagId, minutes = 60) {
    const newExpiration = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    return this.toolingRequest(`/sobjects/TraceFlag/${traceFlagId}`, {
      method: 'PATCH',
      body: { ExpirationDate: newExpiration }
    });
  }

  // ─── Users (for trace flag target) ────────────────────────────────────────
  async getUsers(search = '') {
    const safeSearch = search.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const soql = `
      SELECT Id, Name, Username, IsActive
      FROM User
      WHERE IsActive = true
      ${safeSearch ? `AND (Name LIKE '%${safeSearch}%' OR Username LIKE '%${safeSearch}%')` : ''}
      ORDER BY Name
      LIMIT 20
    `;
    const result = await this.query(soql);
    return result.records || [];
  }

  // ─── API Version Detection ─────────────────────────────────────────────────
  async detectApiVersion() {
    const versions = await fetch(`${this.orgUrl}/services/data/`, { credentials: 'include' }).then(r => r.json()).catch(() => []);
    if (versions.length > 0) {
      this.apiVersion = versions[versions.length - 1].version;
      this.baseUrl = `${this.orgUrl}/services/data/${this.getVersionPath()}`;
    }
    return this.apiVersion;
  }
}
