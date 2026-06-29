/**
 * ApexLens - Log Parser
 * Converts raw Salesforce Apex log text into structured, queryable objects
 */

export class LogParser {
  /**
   * Parse a full raw Apex log into structured sections
   */
  static parse(rawLog) {
    if (!rawLog || typeof rawLog !== 'string') return null;

    const lines = rawLog.split('\n');
    const result = {
      raw: rawLog,
      lines: lines.length,
      size: rawLog.length,
      errors: [],
      debugStatements: [],
      soqlQueries: [],
      dmlOperations: [],
      flowExecutions: [],
      callouts: [],
      limits: {},
      methods: [],
      codeUnits: [],
      timeline: [],
      summary: {}
    };

    let soqlStart = null;
    let dmlStart = null;
    let calloutStart = null;
    let methodStack = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Parse timestamp and category from line
      const parsed = this._parseLine(line, i + 1);
      if (!parsed) continue;

      result.timeline.push(parsed);

      switch (parsed.event) {
        // ── Debug Statements ────────────────────────────────────────────────
        case 'USER_DEBUG':
          result.debugStatements.push({
            lineNum: parsed.lineNum,
            timestamp: parsed.timestamp,
            logLine: parsed.logLine,
            category: parsed.category,
            level: parsed.level,
            message: parsed.rest,
            raw: line
          });
          break;

        // ── Errors ──────────────────────────────────────────────────────────
        case 'EXCEPTION_THROWN':
        case 'FATAL_ERROR':
          result.errors.push({
            lineNum: parsed.lineNum,
            timestamp: parsed.timestamp,
            type: parsed.event,
            message: parsed.rest,
            severity: parsed.event === 'FATAL_ERROR' ? 'fatal' : 'error',
            raw: line
          });
          break;

        // ── SOQL ────────────────────────────────────────────────────────────
        case 'SOQL_EXECUTE_BEGIN':
          soqlStart = {
            lineNum: parsed.lineNum,
            timestamp: parsed.timestamp,
            query: parsed.rest,
            raw: line
          };
          break;

        case 'SOQL_EXECUTE_END': {
          const rows = this._extractNumber(parsed.rest, 'Rows:');
          const entry = {
            ...(soqlStart || {}),
            endLineNum: parsed.lineNum,
            endTimestamp: parsed.timestamp,
            rows,
            endRaw: line
          };
          result.soqlQueries.push(entry);
          soqlStart = null;
          break;
        }

        // ── DML ─────────────────────────────────────────────────────────────
        case 'DML_BEGIN':
          dmlStart = {
            lineNum: parsed.lineNum,
            timestamp: parsed.timestamp,
            operation: this._extractField(parsed.rest, 'Op:'),
            objectName: this._extractField(parsed.rest, 'Type:'),
            rows: this._extractNumber(parsed.rest, 'Rows:'),
            raw: line
          };
          break;

        case 'DML_END':
          if (dmlStart) {
            result.dmlOperations.push({ ...dmlStart, endLineNum: parsed.lineNum });
            dmlStart = null;
          }
          break;

        // ── Callouts ────────────────────────────────────────────────────────
        case 'CALLOUT_REQUEST':
          calloutStart = {
            lineNum: parsed.lineNum,
            timestamp: parsed.timestamp,
            details: parsed.rest,
            raw: line
          };
          break;

        case 'CALLOUT_RESPONSE':
          result.callouts.push({
            ...(calloutStart || {}),
            responseLineNum: parsed.lineNum,
            responseTimestamp: parsed.timestamp,
            response: parsed.rest
          });
          calloutStart = null;
          break;

        // ── Methods ─────────────────────────────────────────────────────────
        case 'METHOD_ENTRY':
          methodStack.push({
            lineNum: parsed.lineNum,
            timestamp: parsed.timestamp,
            name: parsed.rest
          });
          break;

        case 'METHOD_EXIT': {
          const entry = methodStack.pop();
          if (entry) {
            result.methods.push({
              ...entry,
              exitLineNum: parsed.lineNum,
              exitTimestamp: parsed.timestamp,
              name: parsed.rest || entry.name
            });
          }
          break;
        }

        // ── Code Units ──────────────────────────────────────────────────────
        case 'CODE_UNIT_STARTED':
          result.codeUnits.push({
            lineNum: parsed.lineNum,
            timestamp: parsed.timestamp,
            type: 'start',
            name: parsed.rest
          });
          break;

        case 'CODE_UNIT_FINISHED':
          result.codeUnits.push({
            lineNum: parsed.lineNum,
            timestamp: parsed.timestamp,
            type: 'finish',
            name: parsed.rest
          });
          break;

        // ── Flow ────────────────────────────────────────────────────────────
        case 'FLOW_START_INTERVIEW_BEGIN':
        case 'FLOW_INTERVIEW_STARTED':
          result.flowExecutions.push({
            lineNum: parsed.lineNum,
            timestamp: parsed.timestamp,
            type: 'start',
            name: parsed.rest
          });
          break;

        case 'FLOW_START_INTERVIEW_END':
        case 'FLOW_INTERVIEW_FINISHED':
          result.flowExecutions.push({
            lineNum: parsed.lineNum,
            timestamp: parsed.timestamp,
            type: 'finish',
            name: parsed.rest
          });
          break;

        // ── Governor Limits ─────────────────────────────────────────────────
        case 'LIMIT_USAGE_FOR_NS':
          this._parseLimits(parsed.rest, result.limits, lines, i);
          break;
      }
    }

