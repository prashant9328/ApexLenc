/**
 * ApexLens - Background Service Worker
 * Handles tab detection, org management, polling orchestration, and messaging
 */

import { SalesforceAPI } from './services/salesforce-api.js';
import { PollingService } from './services/polling.js';
import { StorageService } from './services/storage.js';

// ─── State ────────────────────────────────────────────────────────────────────
const detectedOrgs = new Map(); // tabId → orgInfo
const pollingServices = new Map(); // orgUrl → PollingService
let activeSidePanelPort = null;

// ─── Salesforce URL Detection ─────────────────────────────────────────────────
const SF_PATTERNS = [
  /^https:\/\/[^.]+\.lightning\.force\.com/,
  /^https:\/\/[^.]+\.my\.salesforce\.com/,
  /^https:\/\/[^.]+\.sandbox\.my\.salesforce\.com/,
  /^https:\/\/[^.]+\.develop\.my\.salesforce\.com/
];

function isSalesforceUrl(url) {
  return SF_PATTERNS.some(p => p.test(url));
}

function extractOrgInfo(url, tabTitle) {
  try {
    const u = new URL(url);
    const orgUrl = `${u.protocol}//${u.hostname}`;
    const hostParts = u.hostname.split('.');
    let orgName = hostParts[0];

    // Detect org type
    let orgType = 'Production';
    if (u.hostname.includes('sandbox')) orgType = 'Sandbox';
    else if (u.hostname.includes('develop')) orgType = 'Developer';
    else if (u.hostname.includes('scratch')) orgType = 'Scratch';

    // Try to get a nice name from title
    if (tabTitle && tabTitle !== 'New Tab') {
      const titleParts = tabTitle.split('|');
      if (titleParts.length > 1) orgName = titleParts[titleParts.length - 1].trim();
    }

    return { orgUrl, orgName, orgType, hostname: u.hostname };
  } catch {
    return null;
  }
}

// ─── Tab Listeners ────────────────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  if (isSalesforceUrl(tab.url)) {
    const orgInfo = extractOrgInfo(tab.url, tab.title);
    if (orgInfo) {
      orgInfo.tabId = tabId;
      orgInfo.favicon = tab.favIconUrl;
      orgInfo.connectedAt = null;
      orgInfo.status = 'detected';
      detectedOrgs.set(tabId, orgInfo);
      broadcastToPanel({ type: 'ORGS_UPDATED', orgs: getOrgsArray() });
    }
  } else {
    if (detectedOrgs.has(tabId)) {
      const org = detectedOrgs.get(tabId);
      stopPolling(org.orgUrl);
      detectedOrgs.delete(tabId);
      broadcastToPanel({ type: 'ORGS_UPDATED', orgs: getOrgsArray() });
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (detectedOrgs.has(tabId)) {
    const org = detectedOrgs.get(tabId);
    stopPolling(org.orgUrl);
    detectedOrgs.delete(tabId);
    broadcastToPanel({ type: 'ORGS_UPDATED', orgs: getOrgsArray() });
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url) return;
  if (isSalesforceUrl(tab.url) && !detectedOrgs.has(tabId)) {
    const orgInfo = extractOrgInfo(tab.url, tab.title);
    if (orgInfo) {
      orgInfo.tabId = tabId;
      orgInfo.status = 'detected';
      detectedOrgs.set(tabId, orgInfo);
      broadcastToPanel({ type: 'ORGS_UPDATED', orgs: getOrgsArray() });
    }
  }
});

// ─── Side Panel Action ────────────────────────────────────────────────────────
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
  await chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: 'sidepanel.html',
    enabled: true
  });
});

// ─── Message Handling ─────────────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidepanel') {
    activeSidePanelPort = port;
    port.onMessage.addListener(handlePanelMessage);
    port.onDisconnect.addListener(() => {
      activeSidePanelPort = null;
    });
    // Send current state immediately
    port.postMessage({ type: 'ORGS_UPDATED', orgs: getOrgsArray() });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleRuntimeMessage(message, sender, sendResponse);
  return true;
});

