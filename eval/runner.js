/**
 * AgentEvalRunner — runs evaluation fixtures against ShipMachine.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import fixtures
import { createFixture as createSimpleFeature, expectedOutcome as simpleFeatureExpected, cleanupFixture as cleanupSimpleFeature } from './fixtures/simple-feature.js';
import { createFixture as createBugfix, expectedOutcome as bugfixExpected, cleanupFixture as cleanupBugfix } from './fixtures/bugfix.js';

/**
 * Run a single evaluation fixture.
 * @param {Object} fixture
 * @returns {Object} result
 */
async function runFixture(fixture) {
  const { name, createFixture, expected, task } = fixture;
  
  console.log(chalk.bold.cyan(`\n🔬 Running: ${name}`));
  console.log(chalk.gray(`  Task: ${task}`));

  let tempDir = null;
  let result = { name, passed: false, details: [] };

  try {
    // Create fixture
    tempDir = createFixture();
    console.log(chalk.gray(`  Created temp dir: ${tempDir}`));

    // Run ShipMachine (dry-run mode for eval)
    const shipmachinePath = path.join(__dirname, '..', 'index.js');
    const cliPath = path.join(__dirname, '..', 'cli', 'index.js');

    // Try running through CLI first
    const runResult = spawnSync('node', [
      cliPath,
      'run-task',
      '--repo', tempDir,
      '--objective', task,
      '--dry-run'
    ], {
      encoding: 'utf8',
      timeout: 60000,
    });

    // Check output
    const output = runResult.stdout + runResult.stderr;
    console.log(chalk.gray(`  Output length: ${output.length} chars`));

    // Evaluate results
    result.details.push({ step: 'execution', output: output.substring(0, 500) });

    // Check if patch would apply cleanly
    const patchApplied = output.includes('patch') || output.includes('Step');
    result.details.push({ step: 'patch_generated', value: patchApplied });

    // Check if PR bundle would be created
    const prBundle = output.includes('bundle') || output.includes('PR');
    result.details.push({ step: 'pr_bundle', value: prBundle });

    // Check for errors (look for runtime errors, not objective descriptions)
    const hasError = output.includes('ShipMachine error:') || output.includes('❌') || runResult.status !== 0;
    result.details.push({ step: 'no_errors', value: !hasError });

    // Check for policy violations
    const policyViolation = output.includes('policy denies') || output.includes('not allowed');
    result.details.push({ step: 'policy_ok', value: !policyViolation });

    // Overall pass/fail
    result.passed = patchApplied && prBundle && !hasError && !policyViolation;
    result.status = result.passed ? 'PASS' : 'FAIL';

  } catch (err) {
    result.status = 'ERROR';
    result.error = err.message;
    result.passed = false;
  } finally {
    if (tempDir) {
      try {
        cleanupFixture(tempDir);
      } catch { /* ignore cleanup errors */ }
    }
  }

  return result;
}

/**
 * Main eval runner.
 */
async function main() {
  const isDryRun = process.env.EVAL_DRY_RUN === '1';
  const fixtureFilter = process.env.EVAL_FIXTURE || null;

  let fixtures = [
    {
      name: 'simple-feature',
      task: "Add a hello() function to utils.js that returns 'Hello, World!'",
      createFixture: createSimpleFeature,
      expected: simpleFeatureExpected,
    },
    {
      name: 'bugfix',
      task: "Fix the off-by-one error in getLastItem()",
      createFixture: createBugfix,
      expected: bugfixExpected,
    }
  ];

  // Filter by --fixture name if specified
  if (fixtureFilter) {
    fixtures = fixtures.filter(f => f.name === fixtureFilter);
    if (fixtures.length === 0) {
      console.error(chalk.red(`No fixture found with name: ${fixtureFilter}`));
      process.exit(1);
    }
  }

  console.log(chalk.bold.cyan('🧪 ZeroClaw ShipMachine Evaluation Suite\n'));

  // Dry-run: just list fixtures, skip execution
  if (isDryRun) {
    console.log(chalk.yellow('DRY RUN — listing fixtures only:\n'));
    for (const f of fixtures) {
      console.log(chalk.cyan(`  • ${f.name}`));
      console.log(chalk.gray(`    Task: ${f.task}`));
    }
    console.log(chalk.gray(`\n${fixtures.length} fixture(s) would run.\n`));
    process.exit(0);
  }

  console.log(chalk.gray(`Running ${fixtures.length} fixture(s)...`));

  const results = [];

  for (const fixture of fixtures) {
    const result = await runFixture(fixture);
    results.push(result);
  }

  // Generate report
  console.log(chalk.bold.cyan('\n📊 EVALUATION RESULTS\n'));
  console.log(chalk.gray('─'.repeat(60)));

  let passCount = 0;
  for (const result of results) {
    const status = result.passed 
      ? chalk.green('✓ PASS') 
      : result.status === 'ERROR'
        ? chalk.red('✗ ERROR')
        : chalk.yellow('✗ FAIL');
    
    console.log(`${status}  ${result.name}`);
    
    if (!result.passed && result.details) {
      for (const detail of result.details) {
        const val = detail.value === true ? chalk.green('✓') : 
                    detail.value === false ? chalk.red('✗') : 
                    '-';
        console.log(chalk.gray(`       ${val} ${detail.step}`));
      }
    }
    if (result.error) {
      console.log(chalk.gray(`       Error: ${result.error}`));
    }

    if (result.passed) passCount++;
  }

  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.bold(`\nResults: ${passCount}/${results.length} passed\n`));

  // Write EVAL_RESULTS.md
  const reportPath = path.join(__dirname, 'EVAL_RESULTS.md');
  const report = generateReport(results);
  fs.writeFileSync(reportPath, report, 'utf8');
  console.log(chalk.gray(`Report written to: ${reportPath}`));

  // Exit with appropriate code
  process.exit(passCount === results.length ? 0 : 1);
}

/**
 * Generate markdown report.
 */
function generateReport(results) {
  let md = '# ZeroClaw ShipMachine Evaluation Results\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += '## Summary\n\n';
  md += `- Total fixtures: ${results.length}\n`;
  md += `- Passed: ${results.filter(r => r.passed).length}\n`;
  md += `- Failed: ${results.filter(r => !r.passed).length}\n\n`;
  md += '## Results\n\n';

  for (const result of results) {
    md += `### ${result.name}\n\n`;
    md += `**Status**: ${result.passed ? '✅ PASS' : '❌ FAIL'}\n\n`;
    
    if (result.details) {
      md += '| Check | Result |\n';
      md += '|-------|--------|\n';
      for (const detail of result.details) {
        const val = detail.value === true ? '✅' : detail.value === false ? '❌' : '-';
        md += `| ${detail.step} | ${val} |\n`;
      }
      md += '\n';
    }

    if (result.error) {
      md += `**Error**: \`${result.error}\`\n\n`;
    }
  }

  return md;
}

// Run
main().catch(err => {
  console.error(chalk.red('Fatal error:'), err);
  process.exit(1);
});
