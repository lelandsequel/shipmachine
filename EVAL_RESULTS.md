# ShipMachine Agent Eval Results

**Date:** 2026-02-18T14:07:25.887Z
**Mode:** Live
**Duration:** 1.0s

## Summary

| Metric | Value |
|--------|-------|
| Total Fixtures | 2 |
| Passed | 0 |
| Failed | 2 |
| Success Rate | 0% |

## Results by Fixture

### ❌ simple-feature
**Add a hello() function to utils.js that returns "Hello, World!"**
- Duration: 515ms



| Check | Result |
|-------|--------|
| hello() function added to utils.js | ❌ Fail — hello() function not found in utils.js |
| Tests pass | ✅ Pass — node utils.test.js exited 0 |
| PR bundle generated | ❌ Fail — No PR bundle in result |
| No policy violations | ✅ Pass — Clean |

### ❌ bugfix
**Fix the off-by-one error in getLastItem() in array-utils.js**
- Duration: 451ms



| Check | Result |
|-------|--------|
| Off-by-one bug fixed in source | ❌ Fail — Bug still present or fix incomplete |
| Tests pass after fix | ❌ Fail — Command failed: node array-utils.test.js |
| PR bundle generated | ❌ Fail — Missing PR bundle |
| No policy violations | ✅ Pass — Clean |


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
