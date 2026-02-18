#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { runTask } from './run-task.js';
import { Analytics } from '../promptos-bridge/analytics.js';
import { PromptOSBridge } from '../promptos-bridge/index.js';
import { PRTool } from '../tools/pr.js';
import { AnalyticsDashboard } from '../analytics/dashboard.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const program = new Command();

program
  .name('shipmachine')
  .description('ShipMachine ShipMachine — engineering shipping agent')
  .version('0.1.0');

// ---- run-task command ----
program
  .command('run-task')
  .description('Run an engineering task through ShipMachine')
  .requiredOption('--repo <path>', 'Repository path')
  .requiredOption('--objective <text>', 'Engineering objective to accomplish')
  .option('--role <role>', 'Agent role (engineer, reviewer, readonly)', 'engineer')
  .option('--user <name>', 'User name for analytics', 'anonymous')
  .option('--dry-run', 'Plan without executing changes', false)
  .option('--config <path>', 'Path to custom config.yaml')
  .action(runTask);

// ---- doctor command ----
program
  .command('doctor')
  .description('Check system requirements and configuration')
  .action(() => {
    console.log(chalk.bold.cyan('\n🏥 ShipMachine Doctor\n'));

    let issues = 0;
    let warnings = 0;

    // Check Node version
    console.log(chalk.gray('Checking Node.js version...'));
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (majorVersion >= 18) {
      console.log(chalk.green(`  ✓ Node.js ${nodeVersion}`));
    } else {
      console.log(chalk.red(`  ✗ Node.js ${nodeVersion} (need 18+)`));
      issues++;
    }

    // Check Git
    console.log(chalk.gray('Checking Git...'));
    try {
      const gitVersion = execSync('git --version', { encoding: 'utf8' }).trim();
      console.log(chalk.green(`  ✓ ${gitVersion}`));
    } catch {
      console.log(chalk.red('  ✗ Git not found'));
      issues++;
    }

    // Check test runners
    console.log(chalk.gray('Checking test runners...'));
    const testRunners = ['npm', 'pytest', 'cargo', 'go'];
    for (const runner of testRunners) {
      try {
        execSync(`${runner} --version`, { encoding: 'utf8', stdio: 'pipe' });
        console.log(chalk.green(`  ✓ ${runner} available`));
      } catch {
        console.log(chalk.yellow(`  ⚠ ${runner} not found`));
        warnings++;
      }
    }

    // Check PromptOS pack
    console.log(chalk.gray('Checking PromptOS packs...'));
    try {
      const promptosPath = path.join(__dirname, '..', 'promptos', 'packs');
      const bridge = new PromptOSBridge(promptosPath);
      const prompts = bridge.listPrompts();
      if (prompts.length > 0) {
        console.log(chalk.green(`  ✓ ${prompts.length} prompts loaded`));
      } else {
        console.log(chalk.red('  ✗ No prompts found'));
        issues++;
      }
    } catch (err) {
      console.log(chalk.red(`  ✗ Failed to load prompts: ${err.message}`));
      issues++;
    }

    // Check API key
    console.log(chalk.gray('Checking API key...'));
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      console.log(chalk.green('  ✓ ANTHROPIC_API_KEY set'));
    } else {
      console.log(chalk.yellow('  ⚠ ANTHROPIC_API_KEY not set (will use mock)'));
      warnings++;
    }

    // Check config file
    console.log(chalk.gray('Checking config...'));
    const configPath = path.join(__dirname, '..', 'control-plane', 'config.yaml');
    if (fs.existsSync(configPath)) {
      console.log(chalk.green('  ✓ config.yaml exists'));
    } else {
      console.log(chalk.red('  ✗ config.yaml not found'));
      issues++;
    }

    // Summary
    console.log(chalk.bold('\n📋 Summary'));
    if (issues === 0 && warnings === 0) {
      console.log(chalk.green('  ✓ All checks passed!'));
    } else if (issues === 0) {
      console.log(chalk.yellow(`  ⚠ ${warnings} warning(s), ${issues} issue(s)`));
    } else {
      console.log(chalk.red(`  ✗ ${issues} issue(s), ${warnings} warning(s)`));
    }

    console.log('');
    process.exit(issues > 0 ? 1 : 0);
  });

