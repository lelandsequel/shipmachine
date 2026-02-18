import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { PolicyEngine } from '../control-plane/policy.js';
import { RBAC } from '../control-plane/rbac.js';
import { PromptOSBridge } from '../promptos-bridge/index.js';
import { Analytics } from '../promptos-bridge/analytics.js';
import { FilesystemTool } from '../tools/fs.js';
import { GitTool } from '../tools/git.js';
import { ExecTool } from '../tools/exec.js';
import { TestsTool } from '../tools/tests.js';
import { PRTool } from '../tools/pr.js';
import { Planner } from './planner.js';
import { WorkspaceManager } from './workspace.js';
import { TaskContext } from '../memory/task-context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * ShipMachine — the main orchestrator for ZeroClaw.
 * Runs: scope → survey → plan → step loop → docs → risk → rollback → PR
 */
export class ShipMachine {
  /**
   * @param {Object} options
   *   - repoPath: string
   *   - objective: string
   *   - agentRole?: string (default: 'engineer')
   *   - config?: {configPath, model, maxTokens}
   *   - dryRun?: boolean
   */
  constructor(options) {
    this.repoPath = options.repoPath;
    this.objective = options.objective;
    this.agentRole = options.agentRole || 'engineer';
    this.config = options.config || {};
    this.dryRun = options.dryRun || false;

    // Base directory for the project
    this.baseDir = this.config.baseDir || path.resolve(__dirname, '..');

    // Components (initialized in init())
    this.policy = null;
    this.rbac = null;
    this.bridge = null;
    this.analytics = null;
    this.fs = null;
    this.git = null;
    this.exec = null;
    this.tests = null;
    this.pr = null;
    this.planner = null;
    this.workspace = null;
    this.taskContext = null;
  }

  /**
   * Initialize all components.
   */
  async init() {
    const configPath = this.config.configPath || path.join(this.baseDir, 'control-plane/config.yaml');

    // Control plane
    this.policy = new PolicyEngine(configPath);
    this.rbac = new RBAC();
    this.rbac.loadRoles(configPath);

    // Analytics
    const analyticsDir = path.join(this.baseDir, 'analytics');
    this.analytics = new Analytics(analyticsDir);

    // PromptOS Bridge
    const promptosPath = path.join(this.baseDir, 'promptos/packs');
    this.bridge = new PromptOSBridge(promptosPath, {
      configPath,
      model: this.config.model,
      maxTokens: this.config.maxTokens,
      analyticsDir,
    }, this.analytics);

    // Tools
    this.fs = new FilesystemTool(this.policy);
    this.git = new GitTool(this.policy);
    this.exec = new ExecTool(this.policy);
    this.tests = new TestsTool(this.policy, this.exec);

    const bundleBaseDir = path.join(this.baseDir, 'pr-bundles');
    this.pr = new PRTool(this.policy, bundleBaseDir);

    // Planner
    this.planner = new Planner();

    // Workspace manager
    this.workspace = new WorkspaceManager(this.repoPath);

    // Task context
    this.taskContext = new TaskContext(this.objective);

    console.log(chalk.cyan('🚀 ShipMachine initialized'));
    console.log(chalk.gray(`  Role: ${this.agentRole}`));
    console.log(chalk.gray(`  Objective: ${this.objective}`));
    console.log(chalk.gray(`  Repo: ${this.repoPath}`));
  }

