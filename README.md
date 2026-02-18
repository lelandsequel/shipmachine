# ZeroClaw ShipMachine

> A pure engineering shipping agent. Every LLM call is mediated by PromptOS. No life assistant. No free prompting. Just: **Objective → Plan → Code → PR**.

## What is ShipMachine?

ZeroClaw ShipMachine is an **engineering-only** AI agent designed for one purpose: take an engineering objective and ship it. It's not a personal assistant, not a chat bot — it's a deterministic shipping machine.

**Every LLM call is mediated by PromptOS.** There are no raw LLM calls. Every reasoning step maps to a `PromptSpec` ID with strict schema validation on inputs and outputs.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CONTROL PLANE                            │
│  Policy Rules · RBAC · Budgets · Allowed Tools              │
│  Dangerous Action Gates                                     │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                 ORCHESTRATOR                                │
│  Task → Scope → Survey → Plan → Step Loop → Finalize        │
└──────────┬──────────────────────┬─────────────────────────┘
           │                      │
┌──────────▼──────────┐  ┌──────▼─────────────────────────┐
│   TOOL ADAPTERS     │  │      PROMPTOS BRIDGE           │
│  FS · Git · Exec   │  │  Registry · execute()          │
│  Tests · PR        │  │  Policy · RBAC · Analytics     │
└────────────────────┘  └──────────┬───────────────────────┘
                                   │
                         ┌─────────▼───────────┐
                         │    PROVIDER LAYER    │
                         │  Claude · OpenAI     │
                         │  (behind adapters)  │
                         └─────────────────────┘
```

## Pipeline: Task → PR

```
INPUT: "Objective" + repo path + policy context

Step 1: ship.scope_task
  → acceptance criteria, constraints, done-definition (JSON)

Step 2: ship.repo_survey
  → codebase map, entrypoints, build/test commands (JSON)

Step 3: ship.plan
  → ordered steps with checkpoints + test gates (JSON)

Step 4: LOOP until done/failed/budget-exceeded
  4a. ship.patch       → file edits (JSON diff instructions)
  4b. ship.tests       → test generation/update
  4c. exec tests      → run actual tests
  4d. ship.run_tests_interpret → pass? → next step / fail? → fix
  4e. ship.lint_fix   → on lint errors
  4f. ship.security_check → flag anything dangerous

Step 5: ship.doc_update → update relevant docs/comments

Step 6: ship.risk_assessment → risk level, blast radius
Step 7: ship.rollback_plan → rollback instructions
Step 8: ship.pr_writeup → PR title, body, checklist, rollout notes

OUTPUT: PR Bundle (patches + tests + docs + PR description)
```

## Quick Start

### Prerequisites

- Node.js 18+
- Git

### Installation

```bash
# Clone or navigate to the project
cd zeroclaw-shipmachine

# Install dependencies
npm install

# Link the CLI
npm link
```

### Running a Task

```bash
zeroclaw run-task \
  --repo /path/to/your/repo \
  --objective "Add rate limiting to the /api/users endpoint"
```

### Dry Run Mode

```bash
zeroclaw run-task \
  --repo /path/to/repo \
  --objective "Add feature X" \
  --dry-run
```

### Other Commands

```bash
# Show last task status
zeroclaw status

# Show analytics summary
zeroclaw analytics

# List available prompts
zeroclaw pack list
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `zeroclaw run-task --repo <path> --objective "..."` | Run a shipping task |
| `zeroclaw status` | Show last task status |
| `zeroclaw analytics` | Show analytics summary |
| `zeroclaw pack list` | List available prompt packs |

### Options

- `--role <role>` — Agent role: `engineer`, `reviewer`, or `readonly` (default: engineer)
- `--dry-run` — Plan without executing changes
- `--config <path>` — Path to custom `config.yaml`

## Control Plane Configuration

Edit `control-plane/config.yaml` to customize behavior:

