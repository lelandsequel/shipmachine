import { execSync, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * GitTool — policy-gated git operations.
 * Wraps git CLI commands for use by the ShipMachine orchestrator.
 */
export class GitTool {
  constructor(policy) {
    this.policy = policy;
    this.toolName = 'Git';
  }

  _assertToolAccess(role) {
    if (role && !this.policy.checkToolAllowed(role, this.toolName)) {
      throw new Error(`Git: role "${role}" does not have access to Git tool`);
    }
  }

  _assertPathAllowed(repoPath) {
    if (!this.policy.checkPathAllowed(repoPath)) {
      throw new Error(`Git: repo path not allowed by policy: ${repoPath}`);
    }
  }

  /**
   * Run a git command in a repo directory.
   * @param {string} repoPath
   * @param {string[]} args - git arguments
   * @returns {{stdout: string, stderr: string, exitCode: number}}
   */
  _git(repoPath, args) {
    const result = spawnSync('git', args, {
      cwd: repoPath,
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.status ?? 1,
    };
  }

  /**
   * Get git status of the repo.
   * @param {string} repoPath
   * @param {string} [role]
   * @returns {{branch: string, staged: string[], unstaged: string[], untracked: string[], raw: string}}
   */
  status(repoPath, role = null) {
    const resolved = path.resolve(repoPath);
    this._assertToolAccess(role);
    this._assertPathAllowed(resolved);

    const { stdout, exitCode } = this._git(resolved, ['status', '--porcelain', '-b']);

    if (exitCode !== 0) {
      throw new Error(`Git.status: failed in ${resolved}`);
    }

    const lines = stdout.trim().split('\n');
    const branchLine = lines[0] || '';
    const branchMatch = branchLine.match(/^## (.+?)(?:\.\.\..*)?$/);
    const branch = branchMatch ? branchMatch[1] : 'unknown';

    const staged = [];
    const unstaged = [];
    const untracked = [];

    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const xy = line.slice(0, 2);
      const file = line.slice(3);

      if (xy[0] !== ' ' && xy[0] !== '?') staged.push(file);
      if (xy[1] !== ' ' && xy[1] !== '?') unstaged.push(file);
      if (xy === '??') untracked.push(file);
    }

    return { branch, staged, unstaged, untracked, raw: stdout };
  }

  /**
   * Get unified diff of working changes.
   * @param {string} repoPath
   * @param {string} [role]
   * @returns {string} unified diff
   */
  diff(repoPath, role = null) {
    const resolved = path.resolve(repoPath);
    this._assertToolAccess(role);
    this._assertPathAllowed(resolved);

    // Get diff of staged + unstaged
    const staged = this._git(resolved, ['diff', '--cached']);
    const unstaged = this._git(resolved, ['diff']);

    return [staged.stdout, unstaged.stdout].filter(Boolean).join('\n');
  }

  /**
   * Create or switch to a branch.
   * @param {string} repoPath
   * @param {string} name - branch name
   * @param {string} [role]
   */
  branch(repoPath, name, role = null) {
    const resolved = path.resolve(repoPath);
    this._assertToolAccess(role);
    this._assertPathAllowed(resolved);

    if (!name || !/^[a-zA-Z0-9/_.-]+$/.test(name)) {
      throw new Error(`Git.branch: invalid branch name "${name}"`);
    }

    // Try to checkout existing branch first, then create
    let result = this._git(resolved, ['checkout', name]);
    if (result.exitCode !== 0) {
      result = this._git(resolved, ['checkout', '-b', name]);
      if (result.exitCode !== 0) {
        throw new Error(`Git.branch: failed to create/switch to branch "${name}": ${result.stderr}`);
      }
    }

    return { branch: name, created: true };
  }

  /**
   * Stage all changes and create a commit.
   * @param {string} repoPath
   * @param {string} message - commit message
   * @param {string} [role]
   * @returns {{sha: string, message: string}}
   */
  commit(repoPath, message, role = null) {
    const resolved = path.resolve(repoPath);
    this._assertToolAccess(role);
    this._assertPathAllowed(resolved);

    if (!message || message.trim().length === 0) {
      throw new Error('Git.commit: commit message cannot be empty');
    }

    // Stage all
    const addResult = this._git(resolved, ['add', '-A']);
    if (addResult.exitCode !== 0) {
      throw new Error(`Git.commit: failed to stage files: ${addResult.stderr}`);
    }

    // Commit
    const commitResult = this._git(resolved, ['commit', '-m', message]);
    if (commitResult.exitCode !== 0) {
      throw new Error(`Git.commit: failed to commit: ${commitResult.stderr}`);
    }

    // Get the commit SHA
    const shaResult = this._git(resolved, ['rev-parse', 'HEAD']);
    const sha = shaResult.stdout.trim().slice(0, 8);

    return { sha, message };
  }

  /**
   * Apply a unified diff patch to the repo.
   * @param {string} repoPath
   * @param {string} patch - unified diff content
   * @param {string} [role]
   * @returns {{applied: boolean, output: string}}
   */
  apply_patch(repoPath, patch, role = null) {
    const resolved = path.resolve(repoPath);
    this._assertToolAccess(role);
    this._assertPathAllowed(resolved);

    if (!patch || patch.trim().length === 0) {
      throw new Error('Git.apply_patch: patch content is empty');
    }

    // Write patch to a temp file
    const tmpPath = path.join(resolved, '.tmp_patch_apply.diff');
    try {
      fs.writeFileSync(tmpPath, patch, 'utf8');

      // Try git apply
      const result = this._git(resolved, ['apply', '--index', tmpPath]);

      if (result.exitCode !== 0) {
        // Try with --reject to get partial application
        const rejectResult = this._git(resolved, ['apply', '--reject', tmpPath]);
        return {
          applied: false,
          output: result.stderr || rejectResult.stderr,
          error: true,
        };
      }

      return { applied: true, output: result.stdout };
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  /**
   * Get current branch name.
   * @param {string} repoPath
   * @returns {string}
   */
  currentBranch(repoPath) {
    const resolved = path.resolve(repoPath);
    const result = this._git(resolved, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return result.stdout.trim();
  }

  /**
   * Get recent commit log.
   * @param {string} repoPath
   * @param {number} [limit=10]
   * @returns {{sha: string, message: string, date: string}[]}
   */
  log(repoPath, limit = 10) {
    const resolved = path.resolve(repoPath);
    const result = this._git(resolved, [
      'log',
      `--max-count=${limit}`,
      '--pretty=format:%H|%s|%ai',
    ]);

    return result.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [sha, message, date] = line.split('|');
        return { sha: sha.slice(0, 8), message, date };
      });
  }
}

export default GitTool;