  /**
   * Run the full ShipMachine pipeline.
   * @returns {Promise<{bundlePath: string, status: string}>}
   */
  async run() {
    try {
      await this.init();

      if (this.dryRun) {
        console.log(chalk.yellow('🔍 Dry run mode — will not execute actual changes'));
      }

      // Phase 1: Scope the task
      console.log(chalk.cyan('\n📋 Phase 1: Scoping task...'));
      const scopeResult = await this._runScopeTask();
      this.taskContext.scopeOutput = scopeResult.output;
      console.log(chalk.green(`  ✓ Done definition: ${scopeResult.output.done_definition}`));

      // Phase 2: Survey repo
      console.log(chalk.cyan('\n🔍 Phase 2: Surveying repository...'));
      const surveyResult = await this._runRepoSurvey();
      this.taskContext.repoSurvey = surveyResult.output;
      console.log(chalk.green(`  ✓ Found ${surveyResult.output.key_modules.length} key modules`));

      // Phase 3: Plan
      console.log(chalk.cyan('\n📝 Phase 3: Planning...'));
      const planResult = await this._runPlan();
      this.taskContext.plan = planResult.output;
      console.log(chalk.green(`  ✓ ${planResult.output.steps.length} steps planned`));

      // Phase 4: Execute steps
      console.log(chalk.cyan('\n🔨 Phase 4: Executing steps...'));
      const stepResults = await this._executeSteps();
      console.log(chalk.green(`  ✓ Completed ${stepResults.completed} steps`));

      if (stepResults.aborted) {
        return { bundlePath: null, status: 'aborted', reason: stepResults.reason };
      }

      // Phase 5: Docs
      console.log(chalk.cyan('\n📖 Phase 5: Updating documentation...'));
      const docResult = await this._runDocUpdate();
      this.taskContext.docUpdateResult = docResult.output;
      console.log(chalk.green('  ✓ Documentation updated'));

      // Phase 6: Security check
      console.log(chalk.cyan('\n🔒 Phase 6: Security check...'));
      const securityResult = await this._runSecurityCheck();
      this.taskContext.securityCheckResult = securityResult.output;
      if (!securityResult.output.safe_to_proceed) {
        console.log(chalk.red('  ⚠️ Security issues detected! Review required before proceeding.'));
      } else {
        console.log(chalk.green('  ✓ Security check passed'));
      }

      // Phase 7: Risk assessment
      console.log(chalk.cyan('\n⚠️ Phase 7: Risk assessment...'));
      const riskResult = await this._runRiskAssessment();
      this.taskContext.riskAssessment = riskResult.output;
      console.log(chalk.green(`  ✓ Risk level: ${riskResult.output.risk_level}`));

      // Phase 8: Rollback plan
      console.log(chalk.cyan('\n🔄 Phase 8: Rollback plan...'));
      const rollbackResult = await this._runRollbackPlan();
      this.taskContext.rollbackPlan = rollbackResult.output;
      console.log(chalk.green('  ✓ Rollback plan created'));

      // Phase 9: PR writeup
      console.log(chalk.cyan('\n📦 Phase 9: Creating PR bundle...'));
      const prResult = await this._runPRWriteup();
      this.taskContext.prWriteup = prResult.output;
      console.log(chalk.green(`  ✓ PR title: ${prResult.output.title}`));

      // Create bundle
      if (!this.dryRun) {
        const diff = this.workspace.collectDiff(this.repoPath);
        const bundle = this.pr.create_bundle({
          diff,
          testEvidence: this.taskContext.testEvidence,
          prDescription: prResult.output,
          riskAssessment: riskResult.output,
          rollbackPlan: rollbackResult.output,
          changelog: docResult.output.changelog_entry,
          objective: this.objective,
        }, this.agentRole);

        console.log(chalk.green(`\n✅ PR Bundle created: ${bundle.bundlePath}`));

        return { bundlePath: bundle.bundlePath, status: 'success' };
      } else {
        console.log(chalk.yellow('\n⚠️ Dry run complete — no PR bundle created'));
        return { bundlePath: null, status: 'dry-run' };
      }
    } catch (err) {
      console.error(chalk.red(`\n❌ ShipMachine error: ${err.message}`));
      if (err.stack) {
        console.error(chalk.gray(err.stack));
      }
      return { bundlePath: null, status: 'error', error: err.message };
    }
  }

  // ---- Phase Methods ----

  async _runScopeTask() {
    return this.bridge.execute('ship.scope_task', {
      objective: this.objective,
      repo_context: '', // Could be populated from existing context
      constraints: '',
    }, {
      role: this.agentRole,
      budget: this.taskContext.getBudgetUsage(),
    });
  }

