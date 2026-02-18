import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';
import { PolicyEngine } from '../control-plane/policy.js';
import { RBAC } from '../control-plane/rbac.js';
import { LLMAdapter } from './llm-adapter.js';
import { Analytics } from './analytics.js';

/**
 * PromptOSBridge — the central mediator for all LLM calls in ZeroClaw ShipMachine.
 *
 * Every LLM call goes through this bridge. Never raw. Always:
 * 1. Policy check (role + model + data class)
 * 2. RBAC check
 * 3. Budget check
 * 4. Load prompt spec from registry
 * 5. Render template
 * 6. Call LLM
 * 7. Validate output
 * 8. Log analytics
 * 
 * New execute() signature:
 * execute({ promptId, inputs, user, role, model, channel, context })
 */
export class PromptOSBridge {
  /**
   * @param {string} promptosPath - path to promptos/packs/ directory
   * @param {Object} config - {configPath, model, maxTokens}
   * @param {Analytics} [analytics] - analytics instance (created if not provided)
   */
  constructor(promptosPath, config = {}, analytics = null) {
    this.promptosPath = promptosPath;
    this.config = config;

    // Control plane
    const configPath = config.configPath || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'control-plane', 'config.yaml');
    this.policy = new PolicyEngine(configPath);
    this.rbac = new RBAC();
    this.rbac.loadRoles(configPath);

    // LLM
    this.llm = new LLMAdapter({
      model: config.model,
      maxTokens: config.maxTokens,
    });

    // Analytics
    this.analytics = analytics || new Analytics(config.analyticsDir);

    // Prompt registry cache: promptId → PromptSpec
    this._registry = new Map();
    this._loadRegistry();

