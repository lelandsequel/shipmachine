/**
 * LLMAdapter — wraps Claude API (or mock) for PromptOS bridge.
 * If ANTHROPIC_API_KEY is set, calls Claude. Otherwise returns realistic mock responses.
 */
export class LLMAdapter {
  constructor(config = {}) {
    this.model = config.model || 'claude-sonnet-4-6';
    this.maxTokens = config.maxTokens || 4096;
    this.apiKey = process.env.ANTHROPIC_API_KEY || null;
    this._client = null;
  }

  /**
   * Initialize the Anthropic client if API key is available.
   */
  async _getClient() {
    if (this._client) return this._client;
    if (!this.apiKey) return null;

    try {
      const { Anthropic } = await import('@anthropic-ai/sdk');
      this._client = new Anthropic({ apiKey: this.apiKey });
      return this._client;
    } catch (err) {
      console.warn(`LLMAdapter: failed to init Anthropic client: ${err.message}`);
      return null;
    }
  }

  /**
   * Call the LLM with a prompt.
   *
   * @param {string} prompt - rendered prompt text
   * @param {string} [model] - override model
   * @param {Object} [outputSchema] - expected JSON schema (used for mock response generation)
   * @returns {{content: any, tokensUsed: number, isMock: boolean}}
   */
  async call(prompt, model = null, outputSchema = null) {
    const client = await this._getClient();

    if (!client) {
      return this._mockResponse(prompt, outputSchema);
    }

    try {
      // Race against 45s timeout to avoid SIGKILL
      const timeoutMs = 45000;
      const callPromise = client.messages.create({
        model: model || this.model,
        max_tokens: this.maxTokens,
        messages: [{ role: 'user', content: prompt }],
        system: 'You are ShipMachine ShipMachine, an engineering-only AI agent. Always respond with valid JSON matching the requested output schema. No markdown code blocks, no explanations — pure JSON only.',
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`LLM call timed out after ${timeoutMs}ms`)), timeoutMs)
      );
      const response = await Promise.race([callPromise, timeoutPromise]);

      const rawContent = response.content[0]?.text || '{}';
      const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

      let parsed;
      try {
        // Strip markdown code blocks if present
        const cleaned = rawContent.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = { raw: rawContent };
      }

