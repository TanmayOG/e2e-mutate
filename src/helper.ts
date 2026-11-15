/** The environment variable e2e-mutate sets to the script one run injects. */
export const SCRIPT_ENV = 'E2E_MUTATE_SCRIPT';

/**
 * The init scripts to spread into `web({ initScripts })`. In a normal run it
 * returns `[]`. When e2e-mutate starts a run it sets {@link SCRIPT_ENV} to the
 * absolute path of one script (the baseline recorder, or one mutant), and this
 * returns it as a `{ path }` entry. It never returns a function: a function
 * init script can close over nothing from the test process. Every e2e worker
 * imports the config again, so the variable is read fresh in each run.
 *
 * ```ts
 * engine: web({ initScripts: [...mutate()] })
 * ```
 */
export function mutate(): Array<{ readonly path: string }> {
  const script = process.env[SCRIPT_ENV];
  return script ? [{ path: script }] : [];
}
