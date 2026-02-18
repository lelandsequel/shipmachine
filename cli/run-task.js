import chalk from 'chalk';
import { ShipMachine } from '../orchestrator/index.js';

/**
 * Handle the run-task command.
 * @param {Object} options - parsed command options
 */
export async function runTask(options) {
  const { repo, objective, role, dryRun, config: configPath } = options;

  if (!repo) {
    console.error(chalk.red('Error: --repo is required'));
    process.exit(1);
  }

  if (!objective) {
    console.error(chalk.red('Error: --objective is required'));
    process.exit(1);
  }

  console.log(chalk.bold.cyan('\n🛠️  ZeroClaw ShipMachine\n'));

  const shipmachine = new ShipMachine({
    repoPath: repo,
    objective,
    agentRole: role || 'engineer',
    config: configPath ? { configPath: configPath } : {},
    dryRun: dryRun || false,
  });

  const result = await shipmachine.run();

  console.log(chalk.bold.cyan('\n📊 Run Summary'));
  console.log(chalk.gray(`  Status: ${result.status}`));
  if (result.bundlePath) {
    console.log(chalk.gray(`  Bundle: ${result.bundlePath}`));
  }
  if (result.reason) {
    console.log(chalk.gray(`  Reason: ${result.reason}`));
  }

  if (result.status === 'success') {
    process.exit(0);
  } else if (result.status === 'aborted' || result.status === 'error') {
    process.exit(1);
  }
}

export default runTask;
