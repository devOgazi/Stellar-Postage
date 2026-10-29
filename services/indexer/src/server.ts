import http from 'node:http';
import type { SorobanEventPoller } from './poller.js';

export function createHealthServer(
  poller: SorobanEventPoller,
  port: number = 4001
): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz' || req.url === '/health') {
      const health = poller.getHealth();
      const statusCode = health.status === 'ok' ? 200 : 503;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  return server;
}
