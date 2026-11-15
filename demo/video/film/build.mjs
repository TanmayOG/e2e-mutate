// Builds demo/e2e-mutate-demo.mp4: the animated demo film, synced to the
// narration in demo/video/voice/narration.m4a.
//
// 1. Reads the narration's word timestamps (voice/narration.json, from
//    `whisper narration.wav --model base.en --word_timestamps True`) and turns
//    phrases into cue times, so every animation lands on its words.
// 2. Prepares the real material: the suite's run log, both drills' outcomes,
//    the "before" report (rendered dark), the hidden-total still, and the
//    browser recording of the healed-past run (frames at a true 4x speed,
//    events timed from that run's report.json).
// 3. Renders film.html one frame at a time (30 fps, 1920x1080) and pipes the
//    frames, with the narration, into ffmpeg. Also writes .srt captions.
//
//   node demo/video/film/build.mjs
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const DEMO = path.resolve(HERE, '../..');
const E2E = path.join(DEMO, 'e2e');
const BUILD = path.join(HERE, '.build');
const VOICE = path.join(DEMO, 'video', 'voice');
const OUT = path.join(DEMO, 'e2e-mutate-demo.mp4');
const SRT = path.join(DEMO, 'e2e-mutate-demo.srt');
const FPS = 30;
const LEAD = 0.6; // seconds of picture before the narration starts
const TAIL = 2.6; // seconds of end card after the narration's last second
const { chromium } = createRequire(path.join(E2E, 'package.json'))('playwright-core');

