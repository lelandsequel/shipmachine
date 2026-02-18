import { spawnSync } from 'child_process';
import path from 'path';

/**
 * ExecTool — policy-gated command execution.
 * Checks command allowlist and dangerous patterns before running.
 */
export class ExecTool {
  constructor(policy) {
    this.policy = policy;
    this.toolName = 'Exec';
    // Track commands that have been confirmed by a human this session
    this._humanConfirmed = new Set();
  }

  _assertToolAccess(role) {
    if (role && !this.policy.checkToolAllowed(role, this.toolName)) {
      throw new Error(`Exec: role "${role}" does not have access to Exec tool`);
    }
  }

  /**
   * Run a command in the given working directory.
   *
   * @param {string} cmd - command to run
   * @param {string} cwd - working directory
   * @param {Object} [opts={}]
   *   - role: agent role for RBAC check
   *   - confirmed: true if a human has confirmed this dangerous command
   *   - timeout: timeout in ms (default 60000)
   *   - env: additional env vars
   * @returns {{stdout: string, stderr: string, exitCode: number, durationMs: number}
   *           | {requiresConfirmation: true, cmd: string, reason: string}}
   */
  run(cmd, cwd, opts = {}) {
    const { role = null, confirmed = false, timeout = 60000, env = {} } = opts;
    this._assertToolAccess(role);

    const resolvedCwd = path.resolve(cwd || process.cwd());

    // Check if dangerous
    if (this.policy.isDangerous(cmd)) {
      if (this.policy.dangerousCommandsRequireHuman() && !confirmed && !this._humanConfirmed.has(cmd)) {
        return {
          requiresConfirmation: true,
          cmd,
          reason: `Command "${cmd}" is flagged as dangerous and requires human confirmation`,
          cwd: resolvedCwd,
        };
      }
    }

    // Check command allowlist
    if (!this.policy.checkCommandAllowed(cmd)) {
      throw new Error(
        `Exec: command not in allowlist: "${cmd}"\n` +
        `Hint: add it to control-plane/config.yaml allowed_commands`
      );
    }

    const startTime = Date.now();

    // Parse command into executable + args
    const parts = cmd.trim().split(/\s+/);
    const executable = parts[0];
    const args = parts.slice(1);

    const result = spawnSync(executable, args, {
      cwd: resolvedCwd,
      encoding: 'utf8',
      timeout,
      env: {
        ...process.env,
        ...env,
        // Disable interactive prompts
        CI: 'true',
        FORCE_COLOR: '0',
      },
      shell: false,
    });

    const durationMs = Date.now() - startTime;

    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.status ?? (result.error ? 1 : 0),
      durationMs,
      timedOut: result.signal === 'SIGTERM',
      error: result.error?.message || null,
    };
  }

  /**
   * Mark a dangerous command as confirmed by a human.
   * Once confirmed in a session, it won't prompt again.
   */
  confirmDangerous(cmd) {
    this._humanConfirmed.add(cmd);
  }

  /**
   * Check if a command is allowed without running it.
   * @param {string} cmd
   * @returns {{allowed: boolean, dangerous: boolean, reason?: string}}
   */
  dryRun(cmd) {
    const allowed = this.policy.checkCommandAllowed(cmd);
    const dangerous = this.policy.isDangerous(cmd);

    return {
      allowed,
      dangerous,
      reason: !allowed
        ? `Command not in allowlist`
        : dangerous
          ? `Command is flagged as dangerous`
          : null,
    };
  }
}

export default ExecTool;
