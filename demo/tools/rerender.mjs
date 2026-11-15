// Re-renders a drill's report.html from its drill.json with the current build.
// Outcomes, runs and numbers are untouched; only the suggestion text, which is
// derived from each verdict, is recomputed, and missing stills are added.
//   node demo/tools/rerender.mjs demo/e2e/.e2e-mutate
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
const out = path.resolve(process.argv[2]);
const { writeHtmlReport } = await import(path.join(dist, 'report/html.js'));
const { suggest } = await import(path.join(dist, 'suggest.js'));
const { addStills } = await import(path.join(dist, 'stills.js'));
const file = path.join(out, 'drill.json');
const result = JSON.parse(await readFile(file, 'utf8'));
for (const verdict of result.mutants) verdict.suggestions = suggest(verdict.mutant, verdict.outcome, verdict.tests);
await addStills(result, out);
await writeFile(file, JSON.stringify(result, null, 2));
console.log(await writeHtmlReport(result, out));
