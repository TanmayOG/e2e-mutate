import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { SCRIPT_ENV } from './helper.ts';

/** Where and how the drill runs e2e. */
export interface ProjectContext {
  /** The e2e project root (where `e2e.config.ts` and `node_modules/.bin/e2e` are). */
  readonly root: string;
  /** `--config`, as the user gave it, when they gave one. */
  readonly config?: string;
  /** Run e2e with a minimal environment (see {@link childEnv}). */
  readonly cleanEnv: boolean;
}

/** The project's own e2e CLI. e2e-mutate never brings its own copy. */
export function e2eBin(root: string): string {
  const bin = path.join(root, 'node_modules', '.bin', 'e2e');
  if (!existsSync(bin)) throw new Error(`No e2e CLI at ${bin}. Run e2e-mutate from an e2e project with e2e installed.`);
  return bin;
}

const PASS_THROUGH = /^(?:E2E_|AI_GATEWAY_|OPENAI_|GOOGLE_|XAI_|GROQ_|MISTRAL_|OPENROUTER_|ANTHROPIC_API_KEY$|PLAYWRIGHT_|NODE_EXTRA_CA_CERTS$|HTTPS?_PROXY$|NO_PROXY$)/;

/**
 * The environment for an e2e child. By default it is the caller's. With
 * `cleanEnv`, it keeps only what a run needs: PATH, HOME, the user, shell,
 * temp dir and locale, plus model keys and E2E_ variables. That matters when
 * e2e-mutate runs inside a Claude Code session: the nested Claude Code agent
 * that `@e2e-dev/acp` starts must use its own login, not the host session's
 * variables. A clean run also turns e2e's telemetry off.
 */
export function childEnv(cleanEnv: boolean, extra: Record<string, string>): NodeJS.ProcessEnv {
  if (!cleanEnv) return { ...process.env, ...extra };
  const env: NodeJS.ProcessEnv = { TERM: 'dumb', E2E_TELEMETRY_DISABLED: '1' };
  for (const name of ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG']) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (PASS_THROUGH.test(name) && value !== undefined) env[name] = value;
  }
  return { ...env, ...extra };
}

/** Spawns `e2e <args>` in the project, writing its output to `logFile`. Resolves with the exit code. */
export async function e2e(
  project: ProjectContext,
  args: readonly string[],
  options: { readonly logFile?: string; readonly env?: Record<string, string>; readonly capture?: boolean } = {},
): Promise<{ readonly code: number; readonly stdout: string }> {
  const configArgs = project.config ? ['--config', project.config] : [];
  const child = spawn(e2eBin(project.root), [...args, ...configArgs], {
    cwd: project.root,
    env: childEnv(project.cleanEnv, options.env ?? {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  const log = options.logFile ? createWriteStream(options.logFile) : undefined;
  child.stdout.on('data', (chunk: Buffer) => {
    if (options.capture) stdout += chunk.toString('utf8');
    log?.write(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => log?.write(chunk));
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (exit) => resolve(exit ?? 1));
  });
  await new Promise<void>((resolve) => (log ? log.end(resolve) : resolve()));
  return { code, stdout };
}

/** One pair from `e2e list --reporter json`. */
export interface ListedPair {
  readonly id: string;
  readonly file: string;
  readonly title: string;
  readonly titlePath: readonly string[];
  readonly kind: 'test' | 'setup';
  readonly source?: { readonly file: string; readonly line: number };
  readonly serialId?: string;
  readonly target?: string;
  readonly disposition?: string;
}

/** Lists the tests e2e would run for these files, exactly as `e2e run` selects them. */
export async function listTests(project: ProjectContext, files: readonly string[]): Promise<readonly ListedPair[]> {
  const { code, stdout } = await e2e(project, ['list', ...files, '--reporter', 'json'], { capture: true });
  if (code !== 0) throw new Error(`e2e list failed with exit code ${code}`);
  return (JSON.parse(stdout) as { pairs: ListedPair[] }).pairs;
}

/** Options for one `e2e run` the drill starts. */
export interface RunOptions {
  /** `file:line` selections. */
  readonly files: readonly string[];
  /** Results directory for this run (e2e's `--output`), relative to the project root. */
  readonly output: string;
  /** Cache directory for this run; always a throwaway copy. */
  readonly cacheDir: string;
  /** Absolute path of the one script to inject, if any. */
  readonly script?: string;
  readonly workers: number;
  readonly video: boolean;
}

/** Runs e2e once with its own output and cache dir. Positionals go before the flags, since `--trace` and `--video` take a value. */
export async function runE2E(project: ProjectContext, options: RunOptions): Promise<number> {
  const args = [
    'run',
    ...options.files,
    '--output',
    options.output,
    '--cache-dir',
    options.cacheDir,
    '--retries',
    '0',
    '--workers',
    String(options.workers),
    '--trace=on',
    `--video=${options.video ? 'on' : 'off'}`,
  ];
  const outputDir = path.join(project.root, options.output);
  await mkdir(path.dirname(outputDir), { recursive: true });
  const { code } = await e2e(project, args, {
    logFile: `${outputDir}.log`,
    env: options.script ? { [SCRIPT_ENV]: options.script } : {},
  });
  return code;
}

/** Replaces `to` with a copy of `from` (an empty dir when `from` doesn't exist). */
export async function freshCopy(from: string, to: string): Promise<void> {
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  if (existsSync(from)) await cp(from, to, { recursive: true });
}
