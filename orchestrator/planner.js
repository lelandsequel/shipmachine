/**
 * Planner — step selection and completion logic for the ShipMachine orchestrator.
 */
export class Planner {
  constructor() {
    // Max retry attempts per step before escalating
    this.MAX_RETRIES = 2;
    this._retryCount = new Map(); // stepId → count
  }

  /**
   * Select the next step to execute.
   *
   * @param {Object} plan - output from ship.plan ({steps: [...], ...})
   * @param {string[]} completedSteps - list of completed step IDs
   * @param {Object|null} lastResult - result of the last executed step
   * @returns {Object|null} next step object, or null if done
   */
  selectNextStep(plan, completedSteps, lastResult) {
    if (!plan || !plan.steps || plan.steps.length === 0) {
      return null;
    }

    const completedSet = new Set(completedSteps);

    // Find the first incomplete step
    for (const step of plan.steps) {
      if (!completedSet.has(step.id)) {
        return step;
      }
    }

    return null; // All steps done
  }

  /**
   * Check if a step is complete based on evidence.
   *
   * @param {Object} step - plan step
   * @param {Object} evidence - {testResult, patchApplied, ...}
   * @returns {boolean}
   */
  isStepComplete(step, evidence) {
    if (!evidence) return false;

    switch (step.type) {
      case 'analysis':
        // Analysis steps are complete when they have any result
        return evidence.result !== undefined;

      case 'patch':
      case 'create':
        // Complete when patch was applied and no test_checkpoint failure
        if (!evidence.patchApplied) return false;
        if (step.test_checkpoint && evidence.testResult) {
          return evidence.testResult.passed;
        }
        return evidence.patchApplied;

      case 'tests':
        // Complete when tests were written and pass
        return evidence.testFileWritten === true;

      case 'exec':
        // Complete when command ran with exit code 0
        return evidence.exitCode === 0;

      case 'docs':
        // Complete when docs were updated
        return evidence.docsUpdated === true;

      case 'review':
        // Complete when review was run (may have issues, but still "done")
        return evidence.reviewComplete === true;

      default:
        return evidence.complete === true;
    }
  }

  /**
   * Determine if the orchestrator should abort.
   *
   * @param {Object} budget - {steps, tokens, timeMinutes, filesModified}
   * @param {Object|null} lastResult - last step result
   * @returns {{abort: boolean, reason?: string}}
   */
  shouldAbort(budget, lastResult) {
    // Budget limits
    if (budget.steps >= 50) {
      return { abort: true, reason: 'Budget exceeded: max steps reached (50)' };
    }
    if (budget.tokens >= 500000) {
      return { abort: true, reason: 'Budget exceeded: max tokens reached (500k)' };
    }
    if (budget.timeMinutes >= 30) {
      return { abort: true, reason: 'Budget exceeded: max time reached (30 min)' };
    }
    if (budget.filesModified >= 20) {
      return { abort: true, reason: 'Budget exceeded: too many files modified (20)' };
    }

    // Last result triggered abort
    if (lastResult?.nextAction === 'abort') {
      return { abort: true, reason: `Step result requested abort: ${lastResult.reason || 'unknown'}` };
    }

    // Too many retries on a step
    if (lastResult?.stepId) {
      const retries = this._retryCount.get(lastResult.stepId) || 0;
      if (retries >= this.MAX_RETRIES && lastResult.nextAction === 'fix') {
        return {
          abort: false,
          escalate: true,
          reason: `Step ${lastResult.stepId} failed after ${retries} retries — escalating`,
        };
      }
    }

    return { abort: false };
  }

  /**
   * Record a retry for a step.
   */
  recordRetry(stepId) {
    const count = this._retryCount.get(stepId) || 0;
    this._retryCount.set(stepId, count + 1);
    return count + 1;
  }

  /**
   * Get retry count for a step.
   */
  getRetryCount(stepId) {
    return this._retryCount.get(stepId) || 0;
  }

  /**
   * Generate a compact progress summary.
   */
  getProgressSummary(plan, completedSteps) {
    if (!plan?.steps) return 'No plan loaded';
    const total = plan.steps.length;
    const done = completedSteps.length;
    const pct = Math.round(done / total * 100);
    return `${done}/${total} steps (${pct}%)`;
  }
}

export default Planner;
