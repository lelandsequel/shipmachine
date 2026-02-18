import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

/**
 * WorkspaceManager — handles repo state, file trees, edits, and diffs.
 */
export class WorkspaceManager {
  constructor(repoPath) {
    this.repoPath = path.resolve(repoPath);
  }

  /**
   * Checkout a branch in the repo.
   * @param {string} repoPath
   * @param {string} branch
   */
  checkout(repoPath, branch) {
    const resolved = path.resolve(repoPath);
    const result = spawnSync('git', ['checkout', branch], {
      cwd: resolved,
      encoding: 'utf8',
    });

    if (result.status !== 0) {
      throw new Error(`WorkspaceManager.checkout: failed to checkout "${branch}": ${result.stderr}`);
    }

    return { branch, repoPath: resolved };
  }

  /**
   * Create a new branch for a task.
   * @param {string} repoPath
   * @param {string} taskId
   * @returns {string} branch name
   */
  createBranch(repoPath, taskId) {
    const resolved = path.resolve(repoPath);
    const timestamp = Date.now();
    const safeName = taskId.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
    const branchName = `shipmachine/${safeName}-${timestamp}`;

    const result = spawnSync('git', ['checkout', '-b', branchName], {
      cwd: resolved,
      encoding: 'utf8',
    });

    if (result.status !== 0) {
      // Branch might already exist
      const checkout = spawnSync('git', ['checkout', branchName], {
        cwd: resolved,
        encoding: 'utf8',
      });
      if (checkout.status !== 0) {
        throw new Error(`WorkspaceManager.createBranch: failed to create "${branchName}": ${result.stderr}`);
      }
    }

    return branchName;
  }

  /**
   * Get a formatted file tree string.
   * @param {string} repoPath
   * @param {number} [maxDepth=4]
   * @returns {string}
   */
  getFileTree(repoPath, maxDepth = 4) {
    const resolved = path.resolve(repoPath);

    // Try using 'tree' command first
    const treeResult = spawnSync('tree', ['-L', String(maxDepth), '--noreport', '-I', 'node_modules|.git|dist|coverage'], {
      cwd: resolved,
      encoding: 'utf8',
    });

    if (treeResult.status === 0) {
      return treeResult.stdout;
    }

    // Fallback: build tree manually
    return this._buildTree(resolved, maxDepth, '', true);
  }

  /**
   * Manually build a tree string.
   */
  _buildTree(dir, maxDepth, prefix, isRoot, depth = 0) {
    if (depth > maxDepth) return '';

    const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage', 'pr-bundles', '.DS_Store']);
    let output = '';

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return '';
    }

    entries = entries.filter(e => !SKIP.has(e.name));
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    entries.forEach((entry, idx) => {
      const isLast = idx === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';

      output += prefix + connector + entry.name + (entry.isDirectory() ? '/' : '') + '\n';

      if (entry.isDirectory() && depth < maxDepth) {
        output += this._buildTree(
          path.join(dir, entry.name),
          maxDepth,
          prefix + childPrefix,
          false,
          depth + 1
        );
      }
    });

    return output;
  }

  /**
   * Apply a list of file edits.
   * @param {Array<{file_path: string, edits: Array<{line_start, line_end, new_content}>}>} edits
   * @returns {{applied: string[], failed: {file: string, error: string}[]}}
   */
  applyEdits(edits) {
    const applied = [];
    const failed = [];

    for (const fileEdit of edits) {
      try {
        this._applyFileEdits(fileEdit.file_path, fileEdit.edits);
        applied.push(fileEdit.file_path);
      } catch (err) {
        failed.push({ file: fileEdit.file_path, error: err.message });
      }
    }

    return { applied, failed };
  }

  /**
   * Apply edits to a single file.
   * @param {string} filePath - absolute path
   * @param {Array<{line_start, line_end, new_content, reason}>} edits
   */
  _applyFileEdits(filePath, edits) {
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.repoPath, filePath);

    // Read existing content (or start with empty for new files)
    let content = '';
    if (fs.existsSync(resolved)) {
      content = fs.readFileSync(resolved, 'utf8');
    }

    let lines = content.split('\n');

    // Sort edits from bottom to top to preserve line numbers
    const sortedEdits = [...edits].sort((a, b) => b.line_start - a.line_start);

    for (const edit of sortedEdits) {
      const { line_start, line_end, new_content } = edit;
      const start = Math.max(0, line_start - 1); // convert to 0-indexed
      const end = Math.min(lines.length, line_end);

      const newLines = new_content ? new_content.split('\n') : [];
      lines.splice(start, end - start, ...newLines);
    }

    const newContent = lines.join('\n');

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, newContent, 'utf8');
  }

  /**
   * Collect unified diff of all uncommitted changes.
   * @param {string} repoPath
   * @returns {string}
   */
  collectDiff(repoPath) {
    const resolved = path.resolve(repoPath);

    const staged = spawnSync('git', ['diff', '--cached'], {
      cwd: resolved,
      encoding: 'utf8',
    });

    const unstaged = spawnSync('git', ['diff'], {
      cwd: resolved,
      encoding: 'utf8',
    });

    return [staged.stdout, unstaged.stdout].filter(Boolean).join('\n');
  }

  /**
   * Get file content, returns empty string if not found.
   * @param {string} relativePath
   * @returns {string}
   */
  readFile(relativePath) {
    const resolved = path.isAbsolute(relativePath)
      ? relativePath
      : path.join(this.repoPath, relativePath);

    try {
      return fs.readFileSync(resolved, 'utf8');
    } catch {
      return '';
    }
  }

  /**
   * Write file content.
   * @param {string} relativePath
   * @param {string} content
   */
  writeFile(relativePath, content) {
    const resolved = path.isAbsolute(relativePath)
      ? relativePath
      : path.join(this.repoPath, relativePath);

    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf8');
  }
}

export default WorkspaceManager;