async function handleRuntimeMessage(message, sender, sendResponse) {
  switch (message.type) {
    case 'GET_ORGS':
      sendResponse({ orgs: getOrgsArray() });
      break;

    case 'CONNECT_ORG':
      await connectOrg(message.orgUrl, message.tabId, sendResponse);
      break;

    case 'DISCONNECT_ORG':
      stopPolling(message.orgUrl);
      updateOrgStatus(message.orgUrl, 'detected');
      broadcastToPanel({ type: 'ORGS_UPDATED', orgs: getOrgsArray() });
      sendResponse({ success: true });
      break;

    case 'GET_SETTINGS':
      const settings = await StorageService.getSettings();
      sendResponse({ settings });
      break;

    case 'SAVE_SETTINGS':
      await StorageService.saveSettings(message.settings);
      sendResponse({ success: true });
      break;

    case 'CREATE_TRACE_FLAG':
      await handleTraceFlag(message, sendResponse);
      break;

    case 'DELETE_TRACE_FLAG':
      await handleDeleteTraceFlag(message, sendResponse);
      break;

    case 'EXTEND_TRACE_FLAG':
      await handleExtendTraceFlag(message, sendResponse);
      break;

    case 'GET_TRACE_FLAGS':
      await handleGetTraceFlags(message, sendResponse);
      break;

    case 'SEARCH_USERS':
      await handleSearchUsers(message, sendResponse);
      break;

    case 'FETCH_LOG_BODY':
      await handleFetchLogBody(message, sendResponse);
      break;

    default:
      sendResponse({ error: 'Unknown message type' });
  }
}

async function handlePanelMessage(message) {
  // Re-use runtime message handler for port messages
  handleRuntimeMessage(message, null, (response) => {
    if (activeSidePanelPort) {
      activeSidePanelPort.postMessage({ ...response, requestId: message.requestId });
    }
  });
}

// ─── Org Connection ───────────────────────────────────────────────────────────
async function connectOrg(orgUrl, tabId, sendResponse) {
  try {
    updateOrgStatus(orgUrl, 'connecting');
    broadcastToPanel({ type: 'ORGS_UPDATED', orgs: getOrgsArray() });

    const api = new SalesforceAPI(orgUrl, tabId);
    await api.detectApiVersion().catch(() => {});
    const identity = await api.getIdentity();

    updateOrgStatus(orgUrl, 'connected', { userId: identity.user_id, username: identity.username });
    await ensureCurrentUserTraceFlag(api, identity.user_id);

    const settings = await StorageService.getSettings();
    const polling = new PollingService(api, settings.pollingInterval || 5000);

    polling.onNewLogs((logs) => {
      broadcastToPanel({ type: 'NEW_LOGS', orgUrl, logs });
      // Show notification for errors
      logs.forEach(log => {
        if (log.Status === 'Error' || log.Operation?.includes('Error')) {
          showNotification(`${log.Operation || 'Apex Log'} Failed`, log.LogUser?.Name || 'Unknown User');
        }
      });
    });

    polling.onError((err) => {
      console.error('[ApexLens] Polling error:', err);
      updateOrgStatus(orgUrl, 'error');
      broadcastToPanel({ type: 'ORGS_UPDATED', orgs: getOrgsArray() });
    });

    pollingServices.set(orgUrl, polling);
    polling.start();

    sendResponse && sendResponse({ success: true, identity });
    broadcastToPanel({ type: 'ORGS_UPDATED', orgs: getOrgsArray() });
  } catch (err) {
    console.error('[ApexLens] Connect error:', err);
    updateOrgStatus(orgUrl, 'error');
    broadcastToPanel({ type: 'ORGS_UPDATED', orgs: getOrgsArray() });
    sendResponse && sendResponse({ error: err.message });
  }
}

// ─── Polling Control ──────────────────────────────────────────────────────────
function stopPolling(orgUrl) {
  const polling = pollingServices.get(orgUrl);
  if (polling) {
    polling.stop();
    pollingServices.delete(orgUrl);
  }
}

