/**
 * TaskContext — task-scoped memory for a single ShipMachine run.
 * Not persisted between tasks. Lives only for the duration of one run().
 */
export class TaskContext {
  constructor(objective) {
    this.objective = objective || '';
    this.scopeOutput = null;
    this.repoSurvey = null;
    this.plan = null;
    this.stepResults = [];
    this.currentStep = null;
    this.startedAt = new Date().toISOString();
    this.filesModified = [];
    this.totalTokensUsed = 0;
    this.totalSteps = 0;
    this.errors = [];
    this.testEvidence = null;
    this.securityCheckResult = null;
    this.docUpdateResult = null;
    this.riskAssessment = null;
    this.rollbackPlan = null;
    this.prWriteup = null;
  }

  /**
   * Record the result of a step.
   * @param {string} stepId
   * @param {string} promptId
   * @param {any} result
   * @param {number} tokensUsed
   */
  recordStep(stepId, promptId, result, tokensUsed = 0) {
    this.stepResults.push({
      stepId,
      promptId,
      result,
      tokensUsed,
      timestamp: new Date().toISOString(),
    });
    this.totalTokensUsed += tokensUsed;
    this.totalSteps++;
    this.currentStep = stepId;
  }

  /**
   * Record an error.
   */
  recordError(stepId, error) {
    this.errors.push({
      stepId,
      error: error.message || String(error),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Track a file modification.
   */
  trackFileModified(filePath) {
    if (!this.filesModified.includes(filePath)) {
      this.filesModified.push(filePath);
    }
  }

  /**
   * Get budget usage for policy checks.
   * @returns {{steps, tokens, timeMinutes, filesModified}}
   */
  getBudgetUsage() {
    const startMs = new Date(this.startedAt).getTime();
    const elapsedMs = Date.now() - startMs;
    return {
      steps: this.totalSteps,
      tokens: this.totalTokensUsed,
      timeMinutes: elapsedMs / 1000 / 60,
      filesModified: this.filesModified.length,
    };
  }

  /**
   * Get results for a specific step.
   */
  getStepResult(stepId) {
    return this.stepResults.find(r => r.stepId === stepId) || null;
  }

  /**
   * Get the last step result.
   */
  getLastResult() {
    return this.stepResults[this.stepResults.length - 1] || null;
  }

  /**
   * Summarize context for injection into prompts (compact form).
   * @returns {string}
   */
  summarize() {
    const parts = [];

    parts.push(`Objective: ${this.objective}`);
    parts.push(`Started: ${this.startedAt}`);
    parts.push(`Steps completed: ${this.totalSteps}`);
    parts.push(`Tokens used: ${this.totalTokensUsed}`);
    parts.push(`Files modified: ${this.filesModified.length} (${this.filesModified.slice(0, 5).join(', ')}${this.filesModified.length > 5 ? '...' : ''})`);

    if (this.currentStep) {
      parts.push(`Current step: ${this.currentStep}`);
    }

    if (this.errors.length > 0) {
      parts.push(`Errors: ${this.errors.length} error(s) encountered`);
    }

    if (this.scopeOutput) {
      parts.push(`Done definition: ${this.scopeOutput.done_definition || 'N/A'}`);
    }

    return parts.join('\n');
  }

  /**
   * Serialize to JSON (for logging/debugging).
   */
  toJSON() {
    return {
      objective: this.objective,
      startedAt: this.startedAt,
      currentStep: this.currentStep,
      totalSteps: this.totalSteps,
      totalTokensUsed: this.totalTokensUsed,
      filesModified: this.filesModified,
      errors: this.errors,
      scopeOutput: this.scopeOutput,
      repoSurvey: this.repoSurvey,
      plan: this.plan,
      stepResults: this.stepResults,
      testEvidence: this.testEvidence,
      securityCheckResult: this.securityCheckResult,
      riskAssessment: this.riskAssessment,
      rollbackPlan: this.rollbackPlan,
      prWriteup: this.prWriteup,
    };
  }

  /**
   * Restore from JSON.
   * @param {Object} data
   * @returns {TaskContext}
   */
  static fromJSON(data) {
    const ctx = new TaskContext(data.objective);
    Object.assign(ctx, data);
    return ctx;
  }
}

export default TaskContext;
