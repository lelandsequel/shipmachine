/**
 * Bugfix Fixture
 * 
 * A tiny fake repo with a bug (off-by-one error).
 * Task: Fix the off-by-one error in getLastItem()
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Create a temporary directory with a buggy project.
 * @returns {string} path to temp directory
 */
export function createFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroclaw-eval-bugfix-'));
  
  // Create package.json
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
    name: 'bugfix-fixture',
    version: '1.0.0',
    type: 'module',
    scripts: {
      test: 'node --test test/*.test.js'
    }
  }, null, 2));

  // Create src/list.js - has a bug (off-by-one in getLastItem)
  fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'src', 'list.js'), `// List utilities

/**
 * Get the last item in an array.
 * BUG: Returns undefined for single-element arrays (off-by-one)
 */
export function getLastItem(arr) {
  if (!arr || arr.length === 0) {
    return undefined;
  }
  // Off-by-one: should be arr[arr.length - 1]
  return arr[arr.length];
}

/**
 * Get the first item in an array.
 */
export function getFirstItem(arr) {
  if (!arr || arr.length === 0) {
    return undefined;
  }
  return arr[0];
}

/**
 * Reverse an array.
 */
export function reverseArray(arr) {
  if (!arr) return [];
  return [...arr].reverse();
}
`);

  // Create test/list.test.js
  fs.mkdirSync(path.join(tempDir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'test', 'list.test.js'), `import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getLastItem, getFirstItem, reverseArray } from '../src/list.js';

describe('list', () => {
  it('getLastItem should return last element', () => {
    assert.strictEqual(getLastItem([1, 2, 3]), 3);
  });

  it('getLastItem should handle single element', () => {
    assert.strictEqual(getLastItem([42]), 42);
  });

  it('getLastItem should return undefined for empty', () => {
    assert.strictEqual(getLastItem([]), undefined);
  });

  it('getFirstItem should return first element', () => {
    assert.strictEqual(getFirstItem([1, 2, 3]), 1);
  });

  it('reverseArray should reverse', () => {
    assert.deepStrictEqual(reverseArray([1, 2, 3]), [3, 2, 1]);
  });
});
`);

  return tempDir;
}

/**
 * Expected outcome for this fixture.
 */
export const expectedOutcome = {
  task: "Fix the off-by-one error in getLastItem()",
  targetFile: 'src/list.js',
  bugDescription: 'getLastItem returns arr[arr.length] instead of arr[arr.length - 1]',
  expectedFix: 'Change arr[arr.length] to arr[arr.length - 1]',
  testChecks: [
    'getLastItem([42]) returns 42',
    'getLastItem([1,2,3]) returns 3',
    'all existing tests pass'
  ]
};

/**
 * Clean up the fixture.
 * @param {string} tempDir 
 */
export function cleanupFixture(tempDir) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

export default { createFixture, expectedOutcome, cleanupFixture };
