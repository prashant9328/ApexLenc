/**
 * ApexLens — Advanced Utilities
 * Log export, comparison, analysis, and bookmarking
 */

// ─── Log Export Service ───────────────────────────────────────────────────────
export class LogExporter {
  static exportAsText(log, body) {
    return body;
  }

  static exportAsJSON(log, parsed) {
    return JSON.stringify({
      metadata: {
        id: log.Id,
        operation: log.Operation,
        status: log.Status,
        user: log.LogUser?.Name,
        timestamp: log.LastModifiedDate,
        duration: log.DurationMilliseconds,
        size: log.LogLength,
      },
      parsed: parsed || null,
      exportedAt: new Date().toISOString(),
    }, null, 2);
  }

  static exportAsCSV(logs) {
    const headers = ['ID', 'Operation', 'User', 'Status', 'Duration (ms)', 'Size (KB)', 'Timestamp'];
    const rows = logs.map(l => [
      l.Id,
      l.Operation || l.Request || '',
      l.LogUser?.Name || 'Unknown',
      l.Status || 'Unknown',
      l.DurationMilliseconds || 0,
      Math.round((l.LogLength || 0) / 1024),
      l.LastModifiedDate || '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  static download(filename, content, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// ─── Log Bookmark Service ────────────────────────────────────────────────────
export class LogBookmarks {
  constructor() {
    this.bookmarks = [];
    this.loadFromStorage();
  }

  add(log, tag = '') {
    const bookmark = {
      id: Math.random().toString(36).slice(2),
      logId: log.Id,
      operation: log.Operation,
      user: log.LogUser?.Name,
      timestamp: log.LastModifiedDate,
      tag,
      createdAt: new Date().toISOString(),
    };
    this.bookmarks.push(bookmark);
    this.saveToStorage();
    return bookmark;
  }

  remove(id) {
    this.bookmarks = this.bookmarks.filter(b => b.id !== id);
    this.saveToStorage();
  }

  getAll() {
    return this.bookmarks;
  }

  getByTag(tag) {
    return this.bookmarks.filter(b => b.tag === tag);
  }

  saveToStorage() {
    chrome.storage.local.set({ apexlens_bookmarks: this.bookmarks }).catch(() => {});
  }

  loadFromStorage() {
    chrome.storage.local.get(['apexlens_bookmarks'], (data) => {
      if (data.apexlens_bookmarks) {
        this.bookmarks = data.apexlens_bookmarks;
      }
    });
  }
}

// ─── Log Analyzer ────────────────────────────────────────────────────────────
export class LogAnalyzer {
  static analyze(parsed) {
    if (!parsed) return null;

    return {
      summary: this.getSummary(parsed),
      performance: this.analyzePerformance(parsed),
      risks: this.detectRisks(parsed),
      optimization: this.suggestOptimizations(parsed),
    };
  }

  static getSummary(parsed) {
    return {
      totalLines: parsed.lines,
      sizeBytes: parsed.size,
      errorCount: parsed.summary.errorCount,
      hasErrors: parsed.summary.hasErrors,
      hasFatalErrors: parsed.summary.hasFatalErrors,
      debugCount: parsed.summary.debugCount,
      soqlCount: parsed.summary.soqlCount,
      totalRows: parsed.summary.totalSoqlRows,
      dmlCount: parsed.summary.dmlCount,
      flowCount: parsed.summary.flowCount,
      calloutCount: parsed.summary.calloutCount,
    };
  }

  static analyzePerformance(parsed) {
    const limits = parsed.limits || {};

    return {
      // CPU
      cpuHealthy: !limits.cpuTime || (limits.cpuTime.used / limits.cpuTime.max) < 0.8,
      cpuUsage: limits.cpuTime ? Math.round((limits.cpuTime.used / limits.cpuTime.max) * 100) : 0,

      // Memory
      heapHealthy: !limits.heapSize || (limits.heapSize.used / limits.heapSize.max) < 0.8,
      heapUsage: limits.heapSize ? Math.round((limits.heapSize.used / limits.heapSize.max) * 100) : 0,

      // SOQL
      soqlHealthy: !limits.soqlQueries || (limits.soqlQueries.used / limits.soqlQueries.max) < 0.8,
      soqlUsage: limits.soqlQueries ? Math.round((limits.soqlQueries.used / limits.soqlQueries.max) * 100) : 0,

      // DML
      dmlHealthy: !limits.dmlStatements || (limits.dmlStatements.used / limits.dmlStatements.max) < 0.8,
      dmlUsage: limits.dmlStatements ? Math.round((limits.dmlStatements.used / limits.dmlStatements.max) * 100) : 0,
    };
  }

  static detectRisks(parsed) {
    const risks = [];

    if (parsed.summary.hasFatalErrors) {
      risks.push({ level: 'critical', message: 'Fatal error detected - execution failed' });
    }

    if (parsed.summary.errorCount > 0) {
      risks.push({ level: 'high', message: `${parsed.summary.errorCount} exception(s) thrown` });
    }

    // Check for large row counts
    const largeQueries = parsed.soqlQueries.filter(q => (q.rows || 0) > 1000);
    if (largeQueries.length > 0) {
      risks.push({ level: 'medium', message: `Large result sets (${largeQueries.length} SOQL queries > 1000 rows)` });
    }

    // Check for many SOQL queries
    if (parsed.soqlQueries.length > 50) {
      risks.push({ level: 'medium', message: 'High query count - possible N+1 problem' });
    }

    // Check heap usage
    const heap = parsed.limits.heapSize;
    if (heap && (heap.used / heap.max) > 0.9) {
      risks.push({ level: 'high', message: 'Heap limit critical (>90%)' });
    }

    // Check CPU usage
    const cpu = parsed.limits.cpuTime;
    if (cpu && (cpu.used / cpu.max) > 0.85) {
      risks.push({ level: 'medium', message: 'CPU usage high (>85%)' });
    }

    return risks;
  }

  static suggestOptimizations(parsed) {
    const suggestions = [];

    // SOQL suggestions
    if (parsed.soqlQueries.length > 20) {
      suggestions.push('Consider batching SOQL queries or using bulk operations');
    }
    const largeQueries = parsed.soqlQueries.filter(q => (q.rows || 0) > 1000);
    if (largeQueries.length > 0) {
      suggestions.push('Review SOQL queries returning large result sets - consider filtering');
    }

    // DML suggestions
    if (parsed.dmlOperations.length > 0) {
      const totalRows = parsed.dmlOperations.reduce((sum, op) => sum + (op.rows || 0), 0);
      if (totalRows > 1000) {
        suggestions.push('Consider batch DML operations for large updates');
      }
    }

    // Method depth
    if (parsed.methods.length > 50) {
      suggestions.push('Deep call stack - consider refactoring to reduce method calls');
    }

    // Memory usage
    const heapPct = parsed.limits.heapSize ? (parsed.limits.heapSize.used / parsed.limits.heapSize.max) * 100 : 0;
    if (heapPct > 75) {
      suggestions.push('High memory usage - review object instantiation and collections');
    }

    return suggestions;
  }

  static scoreLog(parsed) {
    if (!parsed) return 0;

    let score = 100;

    // Deduct for errors
    score -= parsed.summary.errorCount * 10;
    if (parsed.summary.hasFatalErrors) score -= 50;

    // Deduct for high resource usage
    const cpu = parsed.limits.cpuTime;
    if (cpu) {
      const cpuPct = (cpu.used / cpu.max) * 100;
      if (cpuPct > 90) score -= 20;
      else if (cpuPct > 75) score -= 10;
    }

    const heap = parsed.limits.heapSize;
    if (heap) {
      const heapPct = (heap.used / heap.max) * 100;
      if (heapPct > 90) score -= 20;
      else if (heapPct > 75) score -= 10;
    }

    // Deduct for efficiency issues
    if (parsed.soqlQueries.length > 50) score -= 15;
    const largeQueries = parsed.soqlQueries.filter(q => (q.rows || 0) > 1000);
    if (largeQueries.length > 0) score -= 5;

    return Math.max(0, score);
  }
}

// ─── Log Comparison ──────────────────────────────────────────────────────────
export class LogComparator {
  static compare(log1, parsed1, log2, parsed2) {
    if (!parsed1 || !parsed2) return null;

    return {
      summary: {
        log1: { op: log1.Operation, status: log1.Status, duration: log1.DurationMilliseconds },
        log2: { op: log2.Operation, status: log2.Status, duration: log2.DurationMilliseconds },
      },
      metrics: {
        soql: {
          log1: parsed1.soqlQueries.length,
          log2: parsed2.soqlQueries.length,
          diff: parsed2.soqlQueries.length - parsed1.soqlQueries.length,
        },
        dml: {
          log1: parsed1.dmlOperations.length,
          log2: parsed2.dmlOperations.length,
          diff: parsed2.dmlOperations.length - parsed1.dmlOperations.length,
        },
        errors: {
          log1: parsed1.summary.errorCount,
          log2: parsed2.summary.errorCount,
          diff: parsed2.summary.errorCount - parsed1.summary.errorCount,
        },
        debug: {
          log1: parsed1.summary.debugCount,
          log2: parsed2.summary.debugCount,
          diff: parsed2.summary.debugCount - parsed1.summary.debugCount,
        },
      },
      limits: this.compareLimits(parsed1.limits, parsed2.limits),
      timelines: {
        log1Events: parsed1.timeline.length,
        log2Events: parsed2.timeline.length,
      },
    };
  }

  static compareLimits(lim1, lim2) {
    const keys = ['soqlQueries', 'dmlStatements', 'cpuTime', 'heapSize', 'callouts', 'emailInvocations'];
    const result = {};
    keys.forEach(key => {
      const v1 = lim1[key] || { used: 0, max: 0 };
      const v2 = lim2[key] || { used: 0, max: 0 };
      result[key] = {
        log1: v1.used,
        log2: v2.used,
        diff: v2.used - v1.used,
        pct1: v1.max > 0 ? Math.round((v1.used / v1.max) * 100) : 0,
        pct2: v2.max > 0 ? Math.round((v2.used / v2.max) * 100) : 0,
      };
    });
    return result;
  }
}

// ─── Performance Tracker ──────────────────────────────────────────────────────
export class PerformanceTracker {
  static track(orgUrl) {
    const key = `perf_${btoa(orgUrl)}`;
    const data = { logs: [], avgDuration: 0, slowestLog: null, fastestLog: null, totalErrors: 0 };

    return {
      add(log, parsed) {
        if (!data.logs) data.logs = [];
        data.logs.push({
          id: log.Id,
          operation: log.Operation,
          duration: log.DurationMilliseconds || 0,
          hasError: parsed?.summary.hasErrors || false,
          timestamp: log.LastModifiedDate,
        });

        if (data.logs.length > 200) data.logs = data.logs.slice(-200);

        // Update stats
        const durations = data.logs.map(l => l.duration).filter(d => d > 0);
        if (durations.length > 0) {
          data.avgDuration = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
          data.slowestLog = data.logs.reduce((a, b) => (b.duration > a.duration ? b : a));
          data.fastestLog = data.logs.reduce((a, b) => (b.duration < a.duration ? b : a));
        }
        data.totalErrors = data.logs.filter(l => l.hasError).length;

        chrome.storage.local.set({ [key]: data }).catch(() => {});
        return data;
      },

      getStats() {
        return data;
      },

      getTrend() {
        const recent = data.logs?.slice(-20) || [];
        if (recent.length < 5) return null;
        const first = recent.slice(0, 10).map(l => l.duration).reduce((a, b) => a + b, 0) / 10;
        const last = recent.slice(-10).map(l => l.duration).reduce((a, b) => a + b, 0) / 10;
        return { direction: last > first ? 'increasing' : 'decreasing', change: Math.round(last - first) };
      },
    };
  }
}
