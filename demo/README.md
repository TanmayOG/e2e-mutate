# e2e-mutate demo

A small bookshop, a 7-test e2e suite written the way teams often start, a drill of that suite, the same suite tightened by following the drill's report, and a second drill.

| Path | What |
|---|---|
| `shop-app/server.mjs` | The bookshop: catalog, cart, checkout, order page, account, settings, and a JSON API. It is client-rendered, keeps state per session cookie, and has **no planted bugs**. There are two ways to upgrade the plan (the header button, and Settings). |
| `e2e/e2e.config.ts` | The suite's config. The one line e2e-mutate needs is `web({ initScripts: [...mutate()] })`. The app runs on port `0`, so drills can run several bugs at once. |
| `e2e/tests-before/` | The first version of the suite: some exact checks, some vague `agent.assert`s, one loose goal. |
| `e2e/tests-after/` | The same suite after following the first drill's report. Five tests were tightened; `remove` and `upgrade` are unchanged. Each change has a comment saying which bug it answers. |
| `e2e/e2e.after.config.ts` | Points the config at `tests-after/`. |
| `e2e/clean-env.sh` | Runs a command with a minimal environment (see below). |
| `tools/rerender.mjs` | Rebuilds a drill's `report.html` from its `drill.json` without rerunning anything. |
| `video/film/` | The animated demo film: `film.html` (every scene, a pure function of time, styled after e2e.com with e2e's open-licensed fonts) and `build.mjs`. The builder times every animation to the narration's words, renders 30 fps frames, and mixes in the voice. It writes `e2e-mutate-demo.mp4` and `e2e-mutate-demo.srt`. |
| `video/voice/` | The narration: `narration.m4a` (cut from the source recording at 0:14–1:50) and `narration.json` (word timestamps from `whisper --model base.en --word_timestamps True`). |
| `video/VOICEOVER.md` | The script the narration was recorded from. |

## Run it

You need Node 24.8+ (or 22.22.3+) and a model for the agent steps. The config uses Claude Code through `@e2e-dev/acp` (`claudeCode({ model: 'sonnet' })`), so `claude auth login` once is enough; any `executor` or `model` e2e supports works.

```sh
npm install && npm run build          # in the repo root: builds e2e-mutate
cd demo/e2e && npm install

./clean-env.sh npx e2e run            # the suite is green (records agent steps the first time)
./clean-env.sh npx e2e run            # and replays them

npx e2e-mutate --clean-env --max-mutants 40 --concurrency 3
npx e2e-mutate --clean-env --max-mutants 40 --concurrency 3 --config e2e.after.config.ts --out .e2e-mutate-after
open .e2e-mutate/report.html .e2e-mutate-after/report.html

cd .. && node video/film/build.mjs     # the film; needs ffmpeg
node video/film/build.mjs --preview 5,47.6,55.3   # or just a few frames, to .build/preview/
```

`--clean-env` (and `clean-env.sh`) matter only when you start these from inside a Claude Code session. The nested Claude Code agent that `@e2e-dev/acp` starts would otherwise pick up the host session's variables instead of its own login.

## Results

See [RESULTS.md](RESULTS.md), which has the numbers from the recorded runs and what each tightened test answers.
