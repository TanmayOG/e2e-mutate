import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RecorderEvent } from './types.ts';

/** A local HTTP endpoint the baseline recorder posts its events to. */
export interface Collector {
  readonly endpoint: string;
  readonly events: RecorderEvent[];
  close(): Promise<void>;
}

/**
 * Starts the collector on 127.0.0.1 with a free port. It answers CORS so a
 * page on another port can post, accepts `sendBeacon` bodies (text/plain), and
 * keeps every event in memory. It never listens on another interface.
 */
export async function startCollector(): Promise<Collector> {
  const events: RecorderEvent[] = [];
  const server: Server = createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const parsed: unknown = JSON.parse(body);
      for (const event of Array.isArray(parsed) ? parsed : [parsed]) {
        if (event && typeof event === 'object' && typeof (event as { kind?: unknown }).kind === 'string') {
          events.push(event as RecorderEvent);
        }
      }
    } catch {
      // A malformed beacon is dropped; the recorder only sends JSON.
    }
    res.writeHead(204).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}/events`,
    events,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