    // Run ID for this session
    this._runId = uuidv4();
  }

  /**
   * Get current run ID
   */
  getRunId() {
    return this._runId;
  }

  /**
   * Start a new run (new run ID)
   */
  startNewRun() {
    this._runId = uuidv4();
    return this._runId;
  }

  /**
   * Load all prompt specs from all packs in the promptos path.
   */
  _loadRegistry() {
    const packsDir = this.promptosPath;
    if (!fs.existsSync(packsDir)) {
      console.warn(`PromptOSBridge: packs directory not found: ${packsDir}`);
      return;
    }

    const packDirs = fs.readdirSync(packsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(packsDir, d.name));

    for (const packDir of packDirs) {
      try {
        this._loadPack(packDir);
      } catch (err) {
        console.warn(`PromptOSBridge: failed to load pack at ${packDir}: ${err.message}`);
      }
    }
  }

  /**
   * Load a single prompt pack.
   * @param {string} packDir - path to the pack directory
   */
  _loadPack(packDir) {
    const packYamlPath = path.join(packDir, 'pack.yaml');
    if (!fs.existsSync(packYamlPath)) return;

    const packConfig = yaml.load(fs.readFileSync(packYamlPath, 'utf8'));

    for (const promptRef of (packConfig.prompts || [])) {
      const promptPath = path.join(packDir, promptRef.file);
      try {
        const spec = yaml.load(fs.readFileSync(promptPath, 'utf8'));
        this._registry.set(promptRef.id, {
          ...spec,
          _packName: packConfig.name,
          _packDir: packDir,
        });
      } catch (err) {
        console.warn(`PromptOSBridge: failed to load prompt ${promptRef.id}: ${err.message}`);
      }
    }
  }

  /**
   * Reload the prompt registry (e.g., after adding a new pack).
   */
  reloadRegistry() {
    this._registry.clear();
    this._loadRegistry();
  }

  /**
   * List all registered prompt IDs.
   * @returns {string[]}
   */
  listPrompts() {
    return Array.from(this._registry.keys());
  }

  /**
   * Get a specific prompt spec.
   * @param {string} promptId
   * @returns {Object|null}
   */
  getPromptSpec(promptId) {
    return this._registry.get(promptId) || null;
  }

  /**
   * Execute a prompt through the full PromptOS pipeline.
   * 
   * New signature with governance support:
   * @param {Object} options
   *   - promptId: string
   *   - inputs: object
   *   - user: { id, name, email }
   *   - role: string (agent role)
   *   - model: string (model to use)
   *   - channel: string (telegram, discord, webchat, etc.)
   *   - context: { target_env, ... }
   * @returns {Promise<{promptId, output, tokensUsed, durationMs, policyChecked: true}>}
   */
  async execute(optionsOrPromptId, inputsArg = {}, contextArg = {}) {
    // Support both calling conventions:
    // execute({promptId, inputs, role, ...})  (new style)
    // execute(promptId, inputs, {role, ...})  (orchestrator style)
    let promptId, inputs, user, role, model, channel, context;
    if (typeof optionsOrPromptId === 'string') {
      promptId = optionsOrPromptId;
      inputs = inputsArg || {};
      role = contextArg?.role || 'engineer';
      user = contextArg?.user || null;
      model = contextArg?.model || null;
      channel = contextArg?.channel || 'cli';
      context = contextArg?.context || {};
    } else {
      ({ promptId, inputs = {}, user = null, role = 'engineer', model = null, channel = 'cli', context = {} } = optionsOrPromptId);
    }

    const startTime = Date.now();
    const effectiveModel = model || this.config.model || 'claude-sonnet-4-6';

    // Step 1: Policy check (including model allowlist)
    if (!this.policy.checkPromptAllowed(role, promptId)) {
      throw new Error(`PromptOS: policy denies prompt "${promptId}" for role "${role}"`);
    }

    // Check model allowlist
    if (!this.policy.checkModelAllowed(role, effectiveModel)) {
      throw new Error(`PromptOS: model "${effectiveModel}" not allowed for role "${role}"`);
    }

    // Step 2: RBAC check
    if (!this.rbac.hasPromptAccess(role, promptId)) {
      throw new Error(`PromptOS: RBAC denies prompt "${promptId}" for role "${role}"`);
    }

    // Step 3: Budget check
    const budget = context.budget || {};
    const budgetCheck = this.policy.checkBudget(budget);
    if (!budgetCheck.ok) {
      throw new Error(`PromptOS: budget exceeded — ${budgetCheck.reason}`);
    }
    if (budgetCheck.warnings) {
      console.warn(`⚠️  Budget warning: ${budgetCheck.warnings.join(', ')}`);
    }

    // Step 4: Check approval requirements
    const approvalCheck = this.policy.requiresApproval(promptId, context);
    if (approvalCheck.required && !context.approved) {
      console.warn(`⚠️  Approval required: ${approvalCheck.reason}`);
      // In production, this would block. For now, warn.
    }

    // Step 5: Infer and check data class from inputs
    const inputText = JSON.stringify(inputs);
    const inferredDataClass = this.policy.inferDataClass(inputText);
    const dataClassCheck = this.policy.checkDataClass(role, inferredDataClass);
    if (!dataClassCheck.allowed) {
      throw new Error(`PromptOS: data class "${inferredDataClass}" not allowed for role "${role}"`);
    }

    // Step 6: Load prompt spec from registry
    const spec = this._registry.get(promptId);
    if (!spec) {
      throw new Error(`PromptOS: prompt "${promptId}" not found in registry. Available: ${this.listPrompts().join(', ')}`);
    }

    // Step 7: Redact inputs if needed (for PII data class)
    const sanitizedInputs = dataClassCheck.requiresRedaction
      ? this._redactInputs(inputs)
      : inputs;

    // Step 8: Render prompt template with inputs
    const renderedPrompt = this._renderTemplate(spec.prompt, sanitizedInputs);

    // Step 9: Call LLM
    let llmResult;
    try {
      llmResult = await this.llm.call(renderedPrompt, effectiveModel, spec.outputs?.schema);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      this._logAnalytics({
        promptId,
        stepIndex: context.stepIndex || 0,
        toolCalls: [],
        passed: false,
        failure_reason: err.message,
        durationMs,
        tokensUsed: 0,
        model: effectiveModel,
        role,
        user_id: user?.id || null,
        retryCount: context.retryCount || 0,
        objective_type: context.objective_type || 'feature',
      });
      throw new Error(`PromptOS: LLM call failed for "${promptId}": ${err.message}`);
    }

    const { content, tokensUsed, isMock } = llmResult;
    const durationMs = Date.now() - startTime;

    // Step 10: Validate output schema
    let output = content;
    try {
      output = this._validateOutput(content, spec, promptId);
    } catch (err) {
      console.warn(`PromptOS: output validation warning for "${promptId}": ${err.message}`);
      output = content;
    }

    // Step 11: Log to analytics with full governance context
    this._logAnalytics({
      promptId,
      stepIndex: context.stepIndex || 0,
      toolCalls: context.toolCalls || [],
      passed: true,
      durationMs,
      tokensUsed,
      model: effectiveModel,
      role,
      user_id: user?.id || null,
      retryCount: context.retryCount || 0,
      objective_type: context.objective_type || this._inferObjectiveType(promptId),
      channel,
    });

    return {
      promptId,
      output,
      tokensUsed,
      durationMs,
      policyChecked: true,
      isMock,
      governance: {
        dataClass: inferredDataClass,
        model: effectiveModel,
        role,
        user: user ? { id: user.id, name: user.name } : null,
        channel,
      }
    };
  }

  /**
   * Redact PII from inputs
   */
  _redactInputs(inputs) {
    const redacted = {};
    for (const [key, value] of Object.entries(inputs)) {
      if (typeof value === 'string') {
        redacted[key] = this.policy.redact(value, 'pii');
      } else if (typeof value === 'object') {
        redacted[key] = this._redactInputs(value);
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }

  /**
   * Log analytics with extended governance fields
   */
  _logAnalytics(event) {
    this.analytics.log({
      run_id: this._runId,
      timestamp: new Date().toISOString(),
      objective_type: event.objective_type,
      prompt_id: event.promptId,
      step_index: event.stepIndex,
      tool_calls: event.toolCalls,
      passed: event.passed,
      failure_reason: event.failure_reason || null,
      duration_ms: event.durationMs,
      tokens_used: event.tokensUsed,
      model: event.model,
      role: event.role,
      user_id: event.user_id,
      retry_count: event.retryCount,
      channel: event.channel,
    });
  }

  /**
   * Infer objective type from prompt ID
   */
  _inferObjectiveType(promptId) {
    if (promptId.includes('fix') || promptId.includes('bug')) return 'bugfix';
    if (promptId.includes('refactor')) return 'refactor';
    if (promptId.includes('migration')) return 'migration';
    return 'feature';
  }

  /**
   * Render a prompt template by substituting {{var}} placeholders.
   * @param {string} template
   * @param {Object} inputs
   * @returns {string}
   */
  _renderTemplate(template, inputs) {
    if (!template) return '';

    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const value = inputs[key];
      if (value === undefined || value === null) {
        return `[${key}: not provided]`;
      }
      if (typeof value === 'object') {
        return JSON.stringify(value, null, 2);
      }
      return String(value);
    });
  }

  /**
   * Validate LLM output against the prompt spec's expected schema.
   * Basic validation — checks required top-level keys exist.
   */
  _validateOutput(content, spec, promptId) {
    if (!spec.outputs?.schema) return content;

    // Check that content is an object (not a string or null)
    if (typeof content !== 'object' || content === null) {
      throw new Error(`Expected JSON object output for "${promptId}", got: ${typeof content}`);
    }

    const schema = spec.outputs.schema;

    // Check required top-level properties exist
    if (schema.required && Array.isArray(schema.required)) {
      const missing = schema.required.filter(key => !(key in content));
      if (missing.length > 0) {
        throw new Error(`Missing required output fields for "${promptId}": ${missing.join(', ')}`);
      }
    }

    // Check that typed properties have right types
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in content && propSchema.type) {
          const actualType = Array.isArray(content[key]) ? 'array' : typeof content[key];
          if (actualType !== propSchema.type) {
            console.warn(`PromptOS: output field "${key}" expected ${propSchema.type}, got ${actualType}`);
          }
        }
      }
    }

    return content;
  }
}

export default PromptOSBridge;