    // Build summary
    result.summary = {
      errorCount: result.errors.length,
      debugCount: result.debugStatements.length,
      soqlCount: result.soqlQueries.length,
      dmlCount: result.dmlOperations.length,
      calloutCount: result.callouts.length,
      flowCount: result.flowExecutions.filter(f => f.type === 'start').length,
      hasErrors: result.errors.length > 0,
      hasFatalErrors: result.errors.some(e => e.severity === 'fatal'),
      totalSoqlRows: result.soqlQueries.reduce((sum, q) => sum + (q.rows || 0), 0)
    };

    return result;
  }

  static _parseLine(line, lineNum) {
    // Format: HH:MM:SS.mmm (N)|EVENT_NAME|[line]|details
    // Or timestamp format: 20:30:05.123 (0)|CODE_UNIT_STARTED|[EXTERNAL]|...
    const match = line.match(/^(\d{2}:\d{2}:\d{2}\.\d+)\s+\((\d+)\)\|([A-Z_]+)\|(.*)$/);
    if (!match) {
      // Try alternate header format
      const altMatch = line.match(/^\d{2}:\d{2}:\d{2}\.\d+\s+\(\d+\)\|([A-Z_]+)/);
      if (altMatch) {
        return { event: altMatch[1], rest: '', lineNum, timestamp: null, logLine: null, category: null, level: null };
      }
      return null;
    }

    const [, timestamp, nanos, event, rest] = match;

    // Some events have [lineNum]|category|level|message
    const restParts = rest.split('|');
    let logLine = null, category = null, level = null, message = rest;

    if (restParts[0] && restParts[0].startsWith('[')) {
      logLine = restParts[0];
      category = restParts[1] || null;
      level = restParts[2] || null;
      message = restParts.slice(3).join('|') || restParts.slice(1).join('|');
    }

    return { timestamp, nanos, event, rest: message, logLine, category, level, lineNum, raw: line };
  }

  static _extractNumber(str, key) {
    const match = str.match(new RegExp(key.replace(':', '\\s*:\\s*') + '\\s*(\\d+)'));
    return match ? parseInt(match[1], 10) : 0;
  }

  static _extractField(str, key) {
    const match = str.match(new RegExp(key.replace(':', '\\s*:\\s*') + '\\s*([\\w.]+)'));
    return match ? match[1] : '';
  }

  static _parseLimits(text, limits, lines, startIndex) {
    // Parse the following lines for limit data
    const limitPatterns = [
      { key: 'soqlQueries', pattern: /Number of SOQL queries:\s*(\d+)\s*out of\s*(\d+)/ },
      { key: 'dmlStatements', pattern: /Number of DML statements:\s*(\d+)\s*out of\s*(\d+)/ },
      { key: 'cpuTime', pattern: /Maximum CPU time:\s*(\d+)\s*out of\s*(\d+)/ },
      { key: 'heapSize', pattern: /Maximum heap size:\s*(\d+)\s*out of\s*(\d+)/ },
      { key: 'callouts', pattern: /Number of callouts:\s*(\d+)\s*out of\s*(\d+)/ },
      { key: 'emailInvocations', pattern: /Number of Email Invocations:\s*(\d+)\s*out of\s*(\d+)/ },
      { key: 'queueableJobs', pattern: /Number of queueable jobs:\s*(\d+)\s*out of\s*(\d+)/ },
      { key: 'futureCalls', pattern: /Number of future calls:\s*(\d+)\s*out of\s*(\d+)/ },
      { key: 'soqlRows', pattern: /Number of query rows:\s*(\d+)\s*out of\s*(\d+)/ },
      { key: 'dmlRows', pattern: /Number of DML rows:\s*(\d+)\s*out of\s*(\d+)/ }
    ];

    // Scan next N lines for limit data
    for (let j = startIndex + 1; j < Math.min(startIndex + 50, lines.length); j++) {
      const l = lines[j];
      for (const { key, pattern } of limitPatterns) {
        const m = l.match(pattern);
        if (m) {
          limits[key] = { used: parseInt(m[1], 10), max: parseInt(m[2], 10) };
        }
      }
    }
  }

  /**
   * Filter log lines by category
   */
  static filterByCategory(parsed, category) {
    switch (category) {
      case 'errors': return parsed.errors;
      case 'debug': return parsed.debugStatements;
      case 'soql': return parsed.soqlQueries;
      case 'dml': return parsed.dmlOperations;
      case 'flow': return parsed.flowExecutions;
      case 'callouts': return parsed.callouts;
      case 'limits': return [parsed.limits];
      default: return parsed.timeline;
    }
  }

  /**
   * Search through parsed log
   */
  static search(parsed, query) {
    if (!query) return [];
    const q = query.toLowerCase();
    const results = [];

    parsed.timeline.forEach(entry => {
      if ((entry.raw || '').toLowerCase().includes(q)) {
        results.push(entry);
      }
    });

    return results;
  }

  /**
   * Get governor limits as display-friendly array
   */
  static getGovernorLimits(limits) {
    const definitions = [
      { key: 'soqlQueries', label: 'SOQL Queries', icon: '🔍', unit: '' },
      { key: 'soqlRows', label: 'Query Rows', icon: '📋', unit: '' },
      { key: 'dmlStatements', label: 'DML Statements', icon: '✏️', unit: '' },
      { key: 'dmlRows', label: 'DML Rows', icon: '📝', unit: '' },
      { key: 'cpuTime', label: 'CPU Time', icon: '⚡', unit: 'ms' },
      { key: 'heapSize', label: 'Heap Size', icon: '💾', unit: 'bytes' },
      { key: 'callouts', label: 'Callouts', icon: '🌐', unit: '' },
      { key: 'emailInvocations', label: 'Email Invocations', icon: '📧', unit: '' },
      { key: 'queueableJobs', label: 'Queueable Jobs', icon: '⏳', unit: '' },
      { key: 'futureCalls', label: 'Future Calls', icon: '🔮', unit: '' }
    ];

    return definitions.map(def => {
      const data = limits[def.key] || { used: 0, max: 0 };
      const pct = data.max > 0 ? Math.round((data.used / data.max) * 100) : 0;
      return { ...def, ...data, percentage: pct, status: pct >= 90 ? 'critical' : pct >= 75 ? 'warning' : 'ok' };
    });
  }
}
