import chalk from 'chalk';
import { Analytics } from '../promptos-bridge/analytics.js';
import { LearningLoopAnalyzer } from '../promptos/learn/analyzer.js';

/**
 * AnalyticsDashboard — CLI dashboard for viewing analytics and learning insights.
 */
export class AnalyticsDashboard {
  constructor(analyticsDir = null) {
    this.analytics = new Analytics(analyticsDir);
    this.analyzer = new LearningLoopAnalyzer(analyticsDir);
  }

  /**
   * Display the main dashboard.
   */
  show() {
    const stats = this.analytics.getStats();
    const failing = this.analyzer.analyzeRuns(3);
    const proposals = this.analyzer.generateProposals();
    const patterns = this.analyzer.findPatterns();

    console.log(chalk.bold.cyan('\n📊 ShipMachine Analytics Dashboard\n'));

    // Overview
    console.log(chalk.bold('📈 Overview'));
    console.log(chalk.gray(`  Total runs: ${stats.totalRuns || 1}`));
    console.log(chalk.gray(`  Total calls: ${stats.totalCalls}`));
    console.log(chalk.gray(`  Success rate: ${stats.successRate}%`));
    console.log(chalk.gray(`  Avg time per call: ${stats.avgDuration}ms`));
    console.log(chalk.gray(`  Total tokens: ${stats.totalTokens.toLocaleString()}`));

    // Most invoked prompts
    console.log(chalk.bold('\n🔔 Most Invoked Prompts'));
    const sortedPrompts = Object.entries(stats.promptBreakdown)
      .sort((a, b) => b[1].calls - a[1].calls)
      .slice(0, 5);

    for (const [promptId, data] of sortedPrompts) {
      const successRate = data.calls > 0 
        ? Math.round((data.success / data.calls) * 100) 
        : 0;
      const status = successRate >= 80 ? chalk.green('✓') : 
                     successRate >= 50 ? chalk.yellow('⚠') : 
                     chalk.red('✗');
      console.log(chalk.gray(`  ${status} ${promptId}: ${data.calls}x (${successRate}% success)`));
    }

    // Failing prompts
    if (failing.length > 0) {
      console.log(chalk.bold('\n❌ Prompts Needing Attention'));
      for (const f of failing.slice(0, 3)) {
        console.log(chalk.gray(`  ${f.prompt_id}: ${f.failure_rate}% failure (${f.failed}/${f.calls})`));
      }
    }

    // Learning proposals
    if (proposals.length > 0) {
      console.log(chalk.bold('\n💡 Learning Proposals'));
      for (const p of proposals.slice(0, 3)) {
        console.log(chalk.gray(`  [${p.priority.toUpperCase()}] ${p.prompt_id}`));
        console.log(chalk.gray(`    ${p.proposal.slice(0, 80)}...`));
      }
    }

    // Pattern suggestions
    if (patterns.length > 0) {
      console.log(chalk.bold('\n🔄 Pattern Suggestions'));
      for (const pat of patterns.slice(0, 2)) {
        console.log(chalk.gray(`  ${pat.pattern} → ${pat.occurrences}x`));
      }
    }

    // Objective types
    if (Object.keys(stats.objectiveTypes).length > 0) {
      console.log(chalk.bold('\n🎯 Objective Types'));
      for (const [type, count] of Object.entries(stats.objectiveTypes)) {
        console.log(chalk.gray(`  ${type}: ${count}`));
      }
    }

    // Model usage
    if (Object.keys(stats.modelUsage).length > 0) {
      console.log(chalk.bold('\n🤖 Model Usage'));
      for (const [model, count] of Object.entries(stats.modelUsage)) {
        console.log(chalk.gray(`  ${model}: ${count}`));
      }
    }

    console.log('');
  }

  /**
   * Show detailed stats for a specific prompt.
   */
  showPrompt(promptId) {
    const metrics = this.analyzer.getPromptMetrics(promptId);

    if (metrics.not_found) {
      console.log(chalk.yellow(`No data found for prompt: ${promptId}`));
      return;
    }

    console.log(chalk.bold.cyan(`\n📋 ${promptId} Metrics\n`));
    console.log(chalk.gray(`  Calls: ${metrics.total_calls}`));
    console.log(chalk.gray(`  Success: ${metrics.success} (${metrics.success_rate}%)`));
    console.log(chalk.gray(`  Failed: ${metrics.failed}`));
    console.log(chalk.gray(`  Avg duration: ${metrics.avg_duration_ms}ms`));
    console.log(chalk.gray(`  Avg tokens: ${metrics.avg_tokens}`));

    if (Object.keys(metrics.models_used).length > 0) {
      console.log(chalk.gray('\n  Models:'));
      for (const [model, count] of Object.entries(metrics.models_used)) {
        console.log(chalk.gray(`    ${model}: ${count}`));
      }
    }

    if (Object.keys(metrics.roles_used).length > 0) {
      console.log(chalk.gray('\n  Roles:'));
      for (const [role, count] of Object.entries(metrics.roles_used)) {
        console.log(chalk.gray(`    ${role}: ${count}`));
      }
    }

    console.log('');
  }

  /**
   * Show recent runs.
   */
  showRuns(limit = 10) {
    const runs = this.analyzer.getRunSummaries().slice(0, limit);

    console.log(chalk.bold.cyan('\n📜 Recent Runs\n'));
    console.log(chalk.gray('Run ID'.padEnd(38)), 'Steps', 'Status', 'Tokens', 'Duration');
    console.log(chalk.gray('─'.repeat(80)));

    for (const run of runs) {
      const status = run.passed ? chalk.green('✓') : chalk.red('✗');
      const duration = run.total_duration_ms > 60000 
        ? `${Math.round(run.total_duration_ms / 60000)}m`
        : `${Math.round(run.total_duration_ms / 1000)}s`;
      console.log(
        run.run_id?.slice(0, 36).padEnd(38),
        String(run.total_steps).padEnd(6),
        status,
        String(run.total_tokens).padEnd(7),
        duration
      );
    }

    console.log('');
  }
}

export default AnalyticsDashboard;
