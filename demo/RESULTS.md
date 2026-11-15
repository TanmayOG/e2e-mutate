# Demo results

Recorded 2026-11-15 on macOS, Node 25.5.0, with these versions:
- `e2e` 0.23.1 and `@e2e-dev/web` 0.16.0 (Chromium)
- `@e2e-dev/acp` 0.1.2 running Claude Code (`claudeCode({ model: 'sonnet' })`)

Each drill was started by hand as `npx e2e-mutate --clean-env --max-mutants 40 --concurrency 3`, with `--config e2e.after.config.ts --out .e2e-mutate-after` added for the second. Confirm runs and videos were on. The `drill` scripts in `e2e/package.json` run the same commands. Every number below comes from the drills' own output, committed in [`evidence/`](evidence/):
- `before.drill.json` and `after.drill.json`: every bug, its outcome, and each test's verdict
- `before.terminal.txt` and `after.terminal.txt`: each drill's terminal output
- `suite-*.replay.log`: each suite's normal green run

The full HTML reports, videos and traces are local outputs (`e2e/.e2e-mutate*/`) and are not committed.

## Before and after

Both drills planted **the same 40 bugs** (51 possible bugs found each time; the cap was 40).

| | Before (`tests-before/`) | After (`tests-after/`) |
|---|---|---|
| **Catch rate** | **27 of 40 (68%)** | **36 of 39 (92%)** |
| Healed past | 6 | 1 |
| Got through | 7 | 2 |
| Not scored | 0 | 1 flaky |
| Confirm runs | 13 | 4 |
| Drill time | 8m 54s | 7m 54s |
| Estimated model cost | $2.37 (baseline $0.19) | $1.93 (baseline $0.20) |

By bug type, caught out of planted (before → after):

| Type | Before | After |
|---|---|---|
| wrong number | 5/6 | 6/6 |
| wrong word | 2/4 | 4/4 |
| missing element | 3/6 | 5/6 |
| dead control | 5/6 | 6/6 |
| swapped rows | 0/2 | 0/2 |
| server error | 5/5 | 5/5 |
| lost write | 3/4 | 4/4 |
| wrong API value | 2/5 | 4/5 |
| missing API item | 2/2 | 2/2 |

The "missing element" count after is 5/6 because the sixth is the flaky one, not a miss.

Costs are e2e's own estimates (`usage.estimatedCostUsd`). The model ran through Claude Code signed in with a claude.ai account (`claude auth status`: `"authMethod": "claude.ai"`), so they are not a per-call bill.

## The 6 bugs the "before" suite healed past

In each case the test **passed** with the bug in place. An `agent.act` that replays without the model in the baseline stopped matching the app, handed off to the agent, and the agent finished the goal anyway.

| Bug | Test | What happened |
|---|---|---|
| The "Cart (3)" link in the nav does nothing | cart total adds up | Replay tapped the link, the agent tapped it again, then **opened `/cart` directly** (`navigate to "/cart"` in the trace). The agent's own note: "Link tap did not navigate, so I opened /cart directly". The step took 26.0 s against 0.69 s replayed. This run is the clip in the video. |
| The order status says "Pending" instead of "Confirmed" | check out a cart | The agent took over "place the order", and the test passed. Nothing checked the status. |
| The order number is hidden | check out a cart | The agent took over the order step, and `toHaveText(/^BK-\d{4}$/)` still passed (see "toHaveText on a hidden element" below). |
| The cart API answers Dune's price as $14.50, with totals kept consistent | cart total adds up | Replay stopped on "missing cell $25.00 and node $42.50". The agent re-checked, and "the cart total is correct" agreed with the self-consistent screen. |
| The cart API answers qty 2 after adding Dune once | add a book to the cart | The agent took over "add Dune to the cart", and "the cart has the book" passed. |
| The cart API answers Neuromancer's price as $19.50 | remove a book from the cart | The agent took over "remove Dune". The test checks rows, not prices. |

## The 7 bugs that got through

