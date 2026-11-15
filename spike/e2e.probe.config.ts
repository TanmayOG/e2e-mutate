import type { E2EConfig } from 'e2e';
import base from './e2e.config.ts';

export default { ...base, tests: 'probe/**/*.e2e.ts' } satisfies E2EConfig;
