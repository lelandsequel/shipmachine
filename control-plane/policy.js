import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// Dangerous command patterns — require human confirmation
const DANGEROUS_PATTERNS = [
  /rm\s+-rf/,
  /drop\s+table/i,
  /truncate\s+table/i,
  /delete\s+from/i,
  /format\s+[a-z]:/i,
  /mkfs/,
  /dd\s+if=/,
  />\s*\/dev\/(sd|hd|nvme)/,
  /shutdown/,
  /reboot/,
  /kill\s+-9/,
  /pkill/,
  /chmod\s+777/,
  /chown\s+-R/,
  /sudo/,
  /curl.*\|\s*bash/,
  /wget.*\|\s*bash/,
  /eval\s*\(/,
];

// PII patterns for redaction
const PII_PATTERNS = [
  { type: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: 'phone', regex: /(\+?1?[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g },
  { type: 'ssn', regex: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g },
  { type: 'credit_card', regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g },
  { type: 'ip_address', regex: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g },
  { type: 'date_of_birth', regex: /\b(?:0?[1-9]|1[0-2])[\/\-](?:0?[1-9]|[12][0-9]|3[01])[\/\-](?:19|20)\d{2}\b/g },
];

export class PolicyEngine {
  constructor(configPath) {
    this.config = null;
    this.configPath = configPath;
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.configPath, 'utf8');
      this.config = yaml.load(raw);
    } catch (err) {
      throw new Error(`PolicyEngine: failed to load config from ${this.configPath}: ${err.message}`);
    }
  }

  /**
   * Reload config (useful if file changes at runtime)
   */
  reload() {
    this._load();
  }

  /**
   * Check if a prompt is allowed for a given agent role.
   * Delegates to RBAC for prompt-level check, but also enforces policy-level overrides.
   */
  checkPromptAllowed(agentRole, promptId) {
    const role = this._getRole(agentRole);
    if (!role) return false;

    return role.allowed_prompts.some(pattern => {
      if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2);
        return promptId.startsWith(prefix + '.');
      }
      return pattern === promptId;
    });
  }

  /**
   * Check if a tool is allowed for a given agent role.
   */
  checkToolAllowed(agentRole, tool) {
    const role = this._getRole(agentRole);
    if (!role) return false;
    return role.allowed_tools.includes(tool);
  }

  /**
   * Check if a command is in the allowlist.
   * Returns true if allowed, false if not.
   */
  checkCommandAllowed(cmd) {
    const allowed = this.config.policy.allowed_commands || [];
    const trimmed = cmd.trim();
    return allowed.some(allowedCmd => {
      // Exact match or starts with allowed prefix
      return trimmed === allowedCmd || trimmed.startsWith(allowedCmd + ' ');
    });
  }

  /**
   * Check if a filesystem path is within allowed paths.
   */
  checkPathAllowed(filePath) {
    const allowed = this.config.policy.allowed_paths || [];
    const normalized = path.normalize(filePath);

    return allowed.some(pattern => {
      if (pattern.endsWith('/**')) {
        const base = pattern.slice(0, -3);
        return normalized.startsWith(base);
      }
      return normalized === pattern || normalized.startsWith(pattern + path.sep);
    });
  }

  /**
   * Check if budget usage is within limits.
   * @param {Object} used - {steps, tokens, timeMinutes, filesModified}
   * @returns {{ok: boolean, reason?: string}}
   */
  checkBudget(used) {
    const b = this.config.budgets;

    if (used.steps !== undefined && used.steps >= b.max_steps) {
      return { ok: false, reason: `Budget exceeded: steps (${used.steps}/${b.max_steps})` };
    }
    if (used.tokens !== undefined && used.tokens >= b.max_tokens) {
      return { ok: false, reason: `Budget exceeded: tokens (${used.tokens}/${b.max_tokens})` };
    }
    if (used.timeMinutes !== undefined && used.timeMinutes >= b.max_time_minutes) {
      return { ok: false, reason: `Budget exceeded: time (${used.timeMinutes}/${b.max_time_minutes} min)` };
    }
    if (used.filesModified !== undefined && used.filesModified >= b.max_files_modified) {
      return { ok: false, reason: `Budget exceeded: files modified (${used.filesModified}/${b.max_files_modified})` };
    }

    // Warn at 80%
    const warnings = [];
    if (used.steps !== undefined && used.steps >= b.max_steps * 0.8) {
      warnings.push(`steps at ${Math.round(used.steps / b.max_steps * 100)}%`);
    }
    if (used.tokens !== undefined && used.tokens >= b.max_tokens * 0.8) {
      warnings.push(`tokens at ${Math.round(used.tokens / b.max_tokens * 100)}%`);
    }

    return { ok: true, warnings: warnings.length > 0 ? warnings : undefined };
  }

  /**
   * Check if a command is dangerous (requires human confirmation).
   */
  isDangerous(cmd) {
    return DANGEROUS_PATTERNS.some(pattern => pattern.test(cmd));
  }

  /**
   * Get budget limits from config.
   */
  getBudgetLimits() {
    return { ...this.config.budgets };
  }

  /**
   * Is network access allowed?
   */
  isNetworkAllowed() {
    return this.config.policy.network_allowed === true;
  }

  /**
   * Are dangerous commands gated behind human confirmation?
   */
  dangerousCommandsRequireHuman() {
    return this.config.policy.dangerous_commands_require_human !== false;
  }

  // ============================================
  // GOVERNANCE METHODS
  // ============================================

  /**
   * Check if an agent role is allowed to access a data class.
   * @param {string} agentRole - role name (e.g., 'engineer')
   * @param {string} dataClass - data class name (e.g., 'pii', 'secrets')
   * @returns {{allowed: boolean, requiresRedaction?: boolean, blocked?: boolean}}
   */
  checkDataClass(agentRole, dataClass) {
    const dataClasses = this.config.governance?.data_classes || [];
    const dc = dataClasses.find(d => d.name === dataClass);

    if (!dc) {
      // Unknown data class - allow by default but warn
      return { allowed: true, unknown: true };
    }

    if (dc.blocked) {
      return { allowed: false, blocked: true };
    }

    if (!dc.allowed_roles.includes(agentRole)) {
      return { allowed: false, reason: `Role '${agentRole}' not in allowed_roles for '${dataClass}'` };
    }

    return {
      allowed: true,
      requiresRedaction: dc.requires_redaction === true
    };
  }

  /**
   * Check if a model is allowed for a given agent role.
   * @param {string} agentRole
   * @param {string} model - model identifier (e.g., 'claude-3-5-sonnet')
   * @returns {boolean}
   */
  checkModelAllowed(agentRole, model) {
    const allowlist = this.config.governance?.model_allowlist || {};
    const roleModels = allowlist[agentRole];

    if (!roleModels || roleModels.length === 0) {
      return false;
    }

    // Support partial matching (e.g., 'claude-sonnet-4-6' matches 'claude-sonnet')
    return roleModels.some(allowedModel =>
      allowedModel && (model === allowedModel || model.startsWith(allowedModel) || allowedModel.startsWith(model))
    );
  }

  /**
   * Check if a prompt requires approval based on context.
   * @param {string} promptId - prompt identifier
   * @param {Object} context - { target_env, ... }
   * @returns {{required: boolean, reason?: string}}
   */
  requiresApproval(promptId, context = {}) {
    const approvalList = this.config.governance?.approval_required || [];

    for (const item of approvalList) {
      if (item === promptId) {
        // Check if it's conditional
        if (promptId === 'ship.patch' && context.target_env === 'prod') {
          return { required: true, reason: 'Production environment patch requires approval' };
        }
        if (promptId === 'ship.rollback_plan') {
          return { required: true, reason: 'Rollback plan always requires approval' };
        }
        return { required: true, reason: `Prompt '${promptId}' requires approval` };
      }
    }

    return { required: false };
  }

  /**
   * Redact PII and sensitive patterns from text.
   * @param {string} text - text to redact
   * @param {string} dataClass - data class (e.g., 'pii')
   * @returns {string} redacted text
   */
  redact(text, dataClass) {
    if (!text || typeof text !== 'string') {
      return text;
    }

    // If data class is secrets, redact everything
    if (dataClass === 'secrets') {
      return '[REDACTED: SECRETS]';
    }

    // If data class doesn't require redaction, just return as-is
    const dc = this.checkDataClass('engineer', dataClass);
    if (!dc.requiresRedaction) {
      return text;
    }

    // Apply PII redactions
    let redacted = text;
    for (const { type, regex } of PII_PATTERNS) {
      redacted = redacted.replace(regex, `[REDACTED:${type.toUpperCase()}]`);
    }

    return redacted;
  }

  /**
   * Infer data class from content analysis.
   * @param {string} text - content to analyze
   * @returns {string} inferred data class
   */
  inferDataClass(text) {
    if (!text) return 'public';

    const lower = text.toLowerCase();

    // Check for secrets indicators
    if (/password|secret|api_key|token|credential|private.?key/i.test(lower)) {
      return 'secrets';
    }

    // Check for PII indicators
    if (/email|phone|ssn|social.?security|date.?of.?birth|address|dob/i.test(lower)) {
      return 'pii';
    }

    // Check for internal indicators
    if (/internal|confidential|proprietary|internal.?use/i.test(lower)) {
      return 'internal';
    }

    return 'public';
  }

  _getRole(roleName) {
    const roles = this.config.rbac?.roles || [];
    return roles.find(r => r.name === roleName) || null;
  }
}

export default PolicyEngine;