// ─── Trace Flag Handlers ──────────────────────────────────────────────────────
async function ensureCurrentUserTraceFlag(api, userId) {
  if (!userId) return;

  try {
    const flags = await api.getTraceFlags();
    const hasActiveUserFlag = flags.some(flag =>
      flag.TracedEntityId === userId &&
      new Date(flag.ExpirationDate).getTime() > Date.now()
    );

    if (!hasActiveUserFlag) {
      await api.createTraceFlag(userId, 60, 'USER_DEBUG');
    }
  } catch (err) {
    console.warn('[ApexLens] Could not ensure current user trace flag:', err.message);
  }
}

async function handleTraceFlag(message, sendResponse) {
  try {
    const org = getOrgByUrl(message.orgUrl);
    if (!org) return sendResponse({ error: 'Org not connected' });
    const api = new SalesforceAPI(message.orgUrl, org.tabId);
    const result = await api.createTraceFlag(message.userId, message.duration, message.traceType);
    sendResponse({ success: true, result });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function handleDeleteTraceFlag(message, sendResponse) {
  try {
    const org = getOrgByUrl(message.orgUrl);
    if (!org) return sendResponse({ error: 'Org not connected' });
    const api = new SalesforceAPI(message.orgUrl, org.tabId);
    await api.deleteTraceFlag(message.traceFlagId);
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function handleExtendTraceFlag(message, sendResponse) {
  try {
    const org = getOrgByUrl(message.orgUrl);
    if (!org) return sendResponse({ error: 'Org not connected' });
    const api = new SalesforceAPI(message.orgUrl, org.tabId);
    const result = await api.extendTraceFlag(message.traceFlagId, message.minutes);
    sendResponse({ success: true, result });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function handleGetTraceFlags(message, sendResponse) {
  try {
    const org = getOrgByUrl(message.orgUrl);
    if (!org) return sendResponse({ error: 'Org not connected' });
    const api = new SalesforceAPI(message.orgUrl, org.tabId);
    const flags = await api.getTraceFlags();
    sendResponse({ success: true, flags });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function handleSearchUsers(message, sendResponse) {
  try {
    const org = getOrgByUrl(message.orgUrl);
    if (!org) return sendResponse({ error: 'Org not connected' });
    const api = new SalesforceAPI(message.orgUrl, org.tabId);
    const users = await api.getUsers(message.query || '');
    sendResponse({ success: true, users });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function handleFetchLogBody(message, sendResponse) {
  try {
    const org = getOrgByUrl(message.orgUrl);
    if (!org) return sendResponse({ error: 'Org not connected' });
    const api = new SalesforceAPI(message.orgUrl, org.tabId);
    const body = await api.getLogBody(message.logId);
    sendResponse({ success: true, body });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getOrgsArray() {
  return Array.from(detectedOrgs.values());
}

function getOrgByUrl(orgUrl) {
  for (const org of detectedOrgs.values()) {
    if (org.orgUrl === orgUrl) return org;
  }
  return null;
}

function updateOrgStatus(orgUrl, status, extra = {}) {
  for (const [tabId, org] of detectedOrgs.entries()) {
    if (org.orgUrl === orgUrl) {
      detectedOrgs.set(tabId, { ...org, status, ...extra });
      if (status === 'connected') {
        detectedOrgs.get(tabId).connectedAt = Date.now();
      }
      break;
    }
  }
}

function broadcastToPanel(message) {
  if (activeSidePanelPort) {
    try {
      activeSidePanelPort.postMessage(message);
    } catch (e) {
      activeSidePanelPort = null;
    }
  }
}

function showNotification(title, message) {
  chrome.storage.local.get(['settings'], (data) => {
    const settings = data.settings || {};
    if (settings.notifications === false) return;
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'assets/icon48.png',
      title: `🔴 ApexLens: ${title}`,
      message,
      priority: 1
    });
  });
}

// ─── Init: Scan existing tabs ─────────────────────────────────────────────────
(async () => {
  const tabs = await chrome.tabs.query({ url: ['*://*.lightning.force.com/*', '*://*.my.salesforce.com/*'] });
  tabs.forEach(tab => {
    if (tab.url && isSalesforceUrl(tab.url)) {
      const orgInfo = extractOrgInfo(tab.url, tab.title);
      if (orgInfo) {
        orgInfo.tabId = tab.id;
        orgInfo.status = 'detected';
        detectedOrgs.set(tab.id, orgInfo);
      }
    }
  });
})();
