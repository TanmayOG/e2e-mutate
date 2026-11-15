/**
 * Receives the mutants' "applied" beacons on 127.0.0.1 and appends each one,
 * stamped with the receive time, to a JSONL file. Answers CORS so a page on
 * another port can post. Spike unknown #5: does a page under e2e reach it?
 */

import { createServer } from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.COLLECTOR_PORT ?? 4399);
const OUT = path.resolve(process.env.COLLECTOR_OUT ?? 'runs/collector.jsonl');
mkdirSync(path.dirname(OUT), { recursive: true });

createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let body = '';
  for await (const chunk of req) body += chunk;
  appendFileSync(OUT, JSON.stringify({ receivedAt: Date.now(), url: req.url, body }) + '\n');
  res.writeHead(204).end();
}).listen(PORT, '127.0.0.1', () => console.log(`collector on http://127.0.0.1:${PORT} -> ${OUT}`));
