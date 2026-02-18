import fs from 'fs';
import path from 'path';

/**
 * Analytics — append-only event log for PromptOS calls.
 * Every bridge.execute() call is logged here for audit + optimization.
 * 
 * Extended with governance fields:
 * - run_id, objective_type, step_index, tool_calls, passed, failure_reason
 * - model, role, user_id, retry_count, channel
 */
export class Analytics {
  constructor(analyticsDir = null) {
    this.analyticsDir = analyticsDir || path.join(process.cwd(), 'analytics');
    this.eventsFile = path.join(this.analyticsDir, 'events.jsonl');
    this._ensureDir();
  }

  _ensureDir() {
    try {
      fs.mkdirSync(this.analyticsDir, { recursive: true });
    } catch (err) {
      console.warn(`Analytics: could not create analytics dir: ${err.message}`);
    }
  }

  /**
   * Log a PromptOS execution event with extended governance fields.
   *
   * @param {Object} event
   *   - run_id: string (UUID per ShipMachine run)
   *   - timestamp: ISO 8601
   *   - objective_type: 'feature' | 'bugfix' | 'refactor' | 'migration'
   *   - prompt_id: string
   *   - step_index: number
   *   - tool_calls: string[] (tools invoked during this step)
   *   - passed: boolean
   *   - failure_reason: string?
   *   - duration_ms: number
   *   - tokens_used: number
   *   - model: string
   *   - role: string
   *   - user_id: string?
   *   - retry_count: number
   *   - channel: string?
   */
  log(event) {
    const entry = {
      run_id: event.run_id || null,
      timestamp: event.timestamp || new Date().toISOString(),
      objective_type: event.objective_type || 'feature',
      prompt_id: event.promptId || event.prompt_id,
      step_index: event.stepIndex || event.step_index || 0,
      tool_calls: event.tool_calls || event.toolCalls || [],
      passed: event.success ?? event.passed ?? true,
      failure_reason: event.failure_reason || event.error || null,
      duration_ms: event.durationMs || event.duration_ms || 0,
      tokens_used: event.tokensUsed || event.tokens_used || 0,
      model: event.model || null,
      role: event.role || 'engineer',
      user_id: event.user_id || null,
      retry_count: event.retry_count || event.retryCount || 0,
      channel: event.channel || null,
    };

    try {
      fs.appendFileSync(this.eventsFile, JSON.stringify(entry) + '\n', 'utf8');
    } catch (err) {
      console.warn(`Analytics: failed to log event: ${err.message}`);
    }
  }

  /**
   * Get aggregate stats.
   * @returns {{totalCalls: number, totalTokens: number, promptBreakdown: Object, avgDuration: number, successRate: number}}
   */
  getStats() {
    const events = this._loadAll();

    const stats = {
      totalCalls: events.length,
      totalTokens: 0,
      totalDuration: 0,
      successCount: 0,
      failedCount: 0,
      promptBreakdown: {},
      avgDuration: 0,
      successRate: 0,
      runs: new Set(),
      objectiveTypes: {},
      modelUsage: {},
      roleUsage: {},
    };

    for (const event of events) {
      stats.totalTokens += event.tokens_used || 0;
      stats.totalDuration += event.duration_ms || 0;
      
      if (event.passed) {
        stats.successCount++;
      } else {
        stats.failedCount++;
      }

      if (event.run_id) {
        stats.runs.add(event.run_id);
      }

      if (!stats.promptBreakdown[event.prompt_id]) {
        stats.promptBreakdown[event.prompt_id] = {
          calls: 0,
          tokens: 0,
          success: 0,
          failed: 0,
        };
      }
      const pb = stats.promptBreakdown[event.prompt_id];
      pb.calls++;
      pb.tokens += event.tokens_used || 0;
      if (event.passed) pb.success++;
      else pb.failed++;

      // Track objective types
      const objType = event.objective_type || 'feature';
      stats.objectiveTypes[objType] = (stats.objectiveTypes[objType] || 0) + 1;

      // Track model usage
      if (event.model) {
        stats.modelUsage[event.model] = (stats.modelUsage[event.model] || 0) + 1;
      }

      // Track role usage
      if (event.role) {
        stats.roleUsage[event.role] = (stats.roleUsage[event.role] || 0) + 1;
      }
    }

    stats.avgDuration = events.length > 0
      ? Math.round(stats.totalDuration / events.length)
      : 0;

    stats.successRate = events.length > 0
      ? Math.round((stats.successCount / events.length) * 100)
      : 0;

    stats.totalRuns = stats.runs.size;
    delete stats.runs;

    return stats;
  }

  /**
   * Load recent events.
   * @param {number} [limit=100]
   * @returns {Object[]}
   */
  loadHistory(limit = 100) {
    const events = this._loadAll();
    return events.slice(-limit);
  }

  /**
   * Load all events from the JSONL file.
   * @returns {Object[]}
   */
  _loadAll() {
    try {
      const raw = fs.readFileSync(this.eventsFile, 'utf8');
      return raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Get events for a specific run.
   * @param {string} runId
   * @returns {Object[]}
   */
  getRunEvents(runId) {
    return this._loadAll().filter(e => e.run_id === runId);
  }

  /**
   * Get failing prompts with their failure rates.
   * @param {number} threshold - minimum calls to consider
   * @returns {Object[]} prompts with >threshold% failure rate
   */
  getFailingPrompts(threshold = 3) {
    const events = this._loadAll();
    const promptStats = {};

    for (const event of events) {
      if (!promptStats[event.prompt_id]) {
        promptStats[event.prompt_id] = { calls: 0, failed: 0 };
      }
      promptStats[event.prompt_id].calls++;
      if (!event.passed) {
        promptStats[event.prompt_id].failed++;
      }
    }

    const failing = [];
    for (const [promptId, stats] of Object.entries(promptStats)) {
      if (stats.calls >= threshold) {
        const failureRate = (stats.failed / stats.calls) * 100;
        if (failureRate > 20) {
          failing.push({
            prompt_id: promptId,
            calls: stats.calls,
            failed: stats.failed,
            failure_rate: Math.round(failureRate),
          });
        }
      }
    }

    return failing.sort((a, b) => b.failure_rate - a.failure_rate);
  }

  /**
   * Clear all analytics (use with caution).
   */
  clear() {
    try {
      fs.writeFileSync(this.eventsFile, '', 'utf8');
    } catch { /* ignore */ }
  }
}

export default Analytics;
