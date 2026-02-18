import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * GovernanceEngine — enterprise policy enforcement layer.
 * Handles data classification, model allowlists, approval gates, and PII redaction.
 */
export class GovernanceEngine {
  constructor(configPath = null) {
    const cfgPath = configPath || path.join(__dirname, 'governance.yaml');
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const config = yaml.load(raw);
    this.governance = config.governance;
  }

  /**
   * Check if a role is allowed to access a data class.
   * @param {string} role
   * @param {string} dataClass - public | internal | pii | secrets
   * @returns {{allowed: boolean, requiresRedaction: boolean, reason?: string}}
   */
  checkDataClass(role, dataClass) {
    const cls = this.governance.data_classes.find(c => c.name === dataClass);
    if (!cls) {
      return { allowed: true, requiresRedaction: false }; // unknown class → allow
    }
    if (cls.blocked) {
      return { allowed: false, requiresRedaction: false, reason: `Data class "${dataClass}" is blocked for all roles` };
    }
    const allowed = cls.allowed_roles.includes(role);
    return {
      allowed,
      requiresRedaction: allowed && !!cls.requires_redaction,
      reason: allowed ? null : `Role "${role}" not permitted to access "${dataClass}" data`,
    };
  }

  /**
   * Check if a model is allowed for a role.
   * @param {string} role
   * @param {string} model
   * @returns {boolean}
   */
  checkModelAllowed(role, model) {
    const allowedModels = this.governance.model_allowlist[role];
    if (!allowedModels) return false;
    return allowedModels.some(m => model.includes(m) || m.includes(model));
  }

  /**
   * Check if a prompt requires human approval given context.
   * @param {string} promptId
   * @param {Object} context - { target_env, output, etc. }
   * @returns {{required: boolean, reason?: string}}
   */
  requiresApproval(promptId, context = {}) {
    const rules = this.governance.approval_required || [];
    for (const rule of rules) {
      if (rule.prompt_id !== promptId) continue;
      if (rule.condition === 'always') {
        return { required: true, reason: rule.reason };
      }
      // Simple condition evaluation
      try {
        const condFn = new Function('context', `return ${rule.condition};`);
        if (condFn(context)) {
          return { required: true, reason: rule.reason };
        }
      } catch {
        // If condition eval fails, default to requiring approval (safe default)
        return { required: true, reason: `Condition eval failed, defaulting to approval required: ${rule.reason}` };
      }
    }
    return { required: false };
  }

  /**
   * Redact sensitive patterns from text based on data class rules.
   * @param {string} text
   * @param {string} dataClass
   * @returns {string} redacted text
   */
  redact(text, dataClass) {
    const cls = this.governance.data_classes.find(c => c.name === dataClass);
    if (!cls || !cls.requires_redaction || !cls.redact_patterns) {
      return text;
    }
    let result = text;
    for (const pattern of cls.redact_patterns) {
      const regex = new RegExp(pattern, 'gi');
      result = result.replace(regex, '[REDACTED]');
    }
    return result;
  }

  /**
   * Infer data class from content (heuristic).
   * @param {string} text
   * @returns {string} inferred data class
   */
  inferDataClass(text) {
    // Check for secrets/API keys first
    if (/sk-[a-zA-Z0-9]{32,}/.test(text) || /Bearer\s+[a-zA-Z0-9]{20,}/.test(text)) {
      return 'secrets';
    }
    // Check for PII
    if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text) ||
        /\b\d{3}-\d{2}-\d{4}\b/.test(text)) {
      return 'pii';
    }
    // Check for internal markers
    if (/INTERNAL|CONFIDENTIAL|NOT FOR DISTRIBUTION/i.test(text)) {
      return 'internal';
    }
    return 'public';
  }

  /**
   * Full governance check before execute().
   * @param {Object} params - { role, model, promptId, inputs, context }
   * @returns {{allowed: boolean, violations: string[], requiresApproval: boolean, approvalReason?: string}}
   */
  check({ role, model, promptId, inputs, context = {} }) {
    const violations = [];

    // Model check
    if (model && !this.checkModelAllowed(role, model)) {
      violations.push(`Model "${model}" not allowed for role "${role}"`);
    }

    // Data class check on inputs
    const inputText = typeof inputs === 'object' ? JSON.stringify(inputs) : String(inputs || '');
    const inferredClass = this.inferDataClass(inputText);
    const dataCheck = this.checkDataClass(role, inferredClass);
    if (!dataCheck.allowed) {
      violations.push(dataCheck.reason);
    }

    // Approval check
    const approvalCheck = this.requiresApproval(promptId, context);

    return {
      allowed: violations.length === 0,
      violations,
      requiresApproval: approvalCheck.required,
      approvalReason: approvalCheck.reason,
      inferredDataClass: inferredClass,
      requiresRedaction: dataCheck.requiresRedaction,
    };
  }
}

export default GovernanceEngine;