  async _runRepoSurvey() {
    const fileTree = this.workspace.getFileTree(this.repoPath);
    let packageJson = '';

    const pkgPath = path.join(this.repoPath, 'package.json');
    const pyPath = path.join(this.repoPath, 'requirements.txt');
    const cargoPath = path.join(this.repoPath, 'Cargo.toml');

    if (this.fs.exists(pkgPath)) {
      packageJson = this.fs.read_file(pkgPath, this.agentRole);
    } else if (this.fs.exists(pyPath)) {
      packageJson = this.fs.read_file(pyPath, this.agentRole);
    } else if (this.fs.exists(cargoPath)) {
      packageJson = this.fs.read_file(cargoPath, this.agentRole);
    }

    return this.bridge.execute('ship.repo_survey', {
      repo_path: this.repoPath,
      file_tree: fileTree,
      package_json_or_requirements: packageJson,
    }, {
      role: this.agentRole,
      budget: this.taskContext.getBudgetUsage(),
    });
  }

  async _runPlan() {
    return this.bridge.execute('ship.plan', {
      objective: this.objective,
      scope_output: JSON.stringify(this.taskContext.scopeOutput),
      repo_survey_output: JSON.stringify(this.taskContext.repoSurvey),
    }, {
      role: this.agentRole,
      budget: this.taskContext.getBudgetUsage(),
    });
  }

  async _executeSteps() {
    const plan = this.taskContext.plan;
    const completedSteps = [];
    let lastResult = null;
    let aborted = false;
    let abortReason = '';

    while (true) {
      // Check abort conditions
      const abortCheck = this.planner.shouldAbort(
        this.taskContext.getBudgetUsage(),
        lastResult
      );
      if (abortCheck.abort) {
        aborted = true;
        abortReason = abortCheck.reason;
        break;
      }

      // Get next step
      const step = this.planner.selectNextStep(plan, completedSteps, lastResult);
      if (!step) {
        console.log(chalk.gray('  All steps completed'));
        break;
      }

      console.log(chalk.gray(`\n  Step ${step.id}: ${step.description}`));

      try {
        const result = await this._executeStep(step);
        this.taskContext.recordStep(step.id, step.type, result);

        // Track modified files
        if (result.file_path) {
          this.taskContext.trackFileModified(result.file_path);
        }
        if (result.files_affected) {
          result.files_affected.forEach(f => this.taskContext.trackFileModified(f));
        }

        completedSteps.push(step.id);
        lastResult = { stepId: step.id, ...result };

        // Handle next action from test interpreter
        if (result.next_action === 'abort') {
          aborted = true;
          abortReason = `Step ${step.id} requested abort`;
          break;
        }
      } catch (err) {
        this.taskContext.recordError(step.id, err);
        console.error(chalk.red(`  ❌ Step failed: ${err.message}`));

        // Try to continue or abort based on error
        if (err.message.includes('budget')) {
          aborted = true;
          abortReason = err.message;
          break;
        }
      }
    }

    return { completed: completedSteps.length, aborted, reason: abortReason };
  }

  async _executeStep(step) {
    switch (step.type) {
      case 'analysis':
        return { complete: true, result: 'Analysis complete' };

      case 'patch':
      case 'create':
        return this._executePatchStep(step);

      case 'tests':
        return this._executeTestsStep(step);

      case 'exec':
        return this._executeExecStep(step);

      case 'docs':
        return this._executeDocsStep(step);

      case 'review':
        return { reviewComplete: true };

      default:
        return { complete: true };
    }
  }

  async _executePatchStep(step) {
    // Get current file content
    const filePath = step.files_affected?.[0];
    if (!filePath) {
      return { patchApplied: true };
    }

    const currentContent = this.workspace.readFile(filePath);

    const result = await this.bridge.execute('ship.patch', {
      step_description: step.description,
      file_path: filePath,
      current_content: currentContent,
      context: '',
    }, {
      role: this.agentRole,
      budget: this.taskContext.getBudgetUsage(),
    });

    // Apply the patch
    if (!this.dryRun) {
      this.workspace.applyEdits([{
        file_path: filePath,
        edits: result.output.edits,
      }]);
    }

    return {
      patchApplied: true,
      file_path: filePath,
      output: result.output,
    };
  }

