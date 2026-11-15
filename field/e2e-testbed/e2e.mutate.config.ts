// e2e.config.ts as it is on e2e main (cfa2aa0e), plus the one line e2e-mutate
// needs: `initScripts: [...mutate()]`, which adds nothing in a normal run.
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { decisionFilter } from '@e2e-dev/decision';
import { gateway } from 'ai';
import { mutate } from 'e2e-mutate';

export default {
  projectId: 'dev.e2e.testbed',
  targets: [
    {
      name: 'web',
      engine: web({ initScripts: [...mutate()] }),
      app: {
        url: 'http://127.0.0.1:4271',
        command: { executable: 'node', args: ['app/server.mjs'], env: { PORT: '4271' } },
      },
    },
  ],
  filters: [decisionFilter({ model: gateway.decisionModel('typesafe-ai/jev') })],
  credentials: {
    admin: {
      username: 'admin',
      password: 'admin-pass',
    },
  },
} satisfies E2EConfig;