// ---- report command ----
program
  .command('report')
  .description('Show last PR bundle summary')
  .action(() => {
    const baseDir = path.join(__dirname, '..');
    const prTool = new PRTool(null, path.join(baseDir, 'pr-bundles'));
    const bundles = prTool.list_bundles();

    if (bundles.length === 0) {
      console.log(chalk.yellow('\nNo PR bundles found.\n'));
      return;
    }

    const last = bundles[0];
    console.log(chalk.bold.cyan('\n📦 Last PR Bundle\n'));
    console.log(chalk.gray(`  Timestamp: ${last.timestamp}`));
    console.log(chalk.gray(`  Objective: ${last.manifest.objective || 'Unknown'}`));
    console.log(chalk.gray(`  Risk Level: ${last.manifest.riskLevel || 'unknown'}`));
    console.log(chalk.gray(`  Go/No-Go: ${last.manifest.goNoGo || 'unknown'}`));
    console.log(chalk.gray(`  Files: ${last.manifest.files?.join(', ') || 'none'}`));
    console.log(chalk.gray(`\n  Path: ${last.bundlePath}`));
    console.log('');
  });

// ---- analytics command ----
program
  .command('analytics')
  .description('Show analytics dashboard')
  .option('--prompt <id>', 'Show metrics for a specific prompt')
  .option('--runs', 'Show recent runs')
  .action((options) => {
    const analyticsDir = path.join(__dirname, '..', 'analytics');
    const dashboard = new AnalyticsDashboard(analyticsDir);

    if (options.prompt) {
      dashboard.showPrompt(options.prompt);
    } else if (options.runs) {
      dashboard.showRuns();
    } else {
      dashboard.show();
    }
  });

// ---- pack command ----
const packCmd = program
  .command('pack')
  .description('Manage prompt packs');

packCmd
  .command('list')
  .description('List available prompt packs')
  .action(() => {
    const promptosPath = path.join(__dirname, '..', 'promptos', 'packs');
    const bridge = new PromptOSBridge(promptosPath);

    const prompts = bridge.listPrompts();
    console.log(chalk.bold.cyan('\n📦 Available Prompts'));
    prompts.forEach(id => {
      console.log(chalk.gray(`  ${id}`));
    });
    console.log('');
  });

packCmd
  .command('load <pack-name>')
  .description('Load a prompt pack into the registry')
  .action((packName) => {
    console.log(chalk.yellow(`Loading pack: ${packName} (not implemented — packs are auto-loaded)`));
  });

// ---- eval command ----
program
  .command('eval')
  .description('Run evaluation suite')
  .option('--dry-run', 'Show what would be evaluated without running LLM calls', false)
  .option('--fixture <name>', 'Run a specific eval fixture by name')
  .option('--verbose', 'Show detailed output for each fixture', false)
  .action((options) => {
    console.log(chalk.bold.cyan('\n🧪 Running Evaluation Suite...\n'));

    const runnerPath = path.join(__dirname, '..', 'eval', 'runner.js');
    const env = { ...process.env };

    if (options.dryRun) {
      console.log(chalk.yellow('  --dry-run: listing fixtures only (no LLM calls)\n'));
      env.EVAL_DRY_RUN = '1';
    }
    if (options.fixture) {
      env.EVAL_FIXTURE = options.fixture;
    }
    if (options.verbose) {
      env.EVAL_VERBOSE = '1';
    }

    try {
      execSync(`node ${runnerPath}`, { stdio: 'inherit', cwd: path.join(__dirname, '..'), env });
    } catch (err) {
      console.error(chalk.red('Eval failed:', err.message));
      process.exit(1);
    }
  });

// Parse and execute
program.parse(process.argv);

// Show help if no command
if (process.argv.length === 2) {
  program.help();
}
