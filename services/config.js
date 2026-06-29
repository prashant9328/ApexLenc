/**
 * ApexLens — Configuration Schema
 * Centralized settings, defaults, and validation
 */

export const CONFIG = {
  /**
   * App Metadata
   */
  app: {
    name: 'ApexLens',
    version: '1.0.0',
    author: 'ApexLens Contributors',
    homepage: 'https://github.com/yourusername/ApexLens',
    license: 'MIT',
    description: 'Real-time Salesforce Apex log monitoring in Chrome'
  },

  /**
   * Feature Flags
   */
  features: {
    bookmarks: true,
    comparison: true,
    performanceTracking: true,
    aiIntegration: false, // Will be enabled in v2.0
    customThemes: false, // Coming in v1.1
    exportToSplunk: false, // Coming in v1.2
  },

  /**
   * Polling Configuration
   */
  polling: {
    minInterval: 2000,      // 2 seconds
    maxInterval: 30000,     // 30 seconds
    defaultInterval: 5000,  // 5 seconds (recommended)
    timeout: 15000,         // 15 second API timeout
    retryAttempts: 3,
    retryBackoff: 1.5,      // Exponential backoff multiplier
  },

  /**
   * Storage Configuration
   */
  storage: {
    maxLogsInMemory: 100,
    maxLogsMax: 500,
    bookmarkLimit: 100,
    cacheTTL: 86400000,     // 24 hours in milliseconds
    logBodyMaxSize: 52428800, // 50MB
  },

  /**
   * UI Configuration
   */
  ui: {
    theme: {
      options: ['dark', 'light', 'auto'],
      default: 'dark',
    },
    fontSize: {
      options: ['xs', 'sm', 'md', 'lg'],
      default: 'sm',
      sizes: {
        xs: '10px',
        sm: '11px',
        md: '12.5px',
        lg: '14px',
      }
    },
    animations: {
      enabled: true,
      duration: 200, // milliseconds
    },
    sidePanel: {
      defaultWidth: 320, // pixels
      minWidth: 280,
      maxWidth: 600,
    }
  },

  /**
   * Salesforce Configuration
   */
  salesforce: {
    apiVersion: 'v59.0',
    supportedOrgTypes: [
      'Production',
      'Sandbox',
      'Developer',
      'Scratch'
    ],
    urlPatterns: [
      /^https:\/\/[^.]+\.lightning\.force\.com/,
      /^https:\/\/[^.]+\.my\.salesforce\.com/,
      /^https:\/\/[^.]+\.sandbox\.my\.salesforce\.com/,
      /^https:\/\/[^.]+\.develop\.my\.salesforce\.com/,
    ],
    traceFlag: {
      minDuration: 1,         // 1 minute
      maxDuration: 480,       // 8 hours (Salesforce limit)
      defaultDuration: 60,    // 60 minutes
    },
    limits: {
      soqlQueries: 100,
      soqlRows: 50000,
      dmlStatements: 150,
      dmlRows: 10000,
      cpuTime: 10000,         // milliseconds
      heapSize: 6291456,      // 6MB
      callouts: 100,
      emailInvocations: 5,
      queueableJobs: 1,
      futureCalls: 50,
    }
  },

  /**
   * Log Analysis Thresholds
   */
  analysis: {
    performanceScore: {
      excellent: 90,
      good: 75,
      fair: 50,
      poor: 0,
    },
    warningThresholds: {
      cpuPercentage: 75,
      heapPercentage: 75,
      soqlPercentage: 80,
      dmlPercentage: 80,
      queryRowLimit: 1000,
      methodCallLimit: 50,
      queryCount: 50,
    },
    criticalThresholds: {
      cpuPercentage: 90,
      heapPercentage: 90,
      soqlPercentage: 95,
      dmlPercentage: 95,
    }
  },

  /**
   * Color Palette (CSS Variables)
   */
  colors: {
    dark: {
      bgBase: '#0A0B0E',
      bgSurface: '#111318',
      bgElevated: '#181B22',
      textPrimary: '#E2E8F0',
      textSecondary: '#94A3B8',
      textMuted: '#475569',
      success: '#10B981',
      warning: '#F59E0B',
      error: '#EF4444',
      info: '#3B82F6',
      accentPurple: '#7C3AED',
      accentCyan: '#06B6D4',
    },
    light: {
      bgBase: '#F1F5F9',
      bgSurface: '#FFFFFF',
      bgElevated: '#F8FAFC',
      textPrimary: '#0F172A',
      textSecondary: '#475569',
      textMuted: '#94A3B8',
      success: '#059669',
      warning: '#D97706',
      error: '#DC2626',
      info: '#2563EB',
      accentPurple: '#6D28D9',
      accentCyan: '#0891B2',
    }
  },

  /**
   * Keyboard Shortcuts
   */
  shortcuts: {
    search: {
      key: 'k',
      modifiers: ['meta', 'ctrl'], // Cmd+K or Ctrl+K
      description: 'Focus global search'
    },
    closeModal: {
      key: 'Escape',
      description: 'Close settings or modal'
    },
    focusLogList: {
      key: 'j',
      modifiers: ['meta'], // Cmd+J
      description: 'Focus log list'
    },
    focusDetail: {
      key: 'l',
      modifiers: ['meta'], // Cmd+L
      description: 'Focus log detail'
    },
  },

  /**
   * Default Settings
   */
  defaultSettings: {
    pollingInterval: 5000,
    theme: 'dark',
    autoRefresh: true,
    maxLogs: 100,
    defaultTab: 'all',
    notifications: true,
    notifyErrors: true,
    fontSize: 'sm',
    wrapLines: false,
    showGovLimits: true,
    bookmarksEnabled: true,
    syncSettings: false, // Cloud sync disabled
  },

  /**
   * Filter Options
   */
  filters: {
    status: ['all', 'success', 'error', 'warning'],
    type: ['all', 'trigger', 'batch', 'flow', 'queueable', 'future', 'platform', 'anonymous'],
  },

  /**
   * Export Formats
   */
  exportFormats: {
    text: { ext: 'txt', mime: 'text/plain', label: 'Text' },
    json: { ext: 'json', mime: 'application/json', label: 'JSON' },
    csv: { ext: 'csv', mime: 'text/csv', label: 'CSV' },
  },

  /**
   * Toast Notifications
   */
  notifications: {
    duration: 3500, // milliseconds
    position: 'bottom-center',
    types: ['success', 'error', 'warning', 'info'],
  },

  /**
   * Validation Rules
   */
  validation: {
    pollingInterval: (val) => val >= 2000 && val <= 30000,
    maxLogs: (val) => val >= 50 && val <= 500,
    duration: (val) => val >= 1 && val <= 480,
  }
};

