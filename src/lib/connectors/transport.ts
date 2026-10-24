import 'server-only';
import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { assertSafePublicHttpsUrl, isSafePublicHost } from '../ai/tools/ssrf';
import { ConnectorError, type WebsiteConnectorConfig } from './contracts';

export interface ConnectorDependencies {
  fetch?: typeof fetch;
  lookup?: (hostname: string, options: { all: true }) => Promise<{ address: string; family: number }[]>;
  now?: () => number;
}
export function signature(secret: string, timestamp: string, method: string, endpoint: string, rawBody: string): string {
  const u = new URL(endpoint);
  return createHmac('sha256', secret).update(`${timestamp}.${method}.${u.pathname}${u.search}.${rawBody}`).digest('hex');
}
/** Pin the validated IPv4 address while retaining the original TLS server name and Host header. */
export function pinnedHttpsJson(endpoint: URL, address: string, method: 'GET' | 'POST', headers: Record<string, string>, raw: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(endpoint, { method, headers, servername: endpoint.hostname, family: 4,
      lookup: (_hostname, _options, callback) => callback(null, address, 4),
    }, response => {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume(); reject(new ConnectorError('transport', `Connector returned HTTP ${response.statusCode ?? 0}.`)); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2000000) { response.destroy(); reject(new ConnectorError('invalid_response', 'Response exceeds limit.')); }
        else chunks.push(chunk);
      });
      response.on('error', () => reject(new ConnectorError('transport', 'Connector response failed.')));
      response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new ConnectorError('invalid_response', 'Invalid JSON response.')); } });
    });
    // Absolute deadline includes connection, TLS, and response streaming.
    const deadline = setTimeout(() => req.destroy(new Error('Timeout')), 25000);
    req.on('close', () => clearTimeout(deadline));
    req.on('error', () => reject(new ConnectorError('transport', 'Connector request failed.')));
    req.end(method === 'POST' ? raw : undefined);
  });
}
/** Reuses the shared SSRF assertion and roundup wire signature; credentials never leave this server module. */
export function connectorTransport(config: WebsiteConnectorConfig, dependencies: ConnectorDependencies = {}) {
  return async (method: 'GET' | 'POST', query: Record<string, string>, credential: string, body?: unknown): Promise<unknown> => {
    if (!credential?.trim() || credential.length > 8192) throw new ConnectorError('forbidden', 'A signing credential is required.');
    const path = config.adapter === 'playbound-roundup-v0' ? '/api/integrations/nucleas/roundup' : config.endpointPath;
    const endpoint = assertSafePublicHttpsUrl(config.origin + path);
    if (endpoint.origin !== config.origin || endpoint.pathname !== path) throw new ConnectorError('unsafe', 'Endpoint does not match allowed origin and path.');
    for (const [k, v] of Object.entries(query)) endpoint.searchParams.set(k, v);
    const raw = body === undefined ? '' : JSON.stringify(body);
    if (Buffer.byteLength(raw) > 200000) throw new ConnectorError('unsafe', 'Request exceeds size limit.');
    try {
      const addresses = dependencies.lookup ? await dependencies.lookup(endpoint.hostname, { all: true }) : await lookup(endpoint.hostname, { all: true });
      if (!addresses.length || addresses.some(a => isIP(a.address) !== 4 || !isSafePublicHost(a.address)))
        throw new ConnectorError('unsafe', 'Host must resolve only to public IPv4 addresses.');
      const timestamp = String(Math.floor((dependencies.now ?? Date.now)() / 1000));
      const headers = { accept: 'application/json', 'content-type': 'application/json', 'x-nucleas-timestamp': timestamp,
        'x-nucleas-signature': signature(credential, timestamp, method, endpoint.href, raw) };
      if (!dependencies.fetch) return await pinnedHttpsJson(endpoint, addresses[0].address, method, headers, raw);
      const response = await dependencies.fetch(endpoint.href, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(25000),
        headers, ...(method === 'POST' ? { body: raw } : {}) });
      if (response.redirected || (response.url && response.url !== endpoint.href)) throw new ConnectorError('unsafe', 'Redirected response rejected.');
      if (!response.ok) throw new ConnectorError('transport', `Connector returned HTTP ${response.status}.`);
      if (!response.body) throw new ConnectorError('invalid_response', 'Empty response.');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 2000000) { await reader.cancel(); throw new ConnectorError('invalid_response', 'Response exceeds limit.'); } chunks.push(value);
      } } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError('transport', 'Connector request failed.');
    }
  };
}