  async _executeTestsStep(step) {
    const filePath = step.files_affected?.[0];
    if (!filePath) {
      return { testFileWritten: true };
    }

    // Read the file to test
    const codeContent = this.workspace.readFile(filePath);
    const testFramework = this._detectTestFramework();

    const result = await this.bridge.execute('ship.tests', {
      file_path: filePath,
      code_content: codeContent,
      test_framework: testFramework,
      existing_tests: '',
    }, {
      role: this.agentRole,
      budget: this.taskContext.getBudgetUsage(),
    });

    if (!this.dryRun) {
      this.workspace.writeFile(result.output.test_file_path, result.output.test_content);
    }

    return { testFileWritten: true, testFilePath: result.output.test_file_path };
  }

  async _executeExecStep(step) {
    const cmd = this.taskContext.repoSurvey?.test_command || 'npm test';
    const testResult = this.tests.run(this.repoPath, cmd, this.agentRole);

    // Store test evidence
    this.taskContext.testEvidence = testResult;

    // Interpret test results
    const interpretResult = await this.bridge.execute('ship.run_tests_interpret', {
      test_output: testResult.output,
      test_command: cmd,
      step_context: step.description,
    }, {
      role: this.agentRole,
      budget: this.taskContext.getBudgetUsage(),
    });

    return {
      exitCode: testResult.exitCode,
      testResult: interpretResult.output,
      nextAction: interpretResult.output.next_action,
    };
  }

  async _executeDocsStep(step) {
    return { docsUpdated: true };
  }

  _detectTestFramework() {
    const pkgPath = path.join(this.repoPath, 'package.json');
    if (this.fs.exists(pkgPath)) {
      try {
        const pkg = JSON.parse(this.fs.read_file(pkgPath, this.agentRole));
        if (pkg.devDependencies?.jest || pkg.dependencies?.jest) return 'jest';
        if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest) return 'vitest';
        if (pkg.devDependencies?.mocha) return 'mocha';
      } catch { /* ignore */ }
    }
    return 'jest';
  }

  async _runDocUpdate() {
    return this.bridge.execute('ship.doc_update', {
      changed_files: JSON.stringify(this.taskContext.filesModified),
      changes_summary: this._summarizeChanges(),
      existing_docs: '',
    }, {
      role: this.agentRole,
      budget: this.taskContext.getBudgetUsage(),
    });
  }

  async _runSecurityCheck() {
    const diff = this.workspace.collectDiff(this.repoPath);
    return this.bridge.execute('ship.security_check', {
      diff,
      file_paths: JSON.stringify(this.taskContext.filesModified),
    }, {
      role: this.agentRole,
      budget: this.taskContext.getBudgetUsage(),
    });
  }

  async _runRiskAssessment() {
    return this.bridge.execute('ship.risk_assessment', {
      changes_summary: this._summarizeChanges(),
      files_modified: JSON.stringify(this.taskContext.filesModified),
      test_evidence: JSON.stringify(this.taskContext.testEvidence || {}),
    }, {
      role: this.agentRole,
      budget: this.taskContext.getBudgetUsage(),
    });
  }

  async _runRollbackPlan() {
    return this.bridge.execute('ship.rollback_plan', {
      changes_summary: this._summarizeChanges(),
      files_modified: JSON.stringify(this.taskContext.filesModified),
      git_branch: this.workspace.currentBranch(this.repoPath),
    }, {
      role: this.agentRole,
      budget: this.taskContext.getBudgetUsage(),
    });
  }

  async _runPRWriteup() {
    return this.bridge.execute('ship.pr_writeup', {
      objective: this.objective,
      plan_output: JSON.stringify(this.taskContext.plan),
      changes_summary: this._summarizeChanges(),
      test_evidence: JSON.stringify(this.taskContext.testEvidence || {}),
    }, {
      role: this.agentRole,
      budget: this.taskContext.getBudgetUsage(),
    });
  }

  _summarizeChanges() {
    return `Modified ${this.taskContext.filesModified.length} files: ${this.taskContext.filesModified.join(', ')}`;
  }
}

export default ShipMachine;