const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stderr}`);
  return r;
}

// ---------- narration cues ----------
const narration = await json(path.join(VOICE, 'narration.json'));
const WORDS = narration.segments.flatMap((s) => s.words).map((w) => ({ ...w, key: w.word.toLowerCase().replace(/[^a-z0-9]/g, '') })).filter((w) => w.key);
const norm = (phrase) => phrase.toLowerCase().split(/\s+/).map((p) => p.replace(/[^a-z0-9]/g, '')).filter(Boolean);
/** Narration time (seconds) of the first word of `phrase`, at or after `after`. */
function find(phrase, after = 0) {
  const keys = norm(phrase);
  for (let i = 0; i < WORDS.length; i += 1) {
    if (WORDS[i].start < after) continue;
    if (keys.every((k, j) => WORDS[i + j]?.key === k)) return i;
  }
  throw new Error(`Phrase not found in the narration: "${phrase}"`);
}
const at = (phrase, after) => WORDS[find(phrase, after)].start;
const V = (n) => LEAD + n; // narration time -> film time

const audioSeconds = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(VOICE, 'narration.m4a')]).stdout.trim());
const lastWord = WORDS.at(-1).end;
const cues = {
  catch: V(at('catch a bug')), built: V(at('i built')), heal: V(at('e2e tests heal')),
  when: V(at('when the app')), another: V(at('finds another')), keeps: V(at('that keeps')),
  but: V(at('but does')), realBugs: V(at('real bugs')), nothing: V(at('nothing measures')),
  bookshop: V(at('heres a small')), seven: V(at('seven')), strict: V(at('strict checks')), vague: V(at('vague')),
  allGreen: V(at('all green')), replays: V(at('replays from')),
  plants: V(at('plants')), running: V(at('running app')), dead: V(at('a dead button')), save: V(at('a save that')),
  price: V(at('a wrong price')), reruns: V(at('then it reruns')), caught27: V(at('27')), six: V(at('six were healed')),
  hereOne: V(at('heres one')), cartLink: V(at('the cart link')), watch: V(at('watch the test')),
  agentTaps: V(at('taps it again')), passes: V(at('and the test passes')), users: V(at('users cant')), suite: V(at('but the suite')),
  report: V(at('the report lists')), everyBug: V(at('every bug')), screen: V(at('with the screen')), concrete: V(at('and a concrete')),
  gap: V(at('it found a gap')), orderTotal: V(at('the order total')), hidden: V(at('was hidden')), toHave: V(at('and to have')),
  stillPassed: V(at('still passed')), because: V(at('because')),
  followed: V(at('so i followed')), visible: V(at('check that totals')), status: V(at('check the order status')), reload: V(at('after saving')),
  again: V(at('then i ran')), p68: V(at('68')), became: V(at('became')), healed61: V(at('healed past', 80)),
  builtOnly: V(at('built only')), noChange: V(at('no change')),
};
cues.titleEnd = cues.heal - 0.3;
cues.outro = V(lastWord) + 0.35;
const duration = V(audioSeconds) + TAIL;

/** Display text whose words brighten in step with the narration between two phrases. */
function reveal(lines) {
  const out = [];
  lines.forEach((line, n) => {
    if (n > 0) out.push({ br: true });
    const from = find(line.from, line.after ?? 0);
    const end = typeof line.to === 'number' ? line.to : WORDS[find(line.to, WORDS[from].start)].start;
    const spoken = WORDS.filter((w, i) => i >= from && w.start < end);
    const shown = line.text.split(' ');
    shown.forEach((text, i) => out.push({ text: esc(text), t: V(spoken[Math.floor((i * spoken.length) / shown.length)].start) }));
  });
  return out;
}
const text = {
  s2: reveal([
    { text: 'e2e tests heal themselves.', from: 'e2e tests heal', to: 'when the app' },
    { text: 'when the app changes, the agent finds another way to the goal.', from: 'when the app', to: 'that keeps' },
    { text: 'that keeps tests green through ui changes.', from: 'that keeps', to: 'but does' },
    { text: 'but does it also keep them green through real bugs?', from: 'but does', to: 'nothing measures' },
  ]),
  s5: reveal([
    { text: "here's one of them.", from: 'heres one', to: 'the cart link' },
    { text: 'the “cart” link in the nav is broken.', from: 'the cart link', to: 'watch the test' },
  ]),
  s7: reveal([
    { text: "users can't reach their cart from the nav,", from: 'users cant', to: 'but the suite' },
    { text: 'but the suite is green.', from: 'but the suite', to: 'the report lists' },
  ]),
  s8: reveal([
    { text: 'the report lists every bug that got through,', from: 'the report lists', to: 'with the screen' },
    { text: 'the screen the test saw,', from: 'with the screen', to: 'and a concrete' },
    { text: 'and a check that would have caught it.', from: 'and a concrete', to: 'it found a gap' },
  ]),
  s9: reveal([
    { text: 'the order total was hidden,', from: 'the order total', to: 'and to have' },
    { text: 'and toHaveText still passed:', from: 'and to have', to: 'because' },
    { text: 'a test-id query also matches hidden elements.', from: 'because', to: 'so i followed' },
  ]),
  s10: reveal([{ text: 'so i followed the report.', from: 'so i followed', to: 'check that totals' }]),
};

// ---------- real material ----------
await rm(BUILD, { recursive: true, force: true });
await mkdir(path.join(BUILD, 'clip'), { recursive: true });

// the suite's own run log
const runLog = await readFile(path.join(E2E, '.run2.log'), 'utf8');
const testLines = [...runLog.matchAll(/✓ \|web\| tests-before\/\S+ > (.+?) (\d+(?:\.\d+)?m?s)\b/g)].map((m) => ({ title: m[1], time: m[2] }));
const cacheLine = /Cache\s+(.+)/.exec(runLog)?.[1]?.trim();
const testsLine = /Tests\s+(.+)/.exec(runLog)?.[1]?.trim();
if (testLines.length !== 7 || !cacheLine || !testsLine) throw new Error('Unexpected .run2.log shape');
const suite = [
  { html: '<span class="dim">$</span> npx e2e run', at: 'start' },
  ...testLines.map((l) => ({ html: `<span class="ok">✓</span> ${esc(l.title)} <span class="dim">${l.time}</span>`, at: 'seven' })),
  { html: ' ', at: 'green' },
  { html: `<span class="dim">tests</span>  <span class="ok">${esc(testsLine)}</span>`, at: 'green' },
  { html: `<span class="dim">cache</span>  ${esc(cacheLine)}`, at: 'cache' },
];

// both drills
const before = await json(path.join(E2E, '.e2e-mutate', 'drill.json'));
const after = await json(path.join(E2E, '.e2e-mutate-after', 'drill.json'));
const summary = (d) => ({
  outcomes: d.mutants.map((v) => v.outcome),
  caught: d.caught,
  scored: d.caught + d.missed,
  rate: Math.round(d.catchRate * 100),
  healed: d.mutants.filter((v) => v.outcome === 'healed-past').length,
  through: d.mutants.filter((v) => v.outcome === 'got-through').length,
});

// the healed-past clip: the dead "Cart" link run
const clipVerdict = before.mutants.find((v) => v.mutant.type === 'dead-control' && v.outcome === 'healed-past');
const clipTest = clipVerdict.tests.find((t) => t.outcome === 'healed-past');
const clipVideo = path.join(E2E, '.e2e-mutate', clipTest.video);
const runReport = await json(path.join(E2E, '.e2e-mutate', clipVerdict.runDir, 'report.json'));
const attempt = runReport.run.results.find((r) => r.attempts?.length).attempts.at(-1);
const t0 = Date.parse(attempt.startedAt);
const events = attempt.steps.flatMap((s) => (s.events ?? []).map((e) => ({ ...e, step: s.api, sec: (Date.parse(e.startedAt) - t0) / 1000 })));
const taps = events.filter((e) => e.kind === 'engine' && e.name === 'tap' && /Cart/.test(e.detail ?? ''));
const nav = events.find((e) => e.kind === 'engine' && e.name === 'navigate');
const modelStart = events.find((e) => e.kind === 'model' && e.step === 'agent.act');
const assertStep = attempt.steps.find((s) => s.api === 'agent.assert');
// The recording starts a little after the attempt: align on the navigation, the first big scene change.
const scenes = [...run('ffmpeg', ['-hide_banner', '-i', clipVideo, '-vf', "select='gt(scene,0.02)',showinfo", '-f', 'null', '-'], { encoding: 'utf8' }).stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
const sceneAtNav = scenes.find((s) => Math.abs(s - nav.sec) < 2);
if (sceneAtNav === undefined) throw new Error('Could not align the clip to its navigation');
const offset = nav.sec - sceneAtNav;
const clipDuration = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', clipVideo]).stdout.trim());
const SPEED = 4;
const clipEvents = {
  replayTap: taps[0].sec - offset,
  handOff: modelStart.sec - offset,
  agentTap: taps[1].sec - offset,
  navigate: nav.sec - offset,
  assert: (Date.parse(assertStep.startedAt) - t0) / 1000 - offset,
};
run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', clipVideo, '-vf', `setpts=PTS/${SPEED},fps=${FPS}`, '-q:v', '3', path.join(BUILD, 'clip', 'f%04d.jpg')]);
const clipFrames = (await readdir(path.join(BUILD, 'clip'))).filter((f) => f.endsWith('.jpg')).sort().map((f) => `.build/clip/${f}`);
// Start the clip so the agent's second tap lands on "taps it again"; the whole clip plays at a true 4x.
const clipStart = cues.agentTaps - clipEvents.agentTap / SPEED;
await cp(path.join(BUILD, 'clip', 'f0001.jpg'), path.join(BUILD, 'catalog.jpg'));

// the hidden-total still
const orderVerdict = before.mutants.find((v) => v.mutant.id.includes('missing-element-order-total'));
const orderStill = path.join(E2E, '.e2e-mutate', orderVerdict.tests.find((t) => t.screenshot).screenshot);
await cp(orderStill, path.join(BUILD, 'order.png'));

// the "before" report, rendered dark, with the boxes the film highlights
const browser = await chromium.launch();
const shotPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
await shotPage.goto(pathToFileURL(path.join(E2E, '.e2e-mutate', 'report.html')).href);
const boxes = await shotPage.evaluate(() => {
  const card = document.querySelector('article.card');
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y + window.scrollY, w: b.width, h: b.height }; };
  return { width: document.documentElement.clientWidth, card: r(card), shot: r(card.querySelector('.shot img')), fix: r(card.querySelector('.fix')) };
});
await shotPage.screenshot({ path: path.join(BUILD, 'report.jpg'), fullPage: true, type: 'jpeg', quality: 92 });
await shotPage.close();

const data = {
  duration,
  cues,
  chapters: [
    { name: 'problem', at: 0 },
    { name: 'demo', at: cues.bookshop - 0.25 },
    { name: 'drill', at: cues.plants - 0.6 },
    { name: 'healed past', at: cues.hereOne - 0.3 },
    { name: 'report', at: cues.report - 0.3 },
    { name: 'fix', at: cues.followed - 0.3 },
    { name: 'result', at: cues.p68 - 0.3 },
  ],
  text,
  suite,
  before: summary(before),
  after: summary(after),
  clip: {
    start: clipStart, speed: SPEED, duration: clipDuration, events: clipEvents, frames: clipFrames, link: { x: 200, y: 20, w: 62, h: 22 },
    stat: `that step took ${(clipTest.healed[0].durationMs / 1000).toFixed(1)}s instead of ${(clipTest.healed[0].baselineMs / 1000).toFixed(2)}s replayed`,
  },
  report: boxes,
  order: { box: { x: 44, y: 232, w: 210, h: 30 } },
  assets: { catalog: '.build/catalog.jpg', report: '.build/report.jpg', order: '.build/order.png' },
  code: {
    s9: [esc("await expect(screen.getByTestId('order-total'))"), esc("  .toHaveText('$12.50');")],
    s10: [
      { text: '<span style="color:#686868">// tests-after/checkout.e2e.ts</span>' },
      { text: esc("await agent.act('place the order with the saved address');") },
      { text: esc("+ await expect(screen.getByTestId('checkout-total')).toBeVisible();"), add: true, at: 'visible' },
      { text: esc("+ await expect(screen.getByTestId('order-total')).toBeVisible();"), add: true, at: 'visible', offset: 0.3 },
      { text: esc("+ await expect(screen.getByRole('status')).toHaveText('Confirmed');"), add: true, at: 'status' },
      { text: '<span style="color:#686868">// tests-after/profile.e2e.ts</span>' },
      { text: esc("await agent.assert('the profile was saved');") },
      { text: esc("+ await app.open('/account');"), add: true, at: 'reload' },
      { text: esc("+ await expect(screen.getByLabel('Name')).toHaveValue('Ada King');"), add: true, at: 'reload', offset: 0.35 },
    ],
  },
};
await writeFile(path.join(BUILD, 'data.js'), `window.FILM = ${JSON.stringify(data)};\n`);

// ---------- captions ----------
const LINES = [
  ['would', 'Would your end-to-end tests catch a bug? I built e2e-mutate to find out.'],
  ['e2e tests heal', 'e2e tests heal themselves. When the app changes, the agent finds another way to the goal. That keeps tests green through UI changes. But does it also keep them green through real bugs? Nothing measures that today.'],
  ['heres a small', "Here's a small bookshop with seven e2e tests. Some use strict checks, some use vague AI checks. They're all green, and every agent step replays from cache."],
  ['e2e mutate plants', 'e2e-mutate plants forty realistic bugs into the running app, one at a time: a dead button, a save that stores nothing, a wrong price. Then it reruns only the tests that touch each bug. Twenty-seven of forty were caught. Six were healed past.'],
  ['heres one', "Here's one of them. The Cart link in the nav is broken. Watch the test, at four times speed."],
  ['replay taps', 'Replay taps the link. Nothing happens. The agent taps it again, then opens the cart page directly.'],
  ['and the test passes', "And the test passes. Users can't reach their cart from the nav, but the suite is green."],
  ['the report lists', 'The report lists every bug that got through, with the screen the test saw, and a concrete check that would have caught it.'],
  ['it found a gap', 'It found a gap in a strict check too. The order total was hidden, and toHaveText still passed, because a test-id query also matches hidden elements.'],
  ['so i followed', 'So I followed the report. Check that totals are visible. Check the order status. After saving, reload and check the value was stored.'],
  ['then i ran', 'Then I ran the same forty bugs again.'],
  ['68', "Sixty-eight percent caught became ninety-two. Healed past went from six to one. And it's built only on e2e's public APIs, with no change to e2e itself."],
];
const stamp = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const starts = LINES.map(([phrase]) => find(phrase));
const srt = LINES.map(([, line], i) => {
  const a = V(WORDS[starts[i]].start);
  const b = V(i + 1 < LINES.length ? WORDS[starts[i + 1] - 1].end : lastWord);
  return `${i + 1}\n${stamp(a)} --> ${stamp(b + 0.2)}\n${line}\n`;
}).join('\n');
await writeFile(SRT, srt);

// ---------- render ----------
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));
await page.goto(pathToFileURL(path.join(HERE, 'film.html')).href);
await page.evaluate(() => window.ready);

// --preview t1,t2,…: render those film times to .build/preview/*.png and stop.
const previewAt = process.argv.indexOf('--preview');
if (previewAt !== -1) {
  await mkdir(path.join(BUILD, 'preview'), { recursive: true });
  for (const t of process.argv[previewAt + 1].split(',').map(Number)) {
    await page.evaluate((x) => window.seek(x), t);
    await page.screenshot({ path: path.join(BUILD, 'preview', `t${t.toFixed(2).padStart(6, '0')}.png`) });
  }
  await browser.close();
  if (pageErrors.length > 0) throw new Error(`Page errors: ${pageErrors.join(' | ')}`);
  console.log(JSON.stringify({ preview: path.join(BUILD, 'preview'), clipStart, clipEvents, cues }, null, 1));
  process.exit(0);
}
if (pageErrors.length > 0) throw new Error(`Page errors: ${pageErrors.join(' | ')}`);
const frames = Math.ceil(duration * FPS);
const ffmpeg = spawn('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-i', path.join(VOICE, 'narration.m4a'),
  '-filter_complex', `[1:a]adelay=${Math.round(LEAD * 1000)}|${Math.round(LEAD * 1000)},loudnorm=I=-16:TP=-1.5:LRA=11,apad[a]`,
  '-map', '0:v', '-map', '[a]', '-t', duration.toFixed(3),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', OUT,
], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((resolve, reject) => ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
const started = Date.now();
for (let i = 0; i < frames; i += 1) {
  await page.evaluate((t) => window.seek(t), i / FPS);
  const frame = await page.screenshot({ type: 'jpeg', quality: 93 });
  if (!ffmpeg.stdin.write(frame)) await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
  if (i % 300 === 0) process.stderr.write(`frame ${i}/${frames} (${((Date.now() - started) / 1000).toFixed(0)}s)\n`);
}
ffmpeg.stdin.end();
await done;
await browser.close();
console.log(JSON.stringify({ out: OUT, srt: SRT, duration: Number(duration.toFixed(2)), frames, clipStart: Number(clipStart.toFixed(2)), clipEvents, cues: Object.fromEntries(Object.entries(cues).map(([k, v]) => [k, Number(v.toFixed(2))])) }, null, 1));
