# Spike findings

e2e 0.23.1, @e2e-dev/web 0.16.0, @e2e-dev/acp 0.1.2 with `claudeCode({ model: 'sonnet' })`, Node 25.5.0, macOS, Chromium. All runs from 2026-11-15. The raw reports are in `spike/runs/` (gitignored).

## Verdict: GO

The go rule for the spike was "at least 1 caught, plus at least 1 got-through or healed-past, each shown by `report.json`". All three outcomes appeared on today's e2e, and every repeat gave the same result:

| Bug planted | Test | Result | Repeats |
|---|---|---|---|
| Header "Upgrade" button does nothing | `agent.act('upgrade the workspace to the Pro plan')` + `agent.assert('the workspace is on the Pro plan')` | **healed past**: the test passed while the button was broken | 3 of 3 |
| Cart API lost a book; its total matches what is left ($25.00) | `expect(getByTestId('cart-total')).toHaveText('$42.50')` | **caught** | 2 of 2 |
| Same | `agent.assert('the cart total is correct')` | **got through** | 2 of 2 |
| Total shows `$42.49` instead of `$42.50` | `expect(...).toHaveText('$42.50')` | caught | 1 of 1 |
| Same | `agent.assert('the cart total is correct')` | caught: the model added up the line totals | 3 of 3 |
| `POST /api/plan` answers 500 | the upgrade test | caught: the `act` failed with `ACTION_FAILED` and reported the error message | 1 of 1 |

## The headline case, from the trace

`runs/m-dead-1/results/…upgrade-to-pro…/trace.md`:

```text
2. ✓ agent.act "upgrade the workspace to the Pro plan" (37.1s, 1 model call)
   - cache: replayed 1 of 1 recorded action, then the agent took over: the recorded end state
     did not show … still showing status "Current plan: Free" and button "Upgrade"; recording deleted
   - tap button "Upgrade"
   - ℹ console: [e2e-mutate] applied upgrade-button-dead
   - tap button "Upgrade"
   - ℹ console: [e2e-mutate] applied upgrade-button-dead
   - tap link "Settings"
   - tap button "Switch to Pro" in "Plan"
3. ✓ agent.assert "the workspace is on the Pro plan"
```

In `report.json` this step is `cache.mode: 'agent-concluded'`, `reason: 'end-mismatch'`, `replayedActions: 1/1`, `write: 'evicted'`, and the test status is `passed`. Without the mutant, the same step replays as `self-finalized` 1/1 with no model call (`runs/baseline-replay`).

## The seven unknowns the spike had to answer

| # | Question | Answer |
|---|---|---|
| 1 | Does a dead control make the agent take a second route and pass? | **Yes, 3 of 3** (see above) |
| 2 | Does a vague `agent.assert` pass a wrong-number screen? | **Only when the screen stays consistent.** A `$42.49` total next to line totals that add up to `$42.50` was caught 3 of 3, for example: "Cart total shows $42.49, but the line totals … sum to $42.50". A cart that lost a book, with a matching total, got through 2 of 2. |
| 3 | How does replay react to a mutated screen? | A dead control: replay finishes its actions, then stops with `end-mismatch` and hands off to the agent. A 500: the same `end-mismatch`, then the agent fails the step. |
| 4 | Does `mutate()` read its script from an environment variable? | **Yes.** `E2E_MUTATE_SCRIPT=<absolute path>`, read in the config and passed as `web({ initScripts: [{ path }] })`, worked in every run. |
| 5 | Can the page report to a `127.0.0.1` collector? | **Yes, and the app log is better.** `sendBeacon` reached the collector every time. e2e's `appLog` also keeps each `console.info` line with the step it happened in (`log step=1 console/info: [e2e-mutate] applied upgrade-button-dead`). |
| 6 | Does Claude Code over ACP replay from the cache and report cost? | **Yes to both.** The `act` replayed as `self-finalized` with no model call, and every run that called the model (11 of 15; the 4 model-free runs print no AI line) printed tokens and dollars (`AI 54.0k tokens · 83% cached · $0.0456 · 2 model calls · …/sonnet`). |
| 7 | What do time and cost look like? | Per mutant run, on Sonnet through a Claude subscription (the dollar amounts are e2e's estimates, not a bill): 5 s and $0.025 (cent bug, one test), 9 s and $0.023 (lost item, two tests), 29 s and $0.030 (500), 40–42 s and $0.049 (healed past). The whole spike: about $0.43. |

Two safety checks also passed:
- The baseline cache checksum was identical after all runs (`shasum -c runs/cache-baseline.sha`).
- `git status` showed no change outside `spike/runs/`.

## What changes in the plan

1. **The app log becomes the main channel.** Each mutant writes `console.info('[e2e-mutate] applied <id>')`, and `report.json` gives the step index for each test and attempt. That makes "the failing step started after the bug applied" a simple compare of step numbers. The collector stays only for the recorder's bigger baseline payloads, since app-log lines are capped at 300 characters.
2. **The strongest bugs are consistent but wrong.** Sonnet checks arithmetic and internal consistency well, so a screen that contradicts itself gets caught even by a vague assert. What gets through is a screen that is self-consistent but doesn't match what should be there: a lost item with a matching total, or a changed price with matching line totals. Operators 7 and 8 (wrong API value, missing API item) should keep derived values like totals consistent, the way a real backend bug would. The demo suite's "expected to miss" column changes to match.
3. **Healing is slow, and the report can use that.** A healed-past step took 37 s against 0.17 s when replayed. The report should show "this step took 200× longer than its baseline" next to every healed past.
4. **The agent fails honestly on errors it can see.** With the 500, the agent said "Both times the app showed 'Could not change the plan' …" and failed the step. That's good behavior and worth showing in the demo as a contrast to healed past.
5. **Setup notes for the README:**
   - When e2e is started from inside a Claude Code session, run it with a clean environment (`env -i`, as in `tools/run.sh`), so the nested Claude Code agent doesn't pick up the host session's `CLAUDE*` variables.
   - The standalone `claude` CLI needs its own sign-in (`claude auth login`); the desktop app's login doesn't carry over.

## Files

- `app/server.mjs`: the spike app. It has two routes to upgrade, a cart whose total comes from the API, and state per session cookie.
- `tests/spike.e2e.ts`: the 3 tests (strong, vague, loose goal).
- `probe/plan.e2e.ts`, `e2e.probe.config.ts`: model-free probes for the two plan mutants. They confirm the dead button breaks only the header route, and the 500 breaks both. The cart mutants have no probe; `strong-cent` covers the cent one.
- `mutants/*.js`: `cart-total-cent`, `cart-lost-item`, `upgrade-button-dead`, `plan-post-500`.
- `tools/run.sh`: one run with a clean environment, its own output dir and a fresh cache copy.
- `tools/summarize.mjs`: prints the steps, cache modes, errors and app log from a run's report.
- `tools/collector.mjs`: the `127.0.0.1` beacon collector.
