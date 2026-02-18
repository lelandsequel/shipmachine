import fs from 'fs';
import yaml from 'js-yaml';

/**
 * RBAC — Role-Based Access Control for ZeroClaw ShipMachine.
 * Manages which agent roles can access which prompts and tools.
 */
export class RBAC {
  constructor() {
    this.roles = new Map(); // roleName → {name, allowed_prompts, allowed_tools}
  }

  /**
   * Load roles from a config.yaml file.
   * @param {string} configPath - path to control-plane/config.yaml
   */
  loadRoles(configPath) {
    let config;
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      config = yaml.load(raw);
    } catch (err) {
      throw new Error(`RBAC: failed to load config from ${configPath}: ${err.message}`);
    }

    const roleList = config.rbac?.roles || [];
    this.roles.clear();

    for (const role of roleList) {
      if (!role.name) {
        throw new Error('RBAC: role missing required "name" field');
      }
      this.roles.set(role.name, {
        name: role.name,
        allowed_prompts: role.allowed_prompts || [],
        allowed_tools: role.allowed_tools || [],
      });
    }

    return this;
  }

  /**
   * Add a role programmatically (useful for testing).
   */
  addRole(name, { allowed_prompts = [], allowed_tools = [] } = {}) {
    this.roles.set(name, { name, allowed_prompts, allowed_tools });
    return this;
  }

  /**
   * Check if a role has access to a prompt.
   * Supports wildcard patterns like "ship.*"
   *
   * @param {string} role - role name
   * @param {string} promptId - e.g. "ship.plan"
   * @returns {boolean}
   */
  hasPromptAccess(role, promptId) {
    const roleConfig = this.roles.get(role);
    if (!roleConfig) return false;

    return roleConfig.allowed_prompts.some(pattern => {
      return this._matchPattern(pattern, promptId);
    });
  }

  /**
   * Check if a role has access to a tool.
   *
   * @param {string} role - role name
   * @param {string} tool - e.g. "FS", "Git", "Exec"
   * @returns {boolean}
   */
  hasToolAccess(role, tool) {
    const roleConfig = this.roles.get(role);
    if (!roleConfig) return false;

    return roleConfig.allowed_tools.includes(tool);
  }

  /**
   * Get all roles as an array.
   */
  getRoles() {
    return Array.from(this.roles.values());
  }

  /**
   * Get a specific role config.
   */
  getRole(roleName) {
    return this.roles.get(roleName) || null;
  }

  /**
   * Match a pattern against a promptId.
   * Supports:
   *   - Exact match: "ship.plan"
   *   - Wildcard suffix: "ship.*" → matches "ship.plan", "ship.patch", etc.
   *
   * @param {string} pattern
   * @param {string} promptId
   * @returns {boolean}
   */
  _matchPattern(pattern, promptId) {
    if (pattern === promptId) return true;

    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2); // remove ".*"
      // Match any promptId that starts with the prefix followed by "."
      return promptId === prefix || promptId.startsWith(prefix + '.');
    }

    // Support glob-style wildcards at any position
    if (pattern.includes('*')) {
      const regexStr = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '[^.]+');
      const regex = new RegExp(`^${regexStr}$`);
      return regex.test(promptId);
    }

    return false;
  }
}

export default RBAC;
