#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { drill } from './drill.ts';
import { writeHtmlReport } from './report/html.ts';
import { renderTerminal } from './report/terminal.ts';
import { addStills } from './stills.ts';
import { BUG_TYPES, type BugType } from './types.ts';

const HELP = `Usage: e2e-mutate [files...] [options]

Plants realistic bugs in your running web app, one at a time, reruns the e2e
tests that touch each one, and reports which bugs your tests caught.

Your config needs one line: web({ initScripts: [...mutate()] }), with
mutate imported from 'e2e-mutate'.

Options:
  --config <path>        e2e config (default: discovered by e2e)
  --max-mutants <n>      most bugs to plant (default 30)
  --types <list>         bug types, comma-separated (default: all)
                         ${BUG_TYPES.join(', ')}
  --concurrency <n>      mutant runs at once (default 1; needs app.url port 0 for more)
  --budget-usd <n>       stop starting runs once e2e's estimated cost passes this
  --ignore <file>        bugs to skip, by title (default .e2e-mutate-ignore.json)
  --out <dir>            output dir (default .e2e-mutate)
  --cache-dir <dir>      your replay cache, only copied (default .e2e/cache)
  --no-confirm           don't rerun bugs that got through to confirm them
  --no-video             don't record videos
  --clean-env            run e2e with a minimal environment (use inside Claude Code)
  --cwd <dir>            the e2e project (default: the current directory)
  -h, --help             show this help
`;

function positive(name: string, value: string | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`);
  return n;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      'max-mutants': { type: 'string', default: '30' },
      types: { type: 'string' },
      concurrency: { type: 'string', default: '1' },
      'budget-usd': { type: 'string' },
      ignore: { type: 'string', default: '.e2e-mutate-ignore.json' },
      out: { type: 'string', default: '.e2e-mutate' },
      'cache-dir': { type: 'string', default: '.e2e/cache' },
      'no-confirm': { type: 'boolean', default: false },
      'no-video': { type: 'boolean', default: false },
      'clean-env': { type: 'boolean', default: false },
      cwd: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const types = values.types?.split(',').map((t) => t.trim()) as BugType[] | undefined;
  const unknown = types?.filter((t) => !(BUG_TYPES as readonly string[]).includes(t)) ?? [];
  if (unknown.length > 0) throw new Error(`Unknown bug type: ${unknown.join(', ')}`);
  const root = path.resolve(values.cwd ?? process.cwd());
  const result = await drill({
    project: { root, ...(values.config ? { config: values.config } : {}), cleanEnv: values['clean-env'] },
    files: positionals,
    out: values.out,
    userCacheDir: values['cache-dir'],
    maxMutants: Math.floor(positive('max-mutants', values['max-mutants'])),
    ...(types ? { types } : {}),
    concurrency: Math.floor(positive('concurrency', values.concurrency)),
    ignoreFile: values.ignore,
    ...(values['budget-usd'] !== undefined ? { budgetUsd: positive('budget-usd', values['budget-usd']) } : {}),
    confirm: !values['no-confirm'],
    video: !values['no-video'],
    log: (line) => process.stderr.write(`${line}\n`),
  });
  await addStills(result, path.join(root, values.out));
  await writeFile(path.join(root, values.out, 'drill.json'), JSON.stringify(result, null, 2));
  const html = await writeHtmlReport(result, path.join(root, values.out));
  process.stdout.write(`${renderTerminal(result, path.relative(process.cwd(), html))}\n`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`e2e-mutate: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  },
);
