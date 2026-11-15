import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Mutant } from './types.ts';

const IN_PAGE = fileURLToPath(new URL('../in-page/', import.meta.url));

/** Writes the baseline recorder, pointed at the collector, and returns its absolute path. */
export async function writeRecorderScript(dir: string, endpoint: string): Promise<string> {
  const source = await readFile(path.join(IN_PAGE, 'recorder.js'), 'utf8');
  const file = path.join(dir, 'recorder.js');
  await mkdir(dir, { recursive: true });
  await writeFile(file, source.replaceAll('__ENDPOINT__', JSON.stringify(endpoint)));
  return file;
}

/** The spec the page gets: everything the runtime needs, nothing the report keeps. */
export function pageSpec(mutant: Mutant): Record<string, unknown> {
  const { tests: _tests, title: _title, before: _before, after: _after, ...spec } = mutant;
  return spec;
}

/** Writes one mutant's init script (the runtime plus its spec) and returns its absolute path. */
export async function writeMutantScript(dir: string, mutant: Mutant): Promise<string> {
  const runtime = await readFile(path.join(IN_PAGE, 'apply.js'), 'utf8');
  const file = path.join(dir, `${mutant.id}.js`);
  await mkdir(dir, { recursive: true });
  await writeFile(file, `${runtime}\n__e2eMutateApply(${JSON.stringify(pageSpec(mutant))});\n`);
  return file;
}
