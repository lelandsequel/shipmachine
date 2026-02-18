#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { runTask } from './run-task.js';
import { Analytics } from '../promptos-bridge/analytics.js';
import { PromptOSBridge } from '../promptos-bridge/index.js';
import { PRTool } from '../tools/pr.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const program = new Command();

program
  .name('zeroclaw')
  .description('ZeroClaw ShipMachine — engineering shipping agent')
  .version('0.1.0');

// ---- run-task command ----
program
  .command('run-task')
  .description('Run an engineering task through ShipMachine')
  .requiredOption('--repo <path>', 'Repository path')
  .requiredOption('--objective <text>', 'Engineering objective to accomplish')
  .option('--role <role>', 'Agent role (engineer, reviewer, readonly)', 'engineer')
  .option('--dry-run', 'Plan without executing changes', false)
  .option('--config <path>', 'Path to custom config.yaml')
  .action(runTask);

// ---- status command ----
program
  .command('status')
  .description('Show status of last task (if any)')
  .action(() => {
    const analyticsDir = path.join(__dirname, '..', 'analytics');
    const analytics = new Analytics(analyticsDir);
    const events = analytics.loadHistory(1);

    if (events.length === 0) {
      console.log(chalk.gray('No recent tasks found.'));
      return;
    }

    const last = events[events.length - 1];
    console.log(chalk.bold.cyan('\n📊 Last Task'));
    console.log(chalk.gray(`  Prompt: ${last.promptId}`));
    console.log(chalk.gray(`  Role: ${last.role}`));
    console.log(chalk.gray(`  Time: ${last.ts}`));
    console.log(chalk.gray(`  Success: ${last.success ? 'Yes' : 'No'}`));
    console.log(chalk.gray(`  Tokens: ${last.tokensUsed}`));
    console.log(chalk.gray(`  Duration: ${last.durationMs}ms`));
  });

// ---- analytics command ----
program
  .command('analytics')
  .description('Show analytics summary')
  .option('--limit <number>', 'Number of recent events to show', '100')
  .action((options) => {
    const analyticsDir = path.join(__dirname, '..', 'analytics');
    const analytics = new Analytics(analyticsDir);
    const stats = analytics.getStats();

    console.log(chalk.bold.cyan('\n📈 Analytics Summary'));
    console.log(chalk.gray(`  Total Calls: ${stats.totalCalls}`));
    console.log(chalk.gray(`  Total Tokens: ${stats.totalTokens.toLocaleString()}`));
    console.log(chalk.gray(`  Avg Duration: ${stats.avgDuration}ms`));

    if (Object.keys(stats.promptBreakdown).length > 0) {
      console.log(chalk.bold.cyan('\n📋 Prompt Breakdown'));
      for (const [promptId, data] of Object.entries(stats.promptBreakdown)) {
        console.log(chalk.gray(`  ${promptId}:`));
        console.log(chalk.gray(`    Calls: ${data.calls}, Tokens: ${data.tokens}, Success: ${data.success}, Failed: ${data.failed}`));
      }
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
  });

packCmd
  .command('load <pack-name>')
  .description('Load a prompt pack into the registry')
  .action((packName) => {
    console.log(chalk.yellow(`Loading pack: ${packName} (not implemented — packs are auto-loaded)`));
  });

// Parse and execute
program.parse(process.argv);

// Show help if no command
if (process.argv.length === 2) {
  program.help();
}