/**
 * Settings Manager
 * Handles loading, saving, and validation of user settings
 */
export class SettingsManager {
  static async load() {
    return new Promise(resolve => {
      chrome.storage.local.get(['settings'], (data) => {
        const loaded = data.settings || {};
        const merged = { ...CONFIG.defaultSettings, ...loaded };
        resolve(merged);
      });
    });
  }

  static async save(settings) {
    return new Promise(resolve => {
      chrome.storage.local.set({ settings }, resolve);
    });
  }

  static validate(key, value) {
    const validator = CONFIG.validation[key];
    return validator ? validator(value) : true;
  }

  static getDefault(key) {
    return CONFIG.defaultSettings[key];
  }

  static reset() {
    return this.save(CONFIG.defaultSettings);
  }
}

/**
 * Theme Manager
 */
export class ThemeManager {
  static apply(theme = 'dark') {
    document.body.classList.remove('theme-dark', 'theme-light');
    document.body.classList.add(`theme-${theme}`);

    // Apply CSS variables
    const colors = CONFIG.colors[theme];
    Object.entries(colors).forEach(([key, value]) => {
      document.documentElement.style.setProperty(`--${key}`, value);
    });
  }

  static toggle() {
    const isDark = document.body.classList.contains('theme-dark');
    this.apply(isDark ? 'light' : 'dark');
  }

  static getActive() {
    return document.body.classList.contains('theme-dark') ? 'dark' : 'light';
  }
}

/**
 * Feature Toggle Manager
 */
export class FeatureManager {
  static isEnabled(featureName) {
    return CONFIG.features[featureName] === true;
  }

  static enable(featureName) {
    CONFIG.features[featureName] = true;
  }

  static disable(featureName) {
    CONFIG.features[featureName] = false;
  }

  static getEnabled() {
    return Object.entries(CONFIG.features)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);
  }
}
