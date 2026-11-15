import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { claudeCode } from '@e2e-dev/acp';

/**
 * The spike's stand-in for `mutate()`: when e2e-mutate starts a
 * run it names one script by absolute path, and every page gets it as an init
 * script. A normal run injects nothing.
 */
const injected = process.env.E2E_MUTATE_SCRIPT;

export default {
  targets: [
    {
      engine: web(injected ? { initScripts: [{ path: injected }] } : {}),
      app: {
        url: 'http://127.0.0.1:4310',
        command: {
          executable: 'node',
          args: ['app/server.mjs'],
          env: { PORT: '4310' },
          log: 'runs/app.log',
        },
      },
    },
  ],
  agents: { default: { executor: claudeCode({ model: 'sonnet' }) } },
} satisfies E2EConfig;
