import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { DrillResult } from './drill.ts';
import { relevantMisses } from './relevance.ts';
import type { TestVerdict } from './types.ts';

/** True when an `ffmpeg` binary runs. */
function hasFfmpeg(): boolean {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
}

/**
 * For each missed bug whose leading tests saved no screenshot (a test with no
 * `agent.assert` saves none), takes the last frame of that test's run video as
 * a still, so the report can show the screen the test ended on with the bug in
 * place. Needs `ffmpeg`; without it the card links the video instead. Returns
 * how many stills it wrote. Paths are relative to `outDir`.
 */
export async function addStills(result: DrillResult, outDir: string): Promise<number> {
  const missing = result.mutants.filter(
    (v) => (v.outcome === 'got-through' || v.outcome === 'healed-past') && !relevantMisses(v.tests).some((t) => t.screenshot),
  );
  if (missing.length === 0 || !hasFfmpeg()) return 0;
  await mkdir(path.join(outDir, 'stills'), { recursive: true });
  let written = 0;
  for (const verdict of missing) {
    const lead = relevantMisses(verdict.tests).find((t) => t.video) as (TestVerdict & { screenshot?: string }) | undefined;
    if (!lead?.video) continue;
    const still = path.join('stills', `${verdict.mutant.id}.png`);
    const run = spawnSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-sseof', '-0.3', '-i', path.join(outDir, lead.video), '-frames:v', '1', '-update', '1', path.join(outDir, still)],
      { stdio: 'ignore' },
    );
    if (run.status === 0 && existsSync(path.join(outDir, still))) {
      (lead as { screenshot?: string }).screenshot = still;
      written += 1;
    }
  }
  return written;
}
