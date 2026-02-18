import fs from 'fs';
import path from 'path';

/**
 * PRTool — creates PR artifact bundles.
 * Bundles: patch, test evidence, PR description, risk assessment, rollback plan, changelog.
 */
export class PRTool {
  constructor(policy, bundleBaseDir = null) {
    this.policy = policy;
    this.toolName = 'PR';
    this.bundleBaseDir = bundleBaseDir || path.join(process.cwd(), 'pr-bundles');
  }

  _assertToolAccess(role) {
    if (role && !this.policy.checkToolAllowed(role, this.toolName)) {
      throw new Error(`PR: role "${role}" does not have access to PR tool`);
    }
  }

  /**
   * Create a PR bundle directory with all artifacts.
   *
   * @param {Object} artifacts
   *   - diff: string (unified diff)
   *   - testEvidence: string (markdown test results)
   *   - prDescription: {title, body, checklist, labels, rollout_notes}
   *   - riskAssessment: {risk_level, blast_radius, ...}
   *   - rollbackPlan: {steps, commands, ...}
   *   - changelog: string
   *   - objective: string
   * @param {string} [role]
   * @returns {{bundlePath: string, files: string[]}}
   */
  create_bundle(artifacts, role = null) {
    this._assertToolAccess(role);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const bundlePath = path.join(this.bundleBaseDir, timestamp);

    fs.mkdirSync(bundlePath, { recursive: true });

    const files = [];

    // PATCH.diff
    if (artifacts.diff) {
      const diffPath = path.join(bundlePath, 'PATCH.diff');
      fs.writeFileSync(diffPath, artifacts.diff, 'utf8');
      files.push('PATCH.diff');
    }

    // TESTS_EVIDENCE.md
    if (artifacts.testEvidence) {
      const testPath = path.join(bundlePath, 'TESTS_EVIDENCE.md');
      const content = this._renderTestEvidence(artifacts.testEvidence);
      fs.writeFileSync(testPath, content, 'utf8');
      files.push('TESTS_EVIDENCE.md');
    }

    // PR_DESCRIPTION.md
    if (artifacts.prDescription) {
      const prPath = path.join(bundlePath, 'PR_DESCRIPTION.md');
      const content = this._renderPRDescription(artifacts.prDescription, artifacts.objective);
      fs.writeFileSync(prPath, content, 'utf8');
      files.push('PR_DESCRIPTION.md');
    }

    // RISK_ASSESSMENT.md
    if (artifacts.riskAssessment) {
      const riskPath = path.join(bundlePath, 'RISK_ASSESSMENT.md');
      const content = this._renderRiskAssessment(artifacts.riskAssessment);
      fs.writeFileSync(riskPath, content, 'utf8');
      files.push('RISK_ASSESSMENT.md');
    }

    // ROLLBACK_PLAN.md
    if (artifacts.rollbackPlan) {
      const rollbackPath = path.join(bundlePath, 'ROLLBACK_PLAN.md');
      const content = this._renderRollbackPlan(artifacts.rollbackPlan);
      fs.writeFileSync(rollbackPath, content, 'utf8');
      files.push('ROLLBACK_PLAN.md');
    }

    // CHANGELOG.md
    if (artifacts.changelog) {
      const changelogPath = path.join(bundlePath, 'CHANGELOG.md');
      const content = typeof artifacts.changelog === 'string'
        ? artifacts.changelog
        : this._renderChangelog(artifacts.changelog);
      fs.writeFileSync(changelogPath, content, 'utf8');
      files.push('CHANGELOG.md');
    }

    // MANIFEST.json — metadata about the bundle
    // Push MANIFEST.json to files BEFORE writing so it appears in its own files array
    files.push('MANIFEST.json');
    const manifest = {
      created: new Date().toISOString(),
      objective: artifacts.objective || 'Unknown objective',
      files,
      riskLevel: artifacts.riskAssessment?.risk_level || 'unknown',
      goNoGo: artifacts.riskAssessment?.go_no_go || 'unknown',
    };
    fs.writeFileSync(
      path.join(bundlePath, 'MANIFEST.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    return { bundlePath, files };
  }

  /**
   * Stub: "Create" a PR (logs intent, returns bundle path).
   * In production, this would call GitHub/GitLab API.
   *
   * @param {{bundlePath: string}} bundle
   * @param {string} [role]
   * @returns {{bundlePath: string, prUrl: string, status: string}}
   */
  create_pr(bundle, role = null) {
    this._assertToolAccess(role);

    const manifestPath = path.join(bundle.bundlePath, 'MANIFEST.json');
    let manifest = {};
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch { /* ignore */ }

    console.log(`\n[PR] Would create PR for bundle: ${bundle.bundlePath}`);
    console.log(`[PR] Objective: ${manifest.objective || 'Unknown'}`);
    console.log(`[PR] Risk Level: ${manifest.riskLevel || 'unknown'}`);
    console.log(`[PR] Go/No-Go: ${manifest.goNoGo || 'unknown'}`);
    console.log(`[PR] Status: STUB — integrate with GitHub/GitLab API to actually create PR`);

    return {
      bundlePath: bundle.bundlePath,
      prUrl: `[stub] https://github.com/your-org/your-repo/pull/NEW`,
      status: 'stub',
      manifest,
    };
  }

  /**
   * List all existing PR bundles.
   * @returns {{timestamp: string, bundlePath: string, manifest: Object}[]}
   */
  list_bundles() {
    if (!fs.existsSync(this.bundleBaseDir)) return [];

    return fs.readdirSync(this.bundleBaseDir)
      .filter(name => {
        const full = path.join(this.bundleBaseDir, name);
        return fs.statSync(full).isDirectory();
      })
      .map(name => {
        const bundlePath = path.join(this.bundleBaseDir, name);
        const manifestPath = path.join(bundlePath, 'MANIFEST.json');
        let manifest = {};
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch { /* ignore */ }
        return { timestamp: name, bundlePath, manifest };
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  // ---- Rendering Helpers ----

  _renderTestEvidence(evidence) {
    if (typeof evidence === 'string') return evidence;
    const { passed = 0, failed = 0, total = 0, output = '', format = 'unknown' } = evidence;
    return `# Test Evidence

## Summary
- **Format:** ${format}
- **Passed:** ${passed}
- **Failed:** ${failed}
- **Total:** ${total}
- **Result:** ${failed === 0 ? '✅ All tests passed' : `❌ ${failed} test(s) failed`}

## Raw Output

\`\`\`
${output}
\`\`\`
`;
  }

  _renderPRDescription(pr, objective = '') {
    const checklist = (pr.checklist || []).map(item => `- [ ] ${item}`).join('\n');
    const labels = (pr.labels || []).join(', ');

    return `# ${pr.title || 'PR Description'}

## Objective
${objective}

## Description
${pr.body || ''}

## Checklist
${checklist}

## Labels
${labels}

## Rollout Notes
${pr.rollout_notes || 'None'}
`;
  }

  _renderRiskAssessment(risk) {
    const deps = (risk.dependencies_affected || []).map(d => `- ${d}`).join('\n');
    return `# Risk Assessment

| Field | Value |
|-------|-------|
| **Risk Level** | ${risk.risk_level || 'unknown'} |
| **Blast Radius** | ${risk.blast_radius || 'unknown'} |
| **Rollback Complexity** | ${risk.rollback_complexity || 'unknown'} |
| **Go/No-Go** | ${risk.go_no_go || 'unknown'} |

## Dependencies Affected
${deps || 'None'}
`;
  }

  _renderRollbackPlan(rollback) {
    const steps = (rollback.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n');
    const commands = (rollback.commands || []).map(c => `\`${c}\``).join('\n');

    return `# Rollback Plan

## Steps
${steps}

## Commands
${commands}

## Estimated Time
${rollback.estimated_time || 'Unknown'}

## Data Impact
${rollback.data_impact || 'None'}
`;
  }

  _renderChangelog(changelog) {
    if (typeof changelog === 'string') return changelog;
    if (changelog.changelog_entry) {
      return `# Changelog\n\n${changelog.changelog_entry}\n`;
    }
    return '# Changelog\n\nNo changes recorded.\n';
  }
}

export default PRTool;
