import type { E2EConfig } from 'e2e';
import base from './e2e.config.ts';

/** The same suite after tightening the checks the first drill's report flagged. */
export default { ...base, tests: 'tests-after/**/*.e2e.ts' } satisfies E2EConfig;