- **`PUT /api/profile` answered OK but saved nothing.** "Profile saved" showed, and `agent.assert('the profile was saved')` passed.
- **The order total was hidden.** `expect(getByTestId('order-total')).toHaveText('$12.50')` passed.
- **The checkout total was hidden.** Nothing checked it.
- **Solaris showed $21.25** where it should show $11.25. The catalog test didn't check that price.
- **Every in-stock book (Dune, Neuromancer, Hyperion) showed "Out of stock".** The catalog test only checked Solaris's stock.
- **Two list orders swapped** (catalog and cart). The order doesn't matter in this shop; these belong on the ignore list.

### `toHaveText` on a hidden element

The order total and order number were `display: none`, and `toHaveText` still passed. That matches e2e's documented behavior:
- A test-id query matches hidden nodes unless you ask otherwise: "On the other query kinds, `visible: true` keeps only nodes that render" (`docs/reference/screen.mdx`, the Note under the role query).
- Its text still reads: "A node that is not rendered itself, such as a `display: none` one, reads its DOM text, as `innerText` does" (`docs/reference/screen.mdx`, `textContent`). `toHaveText` reads that same text (`docs/reference/expect.mdx`, Text matching).

The trace for the order-total bug shows the bug applying at step 5, then `expect.toHaveText getByTestId("order-total")` passing at step 7. The report's suggestion is `toBeVisible()`, or `{ visible: true }`. So the drill found a gap in a deterministic check, not only in AI judgments.

## What each tightened test answers

| Test | Change | Bugs now caught |
|---|---|---|
| catalog | pins every row's price and stock | Solaris price, "Out of stock" flip |
| add to cart | `expect` the `Cart (1)` link; assert "exactly 1 copy of Dune" | qty 2 (healed past before) |
| cart total | opens the cart with a locator; pins the prices and the total; `toBeVisible` on the total | dead "Cart" link and wrong Dune price (both healed past before) |
| checkout | `toBeVisible` on the checkout total, order number and order total; `toHaveText('Confirmed')` on the status | hidden totals and number, "Pending" (two healed past, two got through before) |
| profile | reload `/account`, `expect(getByLabel('Name')).toHaveValue('Ada King')` | the lost write |
| remove, upgrade | unchanged | — |

## What's left after tightening

- **2 got through:** the two swapped-row bugs. The order doesn't matter here; add them to `.e2e-mutate-ignore.json`.
- **1 healed past:** Neuromancer's price in the `remove` test. It was left unchanged on purpose, because that test is about removing a row.
- **1 flaky:** the hidden "Profile saved" message. In the first run the agent judged the save as done (the profile really was saved) and the test passed. In the confirm run the judgment failed. The drill reports it as flaky instead of picking a side.

## Agent behavior varies by app

On the bookshop, a dead header "Upgrade" button was **caught** in both drills: the agent failed the step instead of using Settings → "Switch to Pro".

On the spike's smaller app (`spike/`), the same kind of bug was **healed past 3 of 3 times**: the agent went to Settings and the test passed. That's why every miss gets a confirm run, and why results are measurements, not proofs.

## Process notes

- **The first full "before" drill (`e2e/.e2e-mutate-run1/`) is not the one reported.** A recorder bug lost a fast test's events: the catalog test ran in 95 ms and its events were still queued when e2e closed the page. That showed up as "no bug reached" the catalog test. The recorder now sends events at the end of each task, and the drill was rerun; the reported numbers come from that rerun.
- **The postflight warnings in both `drill.json` files are real detections.** They are files created in the repo while the drills ran (`src/relevance.ts`, `demo/README.md`, and `demo/video/make-video.mjs`, the first slideshow video builder, since replaced by `demo/video/film/`). The check compares `git status` lines, so it catches new files and changes to tracked files. Each drill also confirmed the suite's replay cache digest was unchanged.
- **The reports were re-rendered after the runs** with `tools/rerender.mjs`, once the suggestion text and wording improved. That script recomputes only the suggestions and stills from the stored verdicts; outcomes and numbers are untouched.
- **The classifier was improved after these runs**, when e2e-mutate was run on e2e's own testbed (`field/e2e-testbed/`). Every stored run of both drills was classified again with the final code: all 80 outcomes came out the same.
- **The swapped-rows bug was fixed after these runs too.** Before the fix, a re-render could swap a list back. Both demo swaps got through for a reason that doesn't depend on it: neither suite checks row order (no `nth`, `first()` or list form of a text match, and no `agent.assert` asks about order).
