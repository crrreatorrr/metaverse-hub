// POST /verify {message, signature} -> {address}: which EOA signed a personal_sign message.
// Only Nakama calls this, with the shared x-chain-service-key header. It is never exposed
// through Caddy.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { recoverMessageAddress, type Hex } from 'viem';

const MAX_BODY = 8192;

function keyMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('too_large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createVerifyServer(serviceKey: string, health: () => object = () => ({ ok: true })): Server {
  return createServer(async (req, res) => {
    const send = (code: number, body: object) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === 'GET' && req.url === '/health') return send(200, health());
      if (req.method !== 'POST' || req.url !== '/verify') return send(404, { error: 'not_found' });
      const key = req.headers['x-chain-service-key'];
      if (!keyMatches(typeof key === 'string' ? key : undefined, serviceKey)) return send(401, { error: 'unauthorized' });
      const body = JSON.parse(await readBody(req)) as { message?: unknown; signature?: unknown };
      if (typeof body.message !== 'string' || body.message.length === 0 || body.message.length > 4096) {
        return send(400, { error: 'bad_message' });
      }
      if (typeof body.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(body.signature)) {
        return send(400, { error: 'bad_signature' });
      }
      const address = await recoverMessageAddress({ message: body.message, signature: body.signature as Hex });
      return send(200, { address: address.toLowerCase() });
    } catch {
      return send(400, { error: 'bad_request' });
    }
  });
}
