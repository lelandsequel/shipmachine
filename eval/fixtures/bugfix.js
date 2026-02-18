/**
 * Eval Fixture: bugfix
 * Task: Fix the off-by-one error in getLastItem()
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

export const FIXTURE_ID = 'bugfix';
export const DESCRIPTION = 'Fix the off-by-one error in getLastItem() in array-utils.js';
export const OBJECTIVE_TYPE = 'bugfix';

export function setup() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroclaw-fixture-'));

  execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config user.email "test@zeroclaw.dev"', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config user.name "ZeroClaw Test"', { cwd: tmpDir, stdio: 'pipe' });

  // File with the bug: array.length instead of array.length - 1
  fs.writeFileSync(path.join(tmpDir, 'array-utils.js'), `// Array utility functions

export function getLastItem(array) {
  if (!array || array.length === 0) return undefined;
  return array[array.length]; // BUG: should be array.length - 1
}

export function getFirstItem(array) {
  if (!array || array.length === 0) return undefined;
  return array[0];
}

export function getMiddleItem(array) {
  if (!array || array.length === 0) return undefined;
  return array[Math.floor(array.length / 2)];
}
`, 'utf8');

  // Tests that will FAIL due to the bug
  fs.writeFileSync(path.join(tmpDir, 'array-utils.test.js'), `import { getLastItem, getFirstItem, getMiddleItem } from './array-utils.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(\`  ✓ \${name}\`);
    passed++;
  } catch (e) {
    console.log(\`  ✗ \${name}: \${e.message}\`);
    failed++;
  }
}

function assertEquals(a, b) {
  if (a !== b) throw new Error(\`Expected \${JSON.stringify(b)}, got \${JSON.stringify(a)}\`);
}

test('getLastItem([1,2,3]) === 3', () => assertEquals(getLastItem([1, 2, 3]), 3));
test('getLastItem([5]) === 5', () => assertEquals(getLastItem([5]), 5));
test('getLastItem([]) === undefined', () => assertEquals(getLastItem([]), undefined));
test('getFirstItem([1,2,3]) === 1', () => assertEquals(getFirstItem([1, 2, 3]), 1));
test('getMiddleItem([1,2,3]) === 2', () => assertEquals(getMiddleItem([1, 2, 3]), 2));

if (failed > 0) {
  console.log(\`\\n\${failed} test(s) failed.\`);
  process.exit(1);
}
console.log(\`\\nAll \${passed} tests passed.\`);
`, 'utf8');

  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
    name: 'fixture-bugfix',
    type: 'module',
    version: '1.0.0',
    scripts: { test: 'node array-utils.test.js' },
  }, null, 2), 'utf8');

  execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git commit -m "Initial commit (with bug)"', { cwd: tmpDir, stdio: 'pipe' });

  return tmpDir;
}

export const TASK = {
  objective: 'Fix the off-by-one error in getLastItem() in array-utils.js. The function returns undefined instead of the last element because it accesses array[array.length] instead of array[array.length - 1].',
  objective_type: OBJECTIVE_TYPE,
  expected_outputs: {
    files_modified: ['array-utils.js'],
    test_should_pass: true,
    pr_bundle_exists: true,
  },
};

export function verify(repoPath, result) {
  const checks = [];

  // Check 1: Bug fixed in source
  const content = fs.readFileSync(path.join(repoPath, 'array-utils.js'), 'utf8');
  const bugFixed = content.includes('array.length - 1') && !content.includes('array[array.length]');
  checks.push({
    name: 'Off-by-one bug fixed in source',
    passed: bugFixed,
    detail: bugFixed ? 'array.length - 1 found, buggy line removed' : 'Bug still present or fix incomplete',
  });

  // Check 2: Tests pass after fix
  try {
    execSync('node array-utils.test.js', { cwd: repoPath, stdio: 'pipe' });
    checks.push({ name: 'Tests pass after fix', passed: true, detail: 'Exit code 0' });
  } catch (e) {
    checks.push({ name: 'Tests pass after fix', passed: false, detail: e.stderr?.toString() || e.message });
  }

  // Check 3: PR bundle
  const bundleExists = result?.prBundle?.PR_DESCRIPTION || result?.prBundlePath;
  checks.push({
    name: 'PR bundle generated',
    passed: !!bundleExists,
    detail: bundleExists ? 'PR bundle exists' : 'Missing PR bundle',
  });

  // Check 4: Policy clean
  const violations = result?.policyViolations || [];
  checks.push({
    name: 'No policy violations',
    passed: violations.length === 0,
    detail: violations.length === 0 ? 'Clean' : violations.join(', '),
  });

  return {
    passed: checks.every(c => c.passed),
    checks,
  };
}

export function cleanup(repoPath) {
  fs.rmSync(repoPath, { recursive: true, force: true });
}
