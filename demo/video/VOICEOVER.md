# Narration

The demo film (`../e2e-mutate-demo.mp4`) is narrated in one take. The audio is `voice/narration.m4a`, 96 s, cut from the original recording at 0:14–1:50.

## How the film stays in sync

- `voice/narration.json` holds a timestamp for every spoken word. It comes from [Whisper](https://github.com/openai/whisper), run locally:
  ```sh
  whisper narration.wav --model base.en --word_timestamps True --output_format json
  ```
- `film/build.mjs` finds phrases in those words (`"taps it again"`, `"a wrong price"`, …) and turns them into cue times. Every scene and animation in `film/film.html` starts on its cue.
- The browser clip plays at a true 4×. Its start is set so the agent's second tap, which comes from the run's own `report.json`, lands on "taps it again".
- The film is a 0.6 s lead-in, the 96 s narration, and a 2.6 s end card: 1:39. A silence check on the encoded film confirms the speech starts exactly 0.600 s after it does in the narration.

## Script

| # | On screen | Spoken |
|---|---|---|
| 01 | Title | Would your end-to-end tests catch a bug? I built e2e-mutate to find out. |
| 02 | The problem: tests heal themselves | e2e tests heal themselves. When the app changes, the agent finds another way to the goal. That keeps tests green through UI changes. But does it also keep them green through real bugs? Nothing measures that today. |
| 03 | `npx e2e run`: 7 passed, 6 replayed | Here's a small bookshop with seven e2e tests. Some use strict checks, some use vague AI checks. They're all green, and every agent step replays from cache. |
| 04 | The drill | e2e-mutate plants forty realistic bugs into the running app, one at a time: a dead button, a save that stores nothing, a wrong price. Then it reruns only the tests that touch each bug. Twenty-seven of forty were caught. Six were healed past. |
| 05 | "The Cart link in the nav does nothing" | Here's one of them. The Cart link in the nav is broken. Watch the test, at four times speed. |
| 06 | Browser clip (4×) | Replay taps the link. Nothing happens. The agent taps it again, then opens the cart page directly. |
| 07 | What happened | And the test passes. Users can't reach their cart from the nav, but the suite is green. |
| 08 | The report | The report lists every bug that got through, with the screen the test saw, and a concrete check that would have caught it. |
| 09 | The hidden order total | It found a gap in a strict check too. The order total was hidden, and toHaveText still passed, because a test-id query also matches hidden elements. |
| 10 | The tightened tests | So I followed the report. Check that totals are visible. Check the order status. After saving, reload and check the value was stored. |
| 11 | The second drill | Then I ran the same forty bugs again. |
| 12 | 68% → 92% | Sixty-eight percent caught became ninety-two. Healed past went from six to one. And it's built only on e2e's public APIs, with no change to e2e itself. |

## Where each fact comes from

Every number is in [`../RESULTS.md`](../RESULTS.md):
- **7 tests, all green, 6 agent steps replayed:** the suite's own run log.
- **40 bugs, 27 caught, 6 healed past; 68% → 92% and 6 → 1 on the same 40 bugs:** the two drills' `drill.json`.
- **The dead-link clip:** e2e's recording and `report.json` for that run. The agent's note: "Link tap did not navigate, so I opened /cart directly".
- **The hidden order total passing `toHaveText`:** that run's trace, where the bug applied at step 5 and the check passed at step 7.

"Nothing measures that today" is about tests staying green **through healing**. e2e's `migrate-to-e2e` skill has a manual, one-bug defect check (#1167), but it runs with `--no-cache`, so it doesn't see healing. See the main README, "How it relates to e2e's defect check".
