# e2e-mutate on e2e's own testbed

I wrote the demo suite in `demo/`. To see how e2e-mutate does on tests I didn't write, I ran it on **`apps/testbed`** from e2e's own repo: a local app plus the 587 tests the e2e team uses to test the framework itself.

- **Source:** e2e main at [`cfa2aa0e`](https://github.com/e2e-inc/e2e/commit/cfa2aa0ecc77751fe56e4fbb8c938677cfa7ec01) (2026-11-15), built locally.
- **Change to the testbed:** one config line. [`e2e.mutate.config.ts`](e2e.mutate.config.ts) is the testbed's `e2e.config.ts` with `engine: web({ initScripts: [...mutate()] })`. No test or app file was changed.
- **Options:** `--config e2e.mutate.config.ts --clean-env --max-mutants 40 --concurrency 1`, from `apps/testbed` (see "Reproduce" below).
- **Evidence:** [`terminal.txt`](terminal.txt) (the drill's output) and [`drill.json`](drill.json) (every bug, outcome and test verdict). The first run, before the fixes below, is in `run1.terminal.txt` and `run1.drill.json`.

## Result

| | |
|---|---|
| Tests | 587. 6 were left out (see below), so 581 were drilled. |
| Possible bugs found | 95. 40 were planted, rotating across bug types. |
| **Caught** | **32 of 40 (80%)** |
| Got through | 8, each confirmed by a second run |
| Healed past | 0. The testbed has no agent steps, so nothing can heal. |
| Not scored | 0 |
| Drill time | 22m 43s, of which 5m 11s was the baseline |
| Model cost | $0 (no agent steps) |

By bug type, caught out of planted:

| Type | Caught |
|---|---|
| dead control | 14/14 |
| missing element | 10/14 |
| swapped rows | 4/8 |
| server error | 3/3 |
| lost write | 1/1 |

22 of the 32 catches came from a failing e2e step, such as `expect.toHaveText` or `browser.waitForURL`. The other 10 came from outside any step: a plain `expect` on a value (`expected "Was not clicked" to be "Clicked"`), or the test's own code throwing because a request it waited for never came. One bug was caught by setup tests: with the `/dashboard` greeting missing, both `authenticate as admin` setups failed, so the three tests that need them never ran (reported as not reached).

## The 8 that got through, read against the tests

| Bug | Tests | Why the tests passed |
|---|---|---|
| The first two rows swap on `/scroll`, twice ("Item 1"/"Item 2", "Row 1"/"Row 2") | 4 scroll tests (`scroll.e2e.ts`) | They pick rows by name ("Item 40", "Row 100") and check scroll positions. Row order isn't what they test. |
| The first two rows swap ("hi1"/"hi2") | the sticky and absolute header click tests (`click.e2e.ts:275`, `:296`) | They tap `#target` and check `window.__clicked`. |
| The first two city suggestions swap ("Warsaw"/"Wroclaw") | `types with key events where fill leaves the app cold` (`forms.e2e.ts:50`) | It checks the list after typing "Wa", when only "Warsaw" is left. |
| "Hello" and `He"llo` are hidden | the `getByTestId` selector tests (`selectors-get-by.e2e.ts`) | They check the text, and a hidden element's text still reads: "A node that is not rendered itself, such as a `display: none` one, reads its DOM text" (`docs/reference/screen.mdx`). |
| The "deep button" and "first legend element" are hidden | `should support disabled fieldset` (`selectors-role.e2e.ts:153`) | It checks `toBeEnabled`/`toBeDisabled`, and a hidden button is still enabled or disabled. |

None of these points at a weak test. These are framework tests, each checking one behavior, and what they don't check is outside their job. On a suite like this the useful outputs are the catch rate and the ignore list: all 8 belong in `.e2e-mutate-ignore.json`. In an app's own suite, the hidden-element case is a real gap; the demo found one, where an order total was `display: none` and `toHaveText` still passed.

## Not planted

The tests clicked 36 controls that a "does nothing" bug can't change: no click listener on them or above them, no `onclick`, and no default action. They are the 30 numbered buttons of the permission-popup test, "Hello iframe", "Hello nested iframe", "Close A" and "Story", which have no handler at all, plus "Hold me" (`pointerdown`/`pointerup`) and "Tap me twice" (`dblclick`). The bug blocks the click, so it would change nothing a test could see (an "equivalent mutant"). The drill lists them instead of planting bugs on them.

## Left out of the drill

- **3 serial-group steps** (`step 1: name the workspace`, `step 2: pick a plan`, `step 3: confirm with state from earlier members`). Serial groups are not supported yet.
- **`should work with equal requests`** and **`should be able to fetch dataURL and not fire dataURL requests`** (`route.e2e.ts`). Both intercept or count every request the page makes, and the recorder's posts to its local collector are requests too. They failed the baseline record run, so the drill left them out instead of misreading them.
- **`skips itself when the playground has no marketplace`**. It skipped itself.

The 19 tests that share 4 source lines (made in loops, such as the six `should click the aligned 1x1 div` tests) run as 4 units, because e2e selects tests by `file:line`. That is why the drill's header counts 566.

## What the testbed found in e2e-mutate

The first full run ([`run1.terminal.txt`](run1.terminal.txt)) reported **24 of 35 (69%)**, with 4 inconclusive and 1 error. Reading every result against the testbed's code showed that all 5 unscored results were wrong, and so were 3 of the misses. Each problem below is now fixed, with a unit test that fails without the fix:

1. **A step that wraps its trigger.** In `waitForDownload(() => link.tap())`, the wait is numbered before the tap it waits on, so its failure looked like it came before the bug. The classifier now compares times: the bug's `appLog` line against the failing step's start and duration.
2. **A test that catches an expected failure and goes on.** `should wait for hidden iframe to become visible` catches a tap it expects to fail, then fails on `expect(clicked).toBe(true)`. The classifier took the first failed step. It now takes the step that carries the attempt's own error, or none when the test failed outside any step.
3. **A setup test that fails because of the bug.** Its dependents were skipped, and the bug showed as an error. A failed setup is now a catch, and a skipped test counts as not reached.
4. **Catches outside any step were labeled "timed out".** None of them was a timeout. The report now shows the error.
5. **Equivalent mutants.** "Hello iframe", "Hello nested iframe" and the "0" button have no click handler. Making them "do nothing" changes nothing, so their three "got through" results were false. The recorder now notes which controls have click listeners. It ignores Playwright's own hit-target listeners, which `InjectedScript` adds on `window` whenever e2e evaluates in the page.
6. **Tests that share a line** were scored by their first result only. They are now one unit with the strongest verdict. In the final run one bug reached such a unit ("Click target" does nothing; `click.e2e.ts:372`), and it was caught.
7. **Reports on a large suite.**
   - The per-test table listed all 581 tests; it now lists only those a bug reached.
   - The swapped-rows suggestion used `getByRole('row').nth(1)` even for `<ul>`/`<ol>` lists. It now uses `listitem` there, with the ordered list form of `toContainText`.
   - A dead control that a test clicked was described as one "no test needs".

An independent code review afterwards found more, all now fixed with tests as well:
- A test skipped because its setup failed has no attempt in `report.json`, and it was scored as an error.
- A swapped list could swap back when the page re-rendered it.
- A test's last tap could go unrecorded when the page closed right after it.
- Screen bugs checked the page only once, at load, so a single-page app that navigates without reloading never got them.

The numbers above come from a run with every fix in place. The demo's two drills were also classified again from their stored runs with the final code: all 80 outcomes came out the same.

The demo's recorded drills don't depend on any of these fixes. Each of their catches names the step that carries the attempt's error, every control their tests click has a click listener or an `href`, and no demo test checks row order.

## Reproduce

This is how the run above was made. It uses e2e-mutate from a local build, since it isn't published.

```sh
git clone https://github.com/e2e-inc/e2e && cd e2e && git checkout cfa2aa0e
pnpm install && pnpm build
cd apps/testbed
cp /path/to/e2e-mutate/field/e2e-testbed/e2e.mutate.config.ts .
# In that file, point the import at the build: from '/path/to/e2e-mutate/dist/index.js'
node /path/to/e2e-mutate/dist/cli.js --config e2e.mutate.config.ts --max-mutants 40 --concurrency 1
```

Add `--clean-env` when you start it from inside a Claude Code session.