```yaml
policy:
  network_allowed: false           # Allow network calls (dangerous!)
  dangerous_commands_require_human: true  # Gate dangerous commands
  allowed_commands:               # Whitelist of allowed commands
    - "npm test"
    - "npm run build"
    - "pytest"
    - "make test"
    - "cargo test"
  allowed_paths:                  # Filesystem access whitelist
    - "/workspace/**"
    - "/Users/**"

rbac:
  roles:
    - name: engineer
      allowed_prompts: ["ship.*"]  # Wildcard supported
      allowed_tools: ["FS", "Git", "Exec", "Tests", "PR"]

budgets:
  max_steps: 50           # Max reasoning steps
  max_tokens: 500000       # Max LLM tokens
  max_time_minutes: 30    # Max runtime
  max_files_modified: 20  # Max files changed
```

### RBAC Roles

| Role | Allowed Prompts | Allowed Tools |
|------|-----------------|---------------|
| `engineer` | `ship.*` (all) | FS, Git, Exec, Tests, PR |
| `reviewer` | `ship.pr_writeup`, `ship.risk_assessment`, `ship.rollback_plan` | FS, Git |
| `readonly` | `ship.repo_survey`, `ship.scope_task` | FS |

### Budget Limits

| Limit | Default | Description |
|-------|---------|-------------|
| `max_steps` | 50 | Reasoning steps before abort |
| `max_tokens` | 500,000 | Total LLM tokens per run |
| `max_time_minutes` | 30 | Wall-clock time limit |
| `max_files_modified` | 20 | Files that can be changed |

## PromptOS Bridge

The **PromptOS Bridge** is the core of ShipMachine. Every LLM call goes through it:

```javascript
const bridge = new PromptOSBridge('./promptos/packs');

// Execute a prompt
const result = await bridge.execute('ship.plan', {
  objective: 'Add feature X',
  scope_output: scopeJson,
  repo_survey_output: surveyJson,
}, {
  role: 'engineer',
  budget: { steps: 5, tokens: 10000, timeMinutes: 2, filesModified: 2 }
});
```

The bridge enforces:

1. **Policy check** — Is this prompt allowed?
2. **RBAC check** — Does this role have access?
3. **Budget check** — Do we have resources left?
4. **Prompt loading** — Fetch PromptSpec from registry
5. **Template rendering** — Substitute `{{var}}` placeholders
6. **LLM call** — Call Claude API or mock
7. **Schema validation** — Validate output against schema
8. **Analytics logging** — Audit trail for every call

## Adding New Prompt Packs

1. Create a directory: `promptos/packs/my-new-pack/`
2. Add `pack.yaml`:

```yaml
name: my-new-pack
version: "1.0.0"
description: "My custom prompts"
prompts:
  - id: ship.my_prompt
    file: prompts/my-prompt.yaml
    category: custom
```

3. Add your prompt YAML file in `prompts/my-prompt.yaml`:

```yaml
id: ship.my_prompt
name: My Custom Prompt
description: Does something useful

inputs:
  - name: input_var
    type: string
    required: true

outputs:
  schema:
    type: object
    required: [result]
    properties:
      result:
        type: string

prompt: |
  Do something with {{input_var}}.

  Output JSON:
  {"result": "..."}

examples:
  - inputs:
      input_var: "hello"
    expected_output:
      result: "processed hello"
```

4. Reload registry (or restart) — prompts are auto-discovered.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key for real LLM calls |
| (none) | Uses mock responses for testing |

## Output Artifacts

When a task completes, a PR bundle is created in `pr-bundles/{timestamp}/`:

```
pr-bundles/2024-01-15T10-30-00-000Z/
├── PATCH.diff           # Unified diff of all changes
├── TESTS_EVIDENCE.md   # Test run results
├── PR_DESCRIPTION.md   # PR title, body, checklist
├── RISK_ASSESSMENT.md  # Risk analysis
├── ROLLBACK_PLAN.md    # Rollback instructions
├── CHANGELOG.md        # Changelog entry
└── MANIFEST.json       # Bundle metadata
```

## Key Rules

1. **No free prompting** — Every LLM call maps to a PromptSpec ID
2. **Policy first** — Every action checked against control plane
3. **RBAC enforced** — Agent role determines accessible prompts + tools
4. **Budget-aware** — Steps, tokens, time all tracked and capped
5. **Audit trail** — Every execute() call logged to analytics
6. **Learning loop** — Unexpected outputs flagged for human review
7. **PR artifacts only** — Output is always a shippable bundle

## License

MIT — JourdanLabs / Android 18
