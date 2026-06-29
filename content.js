/**
 * ApexLens - Content Script
 * Injected into Salesforce pages to extract session info and org details
 */

(function () {
  'use strict';

  // Extract Salesforce session and org info from the page context
  function extractSalesforceContext() {
    try {
      // Try to get session info from various SF global objects
      const context = {
        url: window.location.href,
        hostname: window.location.hostname,
        orgId: null,
        userId: null,
        sessionId: null,
        apiVersion: null
      };

      // Try window.sfdcSiteSettings or similar globals
      if (window.UserContext) {
        context.orgId = window.UserContext.orgId;
        context.userId = window.UserContext.userId;
      }

      // Try meta tags (Lightning Experience)
      const metas = document.querySelectorAll('meta');
      metas.forEach(meta => {
        const name = meta.getAttribute('name');
        if (name === 'salesforceSessionId') context.sessionId = meta.getAttribute('content');
        if (name === 'salesforceOrgId') context.orgId = meta.getAttribute('content');
      });

      // Try extracting from scripts
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const content = script.textContent || '';
        const sessionMatch = content.match(/"sessionId"\s*:\s*"([^"]+)"/);
        if (sessionMatch) { context.sessionId = sessionMatch[1]; break; }
      }

      return context;
    } catch (e) {
      return null;
    }
  }

  // Listen for messages from background/sidepanel
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_SF_CONTEXT') {
      const ctx = extractSalesforceContext();
      sendResponse({ context: ctx });
    }
    return true;
  });

  // Notify background that this SF page is loaded
  chrome.runtime.sendMessage({
    type: 'SF_PAGE_LOADED',
    url: window.location.href,
    title: document.title
  }).catch(() => {}); // Ignore if background not ready

})();
