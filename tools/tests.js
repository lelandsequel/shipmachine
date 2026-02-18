import path from 'path';

/**
 * TestsTool — policy-gated test execution and result parsing.
 * Supports Jest, Pytest, Cargo test, and Go test output formats.
 */
export class TestsTool {
  constructor(policy, execTool) {
    this.policy = policy;
    this.exec = execTool;
    this.toolName = 'Tests';
  }

  _assertToolAccess(role) {
    if (role && !this.policy.checkToolAllowed(role, this.toolName)) {
      throw new Error(`Tests: role "${role}" does not have access to Tests tool`);
    }
  }

  /**
   * Run tests in a repo.
   * @param {string} repoPath
   * @param {string} cmd - test command (e.g. "npm test", "pytest")
   * @param {string} [role]
   * @returns {{passed: number, failed: number, total: number, output: string, exitCode: number}}
   */
  run(repoPath, cmd, role = null) {
    this._assertToolAccess(role);

    const result = this.exec.run(cmd, repoPath, { role });

    // If exec returned a confirmation request (dangerous command)
    if (result.requiresConfirmation) {
      return {
        passed: 0,
        failed: 0,
        total: 0,
        output: `Test run blocked: ${result.reason}`,
        exitCode: -1,
        requiresConfirmation: true,
      };
    }

    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    const parsed = this.parse_results(output, 'auto');

    return {
      passed: parsed.passed,
      failed: parsed.failed,
      total: parsed.total,
      output,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      format: parsed.format,
    };
  }

  /**
   * Parse test output and extract pass/fail counts.
   * Auto-detects format from output content.
   *
   * @param {string} output - raw test output
   * @param {string} [format='auto'] - 'auto'|'jest'|'pytest'|'cargo'|'go'|'mocha'
   * @returns {{passed: number, failed: number, total: number, format: string, failures: string[]}}
   */
  parse_results(output, format = 'auto') {
    if (format === 'auto') {
      format = this._detectFormat(output);
    }

    switch (format) {
      case 'jest':
        return this._parseJest(output);
      case 'pytest':
        return this._parsePytest(output);
      case 'cargo':
        return this._parseCargo(output);
      case 'go':
        return this._parseGo(output);
      case 'mocha':
        return this._parseMocha(output);
      default:
        return this._parseGeneric(output);
    }
  }

  /**
   * Detect the test framework from output.
   */
  _detectFormat(output) {
    if (/PASS|FAIL|Tests:.*passed/i.test(output) && /jest/i.test(output)) return 'jest';
    if (/passed|failed|error/i.test(output) && /pytest|py\.test/i.test(output)) return 'pytest';
    if (/^test result:/m.test(output) || /cargo test/i.test(output)) return 'cargo';
    if (/^--- (PASS|FAIL)/m.test(output) || /^ok\s+\S+/m.test(output)) return 'go';
    if (/passing|failing/i.test(output) && /mocha/i.test(output)) return 'mocha';
    if (/\d+ passed/i.test(output)) return 'pytest'; // fallback for pytest-like
    if (/Tests:.*\d+/i.test(output)) return 'jest'; // fallback for jest-like
    return 'generic';
  }

  /**
   * Parse Jest output.
   */
  _parseJest(output) {
    const failures = [];
    let passed = 0, failed = 0, total = 0;

    // Tests: 5 passed, 2 failed, 7 total
    const summaryMatch = output.match(/Tests:\s+(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+passed,\s*)?(\d+)\s+total/i);
    if (summaryMatch) {
      failed = parseInt(summaryMatch[1] || '0');
      passed = parseInt(summaryMatch[2] || '0');
      total = parseInt(summaryMatch[3] || '0');
    }

    // Extract failing test names
    const failMatches = output.matchAll(/✕ (.+)|● (.+)/g);
    for (const match of failMatches) {
      failures.push(match[1] || match[2]);
    }

    return { passed, failed, total, format: 'jest', failures };
  }

  /**
   * Parse Pytest output.
   */
  _parsePytest(output) {
    const failures = [];
    let passed = 0, failed = 0, total = 0;

    // "5 passed, 2 failed" or "7 passed" or "2 failed"
    const summaryMatch = output.match(/(\d+)\s+passed(?:,\s*(\d+)\s+failed)?|(\d+)\s+failed(?:,\s*(\d+)\s+passed)?/i);
    if (summaryMatch) {
      if (summaryMatch[1]) {
        passed = parseInt(summaryMatch[1]);
        failed = parseInt(summaryMatch[2] || '0');
      } else {
        failed = parseInt(summaryMatch[3]);
        passed = parseInt(summaryMatch[4] || '0');
      }
      total = passed + failed;
    }

    // Extract FAILED test names
    const failLines = output.matchAll(/^FAILED (.+)/gm);
    for (const match of failLines) {
      failures.push(match[1].trim());
    }

    return { passed, failed, total, format: 'pytest', failures };
  }

  /**
   * Parse Cargo test output.
   */
  _parseCargo(output) {
    const failures = [];
    let passed = 0, failed = 0, total = 0;

    // "test result: ok. 5 passed; 0 failed"
    const resultMatch = output.match(/test result:.*?(\d+)\s+passed;\s+(\d+)\s+failed/i);
    if (resultMatch) {
      passed = parseInt(resultMatch[1]);
      failed = parseInt(resultMatch[2]);
      total = passed + failed;
    }

    // Extract failing test names
    const failLines = output.matchAll(/^FAILED\s+(.+)/gm);
    for (const match of failLines) {
      failures.push(match[1].trim());
    }

    return { passed, failed, total, format: 'cargo', failures };
  }

  /**
   * Parse Go test output.
   */
  _parseGo(output) {
    const failures = [];
    let passed = 0, failed = 0, total = 0;

    // Count PASS/FAIL lines
    const passLines = (output.match(/^--- PASS/gm) || []).length;
    const failLines = (output.match(/^--- FAIL/gm) || []).length;

    passed = passLines;
    failed = failLines;
    total = passed + failed;

    // Extract failing test names
    const failMatches = output.matchAll(/^--- FAIL: (\S+)/gm);
    for (const match of failMatches) {
      failures.push(match[1]);
    }

    return { passed, failed, total, format: 'go', failures };
  }

  /**
   * Parse Mocha output.
   */
  _parseMocha(output) {
    const failures = [];
    let passed = 0, failed = 0, total = 0;

    const passMatch = output.match(/(\d+)\s+passing/i);
    const failMatch = output.match(/(\d+)\s+failing/i);

    passed = parseInt(passMatch?.[1] || '0');
    failed = parseInt(failMatch?.[1] || '0');
    total = passed + failed;

    return { passed, failed, total, format: 'mocha', failures };
  }

  /**
   * Generic fallback parser.
   */
  _parseGeneric(output) {
    let passed = 0, failed = 0;

    const passMatch = output.match(/(\d+)\s+(?:test[s]?\s+)?pass(?:ed|ing)/i);
    const failMatch = output.match(/(\d+)\s+(?:test[s]?\s+)?fail(?:ed|ing)/i);

    passed = parseInt(passMatch?.[1] || '0');
    failed = parseInt(failMatch?.[1] || '0');

    return {
      passed,
      failed,
      total: passed + failed,
      format: 'generic',
      failures: [],
    };
  }
}

export default TestsTool;
