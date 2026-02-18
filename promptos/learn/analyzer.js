import fs from 'fs';
import path from 'path';
import { Analytics } from '../promptos-bridge/analytics.js';

/**
 * LearningLoopAnalyzer — analyzes prompt executions to identify failure patterns
 * and propose improvements.
 */
export class LearningLoopAnalyzer {
  constructor(analyticsDir = null) {
    this.analytics = new Analytics(analyticsDir);
  }

  /**
   * Analyze runs to identify prompts with high failure rates.
   * @param {number} limit - minimum number of calls to consider
   * @returns {Object[]} prompts with >20% failure rate
   */
  analyzeRuns(limit = 3) {
    return this.analytics.getFailingPrompts(limit);
  }

  /**
   * Generate improvement proposals for failing prompts.
   * @returns {Object[]} proposed improvements
   */
  generateProposals() {
    const failing = this.analyzeRuns(3);
    const proposals = [];

    for (const failure of failing) {
      const events = this.analytics.loadHistory(1000)
        .filter(e => e.prompt_id === failure.prompt_id && !e.passed);

      // Analyze failure patterns
      const failureReasons = events.map(e => e.failure_reason).filter(Boolean);
      const commonReasons = this._countOccurrences(failureReasons);

      proposals.push({
        prompt_id: failure.prompt_id,
        failure_rate: failure.failure_rate,
        total_calls: failure.calls,
        common_failures: commonReasons.slice(0, 3),
        proposal: this._generateProposal(failure, commonReasons),
        priority: failure.failure_rate > 50 ? 'high' : 'medium',
      });
    }

    return proposals;
  }

  /**
   * Detect recurring step sequences that could become a new prompt.
   * @returns {Object[]} pattern suggestions
   */
  findPatterns() {
    const events = this.analytics.loadHistory(200);
    const runs = this._groupByRun(events);
    const sequences = [];

    for (const [runId, runEvents] of Object.entries(runs)) {
      // Extract prompt sequence
      const promptSeq = runEvents
        .sort((a, b) => a.step_index - b.step_index)
        .map(e => e.prompt_id);

      // Look for common sequences
      if (promptSeq.length >= 3) {
        const seqKey = promptSeq.join(' → ');
        sequences.push({
          run_id: runId,
          sequence: promptSeq,
          length: promptSeq.length,
          success: runEvents.every(e => e.passed),
        });
      }
    }

    // Find common patterns
    const patternCounts = {};
    for (const seq of sequences) {
      const key = seq.sequence.slice(0, 3).join(' → '); // First 3 steps
      patternCounts[key] = (patternCounts[key] || 0) + 1;
    }

    const suggestions = [];
    for (const [pattern, count] of Object.entries(patternCounts)) {
      if (count >= 3) {
        suggestions.push({
          pattern,
          occurrences: count,
          suggestion: `Consider creating a composite prompt that combines: ${pattern}`,
        });
      }
    }

    return suggestions;
  }

  /**
   * Get detailed metrics for a specific prompt.
   * @param {string} promptId
   * @returns {Object}
   */
  getPromptMetrics(promptId) {
    const events = this.analytics.loadHistory(1000)
      .filter(e => e.prompt_id === promptId);

    if (events.length === 0) {
      return { not_found: true };
    }

    const metrics = {
      total_calls: events.length,
      success: events.filter(e => e.passed).length,
      failed: events.filter(e => !e.passed).length,
      success_rate: 0,
      avg_duration_ms: 0,
      avg_tokens: 0,
      models_used: {},
      roles_used: {},
    };

    let totalDuration = 0;
    let totalTokens = 0;

    for (const event of events) {
      totalDuration += event.duration_ms || 0;
      totalTokens += event.tokens_used || 0;

      if (event.model) {
        metrics.models_used[event.model] = (metrics.models_used[event.model] || 0) + 1;
      }
      if (event.role) {
        metrics.roles_used[event.role] = (metrics.roles_used[event.role] || 0) + 1;
      }
    }

    metrics.success_rate = Math.round((metrics.success / events.length) * 100);
    metrics.avg_duration_ms = Math.round(totalDuration / events.length);
    metrics.avg_tokens = Math.round(totalTokens / events.length);

    return metrics;
  }

  /**
   * Get all run summaries.
   * @returns {Object[]}
   */
  getRunSummaries() {
    const events = this.analytics.loadHistory(1000);
    const runs = this._groupByRun(events);

    const summaries = [];
    for (const [runId, runEvents] of Object.entries(runs)) {
      const firstEvent = runEvents[0];
      summaries.push({
        run_id: runId,
        timestamp: firstEvent?.timestamp,
        objective_type: firstEvent?.objective_type,
        total_steps: runEvents.length,
        passed: runEvents.every(e => e.passed),
        total_tokens: runEvents.reduce((sum, e) => sum + (e.tokens_used || 0), 0),
        total_duration_ms: runEvents.reduce((sum, e) => sum + (e.duration_ms || 0), 0),
      });
    }

    return summaries.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );
  }

  // Helper: count occurrences
  _countOccurrences(arr) {
    const counts = {};
    for (const item of arr) {
      const key = String(item).slice(0, 100); // Truncate long reasons
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, count }));
  }

  // Helper: generate improvement proposal
  _generateProposal(failure, commonReasons) {
    const promptId = failure.prompt_id;
    
    // Generate contextual suggestions based on prompt type
    if (promptId.includes('patch')) {
      return 'Consider adding more context about the file structure in inputs. The LLM may need more context about imports and dependencies.';
    }
    if (promptId.includes('test')) {
      return 'Consider adding example test cases in the prompt examples section. More concrete examples may improve test generation quality.';
    }
    if (promptId.includes('interpret')) {
      return 'Consider refining the output schema to be more specific about failure categories. The LLM may be misclassifying failures.';
    }
    
    return `Review prompt "${promptId}" - ${commonReasons[0]?.reason || 'unknown failure cause'}. Consider adding more examples or clarifying the output requirements.`;
  }

  // Helper: group events by run
  _groupByRun(events) {
    const runs = {};
    for (const event of events) {
      const runId = event.run_id || 'unknown';
      if (!runs[runId]) runs[runId] = [];
      runs[runId].push(event);
    }
    return runs;
  }
}

export default LearningLoopAnalyzer;