      return { content: parsed, tokensUsed, isMock: false };
    } catch (err) {
      console.warn(`LLMAdapter: Claude API error: ${err.message}, falling back to mock`);
      return this._mockResponse(prompt, outputSchema);
    }
  }

  /**
   * Generate a realistic mock response based on the prompt content and schema.
   * Used when no API key is configured.
   */
  _mockResponse(prompt, outputSchema) {
    const promptLower = prompt.toLowerCase();
    let content = {};
    const tokensUsed = Math.floor(Math.random() * 800) + 200;

    // Detect which prompt this is based on content
    if (promptLower.includes('scope') && promptLower.includes('acceptance')) {
      content = this._mockScopeTask(prompt);
    } else if (promptLower.includes('survey') && promptLower.includes('entrypoint')) {
      content = this._mockRepoSurvey(prompt);
    } else if (promptLower.includes('plan') && promptLower.includes('steps')) {
      content = this._mockPlan(prompt);
    } else if (promptLower.includes('patch') && promptLower.includes('edits')) {
      content = this._mockPatch(prompt);
    } else if (promptLower.includes('test') && promptLower.includes('test_content')) {
      content = this._mockTests(prompt);
    } else if (promptLower.includes('interpret') && promptLower.includes('next_action')) {
      content = this._mockRunTestsInterpret(prompt);
    } else if (promptLower.includes('lint') && promptLower.includes('fixed_content')) {
      content = this._mockLintFix(prompt);
    } else if (promptLower.includes('security') && promptLower.includes('risk_level')) {
      content = this._mockSecurityCheck(prompt);
    } else if (promptLower.includes('doc') && promptLower.includes('changelog_entry')) {
      content = this._mockDocUpdate(prompt);
    } else if (promptLower.includes('pr') && promptLower.includes('checklist')) {
      content = this._mockPRWriteup(prompt);
    } else if (promptLower.includes('risk') && promptLower.includes('blast_radius')) {
      content = this._mockRiskAssessment(prompt);
    } else if (promptLower.includes('rollback') && promptLower.includes('estimated_time')) {
      content = this._mockRollbackPlan(prompt);
    } else {
      content = { mock: true, message: 'Unrecognized prompt type — generic mock response' };
    }

    return { content, tokensUsed, isMock: true };
  }

  _mockScopeTask(prompt) {
    return {
      acceptance_criteria: [
        'Feature is implemented according to the objective specification',
        'All existing tests continue to pass',
        'New tests cover the new functionality',
        'Code follows existing style and conventions',
        'Documentation is updated if applicable',
      ],
      constraints: [
        'No breaking changes to public API',
        'Must be backward compatible',
        'Performance impact must be minimal',
      ],
      done_definition: 'Implementation is complete, tests pass, code is reviewed, and PR is created with all required artifacts',
      risk_flags: [
        'May affect downstream consumers if interface changes',
        'Requires thorough testing before merge',
      ],
    };
  }

  _mockRepoSurvey(prompt) {
    return {
      entrypoints: ['index.js', 'src/main.js'],
      build_command: 'npm run build',
      test_command: 'npm test',
      lint_command: 'npm run lint',
      key_modules: [
        { path: 'src/core/', purpose: 'Core business logic' },
        { path: 'src/utils/', purpose: 'Utility functions' },
        { path: 'src/api/', purpose: 'API layer' },
      ],
      tech_stack: ['Node.js', 'JavaScript', 'ESM modules', 'Jest'],
    };
  }

  _mockPlan(prompt) {
    return {
      steps: [
        {
          id: 'step-1',
          description: 'Analyze existing code structure and identify files to modify',
          type: 'analysis',
          files_affected: [],
          test_checkpoint: false,
        },
        {
          id: 'step-2',
          description: 'Implement core feature changes',
          type: 'patch',
          files_affected: ['src/core/feature.js'],
          test_checkpoint: true,
        },
        {
          id: 'step-3',
          description: 'Update tests to cover new functionality',
          type: 'tests',
          files_affected: ['src/core/__tests__/feature.test.js'],
          test_checkpoint: true,
        },
        {
          id: 'step-4',
          description: 'Update documentation',
          type: 'docs',
          files_affected: ['README.md'],
          test_checkpoint: false,
        },
      ],
      estimated_complexity: 'medium',
      warnings: [
        'Ensure backward compatibility is maintained',
        'Run full test suite after each patch step',
      ],
    };
  }

  _mockPatch(prompt) {
    return {
      file_path: 'src/core/feature.js',
      edits: [
        {
          line_start: 1,
          line_end: 1,
          new_content: '// Updated by ShipMachine ShipMachine',
          reason: 'Add attribution comment',
        },
      ],
      summary: 'Mock patch: adds attribution comment. In production, real edits based on the step description would be generated.',
    };
  }

  _mockTests(prompt) {
    return {
      test_file_path: 'src/__tests__/feature.test.js',
      test_content: `import { describe, it, expect } from '@jest/globals';

describe('Feature', () => {
  it('should work as expected', () => {
    expect(true).toBe(true);
  });

  it('should handle edge cases', () => {
    expect(null).toBeNull();
  });
});`,
      test_cases: [
        'should work as expected',
        'should handle edge cases',
      ],
      coverage_targets: ['src/core/feature.js'],
    };
  }

  _mockRunTestsInterpret(prompt) {
    const hasFailure = prompt.toLowerCase().includes('fail') || prompt.toLowerCase().includes('error');
    return {
      passed: !hasFailure,
      failing_tests: hasFailure ? ['example.test.js > some test'] : [],
      root_cause: hasFailure ? 'Mock: test failure detected in output' : 'No failures detected',
      suggested_fix: hasFailure ? 'Review the failing test and fix the underlying implementation' : 'No fix needed',
      next_action: hasFailure ? 'fix' : 'continue',
    };
  }

  _mockLintFix(prompt) {
    return {
      fixes: [
        {
          line: 1,
          issue: 'Missing semicolon (mock)',
          fix: 'Add semicolon at end of statement',
        },
      ],
      fixed_content: '// Fixed content would be here in production\n// Mock response from LLMAdapter\n',
    };
  }

  _mockSecurityCheck(prompt) {
    return {
      risk_level: 'low',
      issues: [],
      safe_to_proceed: true,
    };
  }

  _mockDocUpdate(prompt) {
    return {
      updates: [
        {
          file: 'README.md',
          section: 'Usage',
          new_content: '## Usage\n\nUpdated usage documentation would appear here.\n',
        },
      ],
      changelog_entry: `## [Unreleased]\n\n### Changed\n- Updated feature implementation\n- Improved documentation\n`,
    };
  }

  _mockPRWriteup(prompt) {
    return {
      title: 'feat: implement requested engineering changes',
      body: '## Summary\n\nThis PR implements the requested changes as planned by ShipMachine ShipMachine.\n\n## Changes\n\n- Core implementation updates\n- Test coverage added\n- Documentation updated\n\n## Testing\n\nAll tests pass. See TESTS_EVIDENCE.md for details.',
      checklist: [
        'Tests pass',
        'Code reviewed',
        'Documentation updated',
        'No breaking changes',
        'Risk assessment completed',
        'Rollback plan prepared',
      ],
      labels: ['enhancement', 'automated-pr'],
      rollout_notes: 'Standard deployment. No special steps required.',
    };
  }

  _mockRiskAssessment(prompt) {
    return {
      risk_level: 'low',
      blast_radius: 'Limited to modified modules',
      dependencies_affected: [],
      rollback_complexity: 'simple',
      go_no_go: 'go',
    };
  }

  _mockRollbackPlan(prompt) {
    return {
      steps: [
        'Checkout the previous stable branch or tag',
        'Revert the merged PR if already merged',
        'Run test suite to verify rollback succeeded',
        'Deploy previous version',
      ],
      commands: [
        'git checkout main',
        'git revert HEAD',
        'npm test',
      ],
      estimated_time: '15 minutes',
      data_impact: 'None — no database migrations or data changes',
    };
  }
}

export default LLMAdapter;
