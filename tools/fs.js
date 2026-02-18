import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * FilesystemTool — policy-gated filesystem operations.
 * All methods validate path against PolicyEngine before executing.
 */
export class FilesystemTool {
  constructor(policy) {
    this.policy = policy;
    this.toolName = 'FS';
  }

  /**
   * Validate that a path is allowed by policy.
   * Throws if not allowed.
   */
  _assertPathAllowed(filePath) {
    if (!this.policy.checkPathAllowed(filePath)) {
      throw new Error(`FS: path not allowed by policy: ${filePath}`);
    }
  }

  /**
   * Validate that the role has FS tool access.
   */
  _assertToolAccess(role) {
    if (role && !this.policy.checkToolAllowed(role, this.toolName)) {
      throw new Error(`FS: role "${role}" does not have access to FS tool`);
    }
  }

  /**
   * Read file contents.
   * @param {string} filePath - absolute or relative path
   * @param {string} [role] - agent role for RBAC check
   * @returns {string} file contents
   */
  read_file(filePath, role = null) {
    const resolved = path.resolve(filePath);
    this._assertToolAccess(role);
    this._assertPathAllowed(resolved);

    try {
      return fs.readFileSync(resolved, 'utf8');
    } catch (err) {
      throw new Error(`FS.read_file: failed to read "${resolved}": ${err.message}`);
    }
  }

  /**
   * Write content to a file. Creates parent directories if needed.
   * @param {string} filePath
   * @param {string} content
   * @param {string} [role]
   */
  write_file(filePath, content, role = null) {
    const resolved = path.resolve(filePath);
    this._assertToolAccess(role);
    this._assertPathAllowed(resolved);

    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, content, 'utf8');
    } catch (err) {
      throw new Error(`FS.write_file: failed to write "${resolved}": ${err.message}`);
    }
  }

  /**
   * List directory contents.
   * @param {string} dirPath
   * @param {boolean} [recursive=false]
   * @param {string} [role]
   * @returns {string[]} list of paths
   */
  list_dir(dirPath, recursive = false, role = null) {
    const resolved = path.resolve(dirPath);
    this._assertToolAccess(role);
    this._assertPathAllowed(resolved);

    try {
      if (!recursive) {
        return fs.readdirSync(resolved).map(f => path.join(resolved, f));
      }

      const results = [];
      const walk = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          results.push(fullPath);
          if (entry.isDirectory()) {
            walk(fullPath);
          }
        }
      };
      walk(resolved);
      return results;
    } catch (err) {
      throw new Error(`FS.list_dir: failed to list "${resolved}": ${err.message}`);
    }
  }

  /**
   * Search for a pattern in files (grep-style).
   * @param {string} pattern - regex or string pattern
   * @param {string} dir - directory to search in
   * @param {string} [role]
   * @returns {{file: string, line: number, match: string}[]}
   */
  search(pattern, dir, role = null) {
    const resolved = path.resolve(dir);
    this._assertToolAccess(role);
    this._assertPathAllowed(resolved);

    const results = [];

    const searchInFile = (filePath) => {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const regex = new RegExp(pattern, 'gi');

        lines.forEach((line, idx) => {
          if (regex.test(line)) {
            results.push({
              file: filePath,
              line: idx + 1,
              match: line.trim(),
            });
          }
          regex.lastIndex = 0; // reset for global regex
        });
      } catch {
        // Skip binary files or unreadable files
      }
    };

    const walkAndSearch = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        // Skip node_modules, .git, etc.
        if (entry.name === 'node_modules' || entry.name === '.git') continue;

        if (entry.isDirectory()) {
          walkAndSearch(fullPath);
        } else if (entry.isFile()) {
          searchInFile(fullPath);
        }
      }
    };

    walkAndSearch(resolved);
    return results;
  }

  /**
   * Check if a path exists.
   * @param {string} filePath
   * @returns {boolean}
   */
  exists(filePath) {
    const resolved = path.resolve(filePath);
    return fs.existsSync(resolved);
  }

  /**
   * Get file stats (size, mtime, etc.)
   * @param {string} filePath
   * @param {string} [role]
   * @returns {fs.Stats}
   */
  stat(filePath, role = null) {
    const resolved = path.resolve(filePath);
    this._assertToolAccess(role);
    this._assertPathAllowed(resolved);

    try {
      return fs.statSync(resolved);
    } catch (err) {
      throw new Error(`FS.stat: failed to stat "${resolved}": ${err.message}`);
    }
  }
}

export default FilesystemTool;
