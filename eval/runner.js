#!/usr/bin/env node
/**
 * ZeroClaw ShipMachine — Agent Eval Runner
 * Runs synthetic task fixtures to validate agent behavior.
 * 
 * Usage: node eval/runner.js [--fixture simple-feature] [--output EVAL_RESULTS.md]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import fixtures
const FIXTURES = [];
try {
  const { setup: s1, verify: v1, cleanup: c1, TASK: t1, FIXTURE_ID: id1, DESCRIPTION: d1 } =
    await import('./fixtures/simple-feature.js');
  FIXTURES.push({ id: id1, description: d1, setup: s1, verify: v1, cleanup: c1, task: t1 });
} catch (e) { console.warn('Could not load simple-feature fixture:', e.message); }

try {
  const { setup: s2, verify: v2, cleanup: c2, TASK: t2, FIXTURE_ID: id2, DESCRIPTION: d2 } =
    await import('./fixtures/bugfix.js');
  FIXTURES.push({ id: id2, description: d2, setup: s2, verify: v2, cleanup: c2, task: t2 });
} catch (e) { console.warn('Could not load bugfix fixture:', e.message); }

const args = process.argv.slice(2);
const fixtureFilter = args[args.indexOf('--fixture') + 1] || null;
const outputPath = args[args.indexOf('--output') + 1] || 'EVAL_RESULTS.md';
const dryRun = args.includes('--dry-run');

const results = [];
let totalPassed = 0;
let totalFailed = 0;
const startTime = Date.now();

// Try to import ShipMachine (may not be built yet)
let ShipMachine = null;
try {
  const mod = await import('../orchestrator/index.js');
  ShipMachine = mod.ShipMachine || mod.default;
} catch (e) {
  console.warn('⚠️  ShipMachine not available yet — running in STUB mode');
  console.warn('   (orchestrator/index.js not found or has errors)');
}

const fixturesToRun = fixtureFilter
  ? FIXTURES.filter(f => f.id === fixtureFilter)
  : FIXTURES;

if (fixturesToRun.length === 0) {
  console.error(`No fixtures found${fixtureFilter ? ` matching "${fixtureFilter}"` : ''}`);
  process.exit(1);
}

console.log(`\n🧪 ZeroClaw Agent Eval Suite`);
console.log(`   Fixtures: ${fixturesToRun.length}`);
console.log(`   Mode: ${dryRun ? 'DRY RUN' : ShipMachine ? 'LIVE' : 'STUB'}\n`);

for (const fixture of fixturesToRun) {
  console.log(`━━━ ${fixture.id}: ${fixture.description}`);
  const fixtureStart = Date.now();
  let repoPath = null;

  try {
    // Setup temp repo
    console.log('  📁 Setting up fixture repo...');
    repoPath = fixture.setup();
    console.log(`  → Created at ${repoPath}`);

    let runResult = null;

    if (dryRun || !ShipMachine) {
      // Stub run — simulate success for CI structural testing
      console.log('  🔍 Dry run — simulating agent output...');
      runResult = {
        dryRun: true,
        prBundle: { PR_DESCRIPTION: '# Stub PR\nDry run result' },
        policyViolations: [],
        stepsCompleted: 0,
        stubMode: !ShipMachine,
      };
    } else {
      // Real run
      console.log('  🤖 Running ShipMachine...');
      const sm = new ShipMachine({
        repoPath,
        objective: fixture.task.objective,
        agentRole: 'engineer',
      });
      runResult = await sm.run();
    }

    // Verify
    console.log('  ✅ Verifying results...');
    const verification = fixture.verify(repoPath, runResult);

    const fixtureResult = {
      id: fixture.id,
      description: fixture.description,
      passed: verification.passed,
      durationMs: Date.now() - fixtureStart,
      checks: verification.checks,
      stubMode: runResult?.stubMode || false,
      dryRun: runResult?.dryRun || false,
    };

    results.push(fixtureResult);

    if (verification.passed) {
      totalPassed++;
      console.log(`  ✓ PASSED (${fixtureResult.durationMs}ms)\n`);
    } else {
      totalFailed++;
      const failedChecks = verification.checks.filter(c => !c.passed);
      console.log(`  ✗ FAILED — ${failedChecks.map(c => c.name).join(', ')}\n`);
    }

  } catch (err) {
    console.error(`  ✗ ERROR: ${err.message}\n`);
    results.push({
      id: fixture.id,
      description: fixture.description,
      passed: false,
      durationMs: Date.now() - fixtureStart,
      error: err.message,
      checks: [],
    });
    totalFailed++;
  } finally {
    if (repoPath) {
      try { fixture.cleanup(repoPath); } catch { /* ignore */ }
    }
  }
}

const totalDuration = Date.now() - startTime;
const successRate = Math.round((totalPassed / fixturesToRun.length) * 100);

// Generate EVAL_RESULTS.md
const md = `# ZeroClaw Agent Eval Results

**Date:** ${new Date().toISOString()}
**Mode:** ${dryRun ? 'Dry Run' : ShipMachine ? 'Live' : 'Stub (orchestrator not built yet)'}
**Duration:** ${(totalDuration / 1000).toFixed(1)}s

## Summary

| Metric | Value |
|--------|-------|
| Total Fixtures | ${fixturesToRun.length} |
| Passed | ${totalPassed} |
| Failed | ${totalFailed} |
| Success Rate | ${successRate}% |

## Results by Fixture

${results.map(r => `### ${r.passed ? '✅' : '❌'} ${r.id}
**${r.description}**
- Duration: ${r.durationMs}ms
${r.error ? `- Error: ${r.error}` : ''}
${r.stubMode ? '- ⚠️  Stub mode (orchestrator not loaded)' : ''}

| Check | Result |
|-------|--------|
${r.checks.map(c => `| ${c.name} | ${c.passed ? '✅ Pass' : '❌ Fail'} — ${c.detail} |`).join('\n')}
`).join('\n')}

## Known Limitations (Stub Mode)

When ShipMachine's orchestrator is not yet built, eval runs in stub mode:
- Fixture setup and verify logic still runs
- Agent execution is simulated (dry-run result)
- Tests marked as structural pass (infra working, agent logic pending)
- Real eval requires: orchestrator/index.js, promptos-bridge/index.js, ANTHROPIC_API_KEY

## Next Eval Targets

- [ ] Refactor fixture (rename variable, update all references)
- [ ] Migration fixture (SQL schema migration)
- [ ] Multi-file feature (add module + update imports)
- [ ] Policy violation fixture (verify agent blocks prohibited actions)
`;

fs.writeFileSync(outputPath, md, 'utf8');

console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Results: ${totalPassed}/${fixturesToRun.length} passed (${successRate}%)`);
console.log(`Output: ${outputPath}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

// Exit code: 0 if all passed, 1 if any failed
process.exit(totalFailed > 0 ? 1 : 0);
