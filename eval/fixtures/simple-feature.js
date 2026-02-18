/**
 * Eval Fixture: simple-feature
 * Task: Add a hello() function to utils.js
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

export const FIXTURE_ID = 'simple-feature';
export const DESCRIPTION = 'Add a hello() function to utils.js that returns "Hello, World!"';
export const OBJECTIVE_TYPE = 'feature';

/**
 * Set up the fixture: create a temporary repo with initial files.
 * @returns {string} path to the temp repo
 */
export function setup() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroclaw-fixture-'));

  // Initialize git repo
  execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config user.email "test@zeroclaw.dev"', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config user.name "ZeroClaw Test"', { cwd: tmpDir, stdio: 'pipe' });

  // Create initial files
  fs.writeFileSync(path.join(tmpDir, 'utils.js'), `// Utility functions

export function add(a, b) {
  return a + b;
}

export function multiply(a, b) {
  return a * b;
}
`, 'utf8');

  fs.writeFileSync(path.join(tmpDir, 'utils.test.js'), `import { add, multiply } from './utils.js';

// Test add
const sum = add(2, 3);
if (sum !== 5) throw new Error(\`add: expected 5, got \${sum}\`);

// Test multiply
const product = multiply(3, 4);
if (product !== 12) throw new Error(\`multiply: expected 12, got \${product}\`);

console.log('All tests passed!');
`, 'utf8');

  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
    name: 'fixture-simple-feature',
    type: 'module',
    version: '1.0.0',
    scripts: { test: 'node utils.test.js' },
  }, null, 2), 'utf8');

  // Initial commit
  execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: tmpDir, stdio: 'pipe' });

  return tmpDir;
}

export const TASK = {
  objective: 'Add a hello() function to utils.js that takes an optional name parameter and returns "Hello, {name}!" or "Hello, World!" if no name provided. Add tests for it.',
  objective_type: OBJECTIVE_TYPE,
  expected_outputs: {
    files_modified: ['utils.js', 'utils.test.js'],
    test_should_pass: true,
    pr_bundle_exists: true,
  },
};

/**
 * Verify the fixture result.
 * @param {string} repoPath
 * @param {Object} result - ShipMachine run result
 * @returns {{passed: boolean, checks: {name: string, passed: boolean, detail: string}[]}}
 */
export function verify(repoPath, result) {
  const checks = [];

  // Check 1: utils.js was modified
  const utilsContent = fs.readFileSync(path.join(repoPath, 'utils.js'), 'utf8');
  const hasHello = utilsContent.includes('hello') || utilsContent.includes('Hello');
  checks.push({
    name: 'hello() function added to utils.js',
    passed: hasHello,
    detail: hasHello ? 'Found hello in utils.js' : 'hello() function not found in utils.js',
  });

  // Check 2: Tests pass
  try {
    execSync('node utils.test.js', { cwd: repoPath, stdio: 'pipe' });
    checks.push({ name: 'Tests pass', passed: true, detail: 'node utils.test.js exited 0' });
  } catch (e) {
    checks.push({ name: 'Tests pass', passed: false, detail: e.message });
  }

  // Check 3: PR bundle generated
  const bundleExists = result?.prBundle?.PR_DESCRIPTION || result?.prBundlePath;
  checks.push({
    name: 'PR bundle generated',
    passed: !!bundleExists,
    detail: bundleExists ? 'PR_DESCRIPTION.md exists' : 'No PR bundle in result',
  });

  // Check 4: No policy violations
  const violations = result?.policyViolations || [];
  checks.push({
    name: 'No policy violations',
    passed: violations.length === 0,
    detail: violations.length === 0 ? 'Clean' : `Violations: ${violations.join(', ')}`,
  });

  return {
    passed: checks.every(c => c.passed),
    checks,
  };
}

/**
 * Cleanup the temp repo.
 * @param {string} repoPath
 */
export function cleanup(repoPath) {
  fs.rmSync(repoPath, { recursive: true, force: true });
}
