import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { claudeCode } from '@e2e-dev/acp';
import { mutate } from 'e2e-mutate';

/** The demo suite as a team would write it at first: a mix of strong and weak checks. */
export default {
  tests: 'tests-before/**/*.e2e.ts',
  targets: [
    {
      // The one line e2e-mutate needs. In a normal run it adds nothing.
      engine: web({ initScripts: [...mutate()] }),
      app: {
        url: 'http://127.0.0.1:0',
        command: {
          executable: 'node',
          args: ['../shop-app/server.mjs'],
          env: { PORT: '{port}' },
        },
      },
    },
  ],
  agents: { default: { executor: claudeCode({ model: 'sonnet' }) } },
} satisfies E2EConfig;
