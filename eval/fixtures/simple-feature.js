/**
 * Simple Feature Fixture
 * 
 * A tiny fake repo for testing ShipMachine's ability to add a simple function.
 * Task: Add a hello() function to utils.js that returns 'Hello, World!'
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Create a temporary directory with a simple project structure.
 * @returns {string} path to temp directory
 */
export function createFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipmachine-eval-simple-'));
  
  // Create package.json
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
    name: 'simple-feature-fixture',
    version: '1.0.0',
    type: 'module',
    scripts: {
      test: 'node --test test/*.test.js'
    }
  }, null, 2));

  // Create src/utils.js - the file to modify
  fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'src', 'utils.js'), `// Utility functions

export function add(a, b) {
  return a + b;
}

export function multiply(a, b) {
  return a * b;
}
`);

  // Create test/utils.test.js
  fs.mkdirSync(path.join(tempDir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'test', 'utils.test.js'), `import { describe, it } from 'node:test';
import assert from 'node:assert';
import { add, multiply } from '../src/utils.js';

describe('utils', () => {
  it('add should add two numbers', () => {
    assert.strictEqual(add(1, 2), 3);
  });

  it('multiply should multiply two numbers', () => {
    assert.strictEqual(multiply(3, 4), 12);
  });
});
`);

  return tempDir;
}

/**
 * Expected outcome for this fixture.
 */
export const expectedOutcome = {
  task: "Add a hello() function to utils.js that returns 'Hello, World!'",
  targetFile: 'src/utils.js',
  expectedFunction: "hello",
  expectedReturn: "'Hello, World!'",
  testChecks: [
    'function hello exists',
    'returns Hello, World!',
    'existing tests still pass'
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
