# ShipMachine ShipMachine — Architecture

> A pure engineering shipping machine. Every agent action is mediated by PromptOS.
> No life assistant. No free prompting. Just: Objective → Plan → Code → PR.

## North Star

Given a scoped engineering objective:
1. Survey the repo
2. Plan the work
3. Execute (code + tests + docs)
4. Package a PR-ready artifact

Every reasoning step maps to a **PromptSpec ID**. The agent never calls LLMs directly — it calls `PromptOS.execute()`.

---

## Layered Architecture

```
┌─────────────────────────────────────────────────────┐
│                  CONTROL PLANE                       │
│  policy rules · RBAC · budgets · allowed tools       │
│  allowed repos · dangerous action gates              │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│               ORCHESTRATOR (A)                       │
│  planner/executor loop                               │
│  task → scope → plan → step loop → finalize          │
└──────────┬──────────────────────┬───────────────────┘
           │                      │
┌──────────▼────────┐  ┌──────────▼──────────────────┐
│   TOOL ADAPTERS   │  │       PROMPTOS BRIDGE (B)    │
│  FS · Git · Exec  │  │  registry · execute()        │
│  Tests · PR       │  │  policy · RBAC · analytics   │
└───────────────────┘  │  eval · learning loop        │
                        └─────────────┬───────────────┘
                                      │
                        ┌─────────────▼───────────────┐
                        │    PROVIDER LAYER (C)        │
                        │  Claude · OpenAI · local     │
                        │  (behind PromptOS adapters)  │
                        └─────────────────────────────┘

Memory: task-scoped only (no persistent life assistant state)
```

---

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
  4c. exec tests       → run actual tests
  4d. ship.run_tests_interpret → pass? → next step / fail? → fix
  4e. ship.lint_fix    → on lint errors
  4f. ship.security_check → flag anything dangerous

Step 5: ship.doc_update → update relevant docs/comments

Step 6: ship.risk_assessment → risk level, blast radius
Step 7: ship.rollback_plan → rollback instructions
Step 8: ship.pr_writeup → PR title, body, checklist

OUTPUT: PR Bundle (patches + tests + docs + PR description)
```

---

## Tool API

```typescript
// Filesystem
FS.read_file(path: string): string
FS.write_file(path: string, content: string): void
FS.list_dir(path: string, recursive?: boolean): string[]
FS.search(pattern: string, dir: string): Match[]

// Git
Git.status(repoPath: string): StatusResult
Git.diff(repoPath: string): string
Git.branch(repoPath: string, name: string): void
Git.commit(repoPath: string, message: string): void
Git.apply_patch(repoPath: string, patch: string): ApplyResult

// Execution
Exec.run(cmd: string, cwd: string): ExecResult  // { stdout, stderr, exitCode }

// Tests
Tests.run(repoPath: string, cmd: string): TestResult
Tests.parse_results(output: string): ParsedTests

// PR (local bundle or GitHub)
PR.create_bundle(artifacts: PRBundle): void
PR.create_pr(bundle: PRBundle): string  // optional, requires policy allow
```

### Policy Gates

- Write/exec **only** within approved workspace
- No network calls unless `policy.network_allowed = true`
- Command allowlist: `npm test`, `pytest`, `make test`, etc.
- Dangerous commands (rm -rf, db migrations, etc.) → human confirmation flag
- RBAC: roles define which tool categories are accessible

---

## PromptOS Bridge

```typescript
// Agent always calls through bridge — never raw LLM
PromptOS.execute(promptId: string, inputs: Record<string, any>, context: AgentContext): PromptResult

// Bridge enforces:
// - policy check before execution
// - RBAC: does this agent role allow this prompt?
// - budget check: tokens/steps remaining?
// - analytics logging (every call)
// - output schema validation
// - learning loop: flag unexpected outputs for review
```

---

## Control Plane Config

```yaml
# control-plane/config.yaml
policy:
  network_allowed: false
  dangerous_commands_require_human: true
  allowed_commands:
    - "npm test"
    - "npm run build"
    - "pytest"
    - "make test"
    - "cargo test"
    - "go test ./..."
  allowed_paths:
    - "/workspace/**"

rbac:
  roles:
    - name: engineer
      allowed_prompts: ["ship.*"]
      allowed_tools: ["FS", "Git", "Exec", "Tests"]
    - name: reviewer
      allowed_prompts: ["ship.pr_writeup", "ship.risk_assessment"]
      allowed_tools: ["FS", "Git"]

budgets:
  max_steps: 50
  max_tokens: 500000
  max_time_minutes: 30
  max_files_modified: 20
```

---

## ShipMachine Core Pack

Located at: `promptos/packs/shipmachine-core/`

| PromptSpec ID | Purpose |
|---|---|
| `ship.scope_task` | Extract acceptance criteria, constraints, done-definition |
| `ship.repo_survey` | Map codebase, entrypoints, build/test commands |
| `ship.plan` | Multi-step plan with checkpoints + test gates |
| `ship.patch` | Produce code diff instructions / file edits |
| `ship.tests` | Generate/adjust tests |
| `ship.run_tests_interpret` | Read test output, decide next action |
| `ship.lint_fix` | Fix lint errors |
| `ship.security_check` | Basic security flag pass |
| `ship.doc_update` | Update docs and comments |
| `ship.pr_writeup` | PR title, body, checklist, rollout notes |
| `ship.risk_assessment` | Risk level, blast radius, dependencies |
| `ship.rollback_plan` | Rollback instructions |

All outputs are schema-validated JSON.

---

## Key Rules

1. **No free prompting.** Every LLM call maps to a PromptSpec ID.
2. **Policy first.** Every action checked against control plane before execution.
3. **RBAC enforced.** Agent role determines accessible prompts + tools.
4. **Budget-aware.** Steps, tokens, time all tracked and capped.
5. **Audit trail.** Every execute() call logged to analytics.
6. **Learning loop.** Unexpected outputs flagged for human review → prompt improvement.
7. **PR artifacts only.** Output is always a shippable bundle, not just text.
