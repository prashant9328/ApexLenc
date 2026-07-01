/**
 * ApexLens - Storage Service
 * Manages extension settings and log cache in chrome.storage
 */

export class StorageService {
  static DEFAULT_SETTINGS = {
    pollingInterval: 5000,
    theme: 'dark',
    autoRefresh: true,
    maxLogs: 100,
    defaultTab: 'all',
    notifications: true,
    notifyErrors: true,
    notifyNew: true,
    fontSize: 'sm',
    wrapLines: false,
    aiEnabled: true,
    aiApiKey: '',
    aiModel: 'llama-3.1-8b-instant'
  };

  static async getSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get(['settings'], (data) => {
        resolve({ ...this.DEFAULT_SETTINGS, ...(data.settings || {}) });
      });
    });
  }

  static async saveSettings(settings) {
    return new Promise(resolve => {
      chrome.storage.local.set({ settings }, resolve);
    });
  }

  static async getCachedLogs(orgUrl) {
    return new Promise(resolve => {
      const key = `logs_${btoa(orgUrl)}`;
      chrome.storage.local.get([key], (data) => {
        resolve(data[key] || []);
      });
    });
  }

  static async saveCachedLogs(orgUrl, logs) {
    return new Promise(resolve => {
      const key = `logs_${btoa(orgUrl)}`;
      chrome.storage.local.set({ [key]: logs }, resolve);
    });
  }

  static async clearLogs(orgUrl) {
    return new Promise(resolve => {
      const key = `logs_${btoa(orgUrl)}`;
      chrome.storage.local.remove([key], resolve);
    });
  }
}
