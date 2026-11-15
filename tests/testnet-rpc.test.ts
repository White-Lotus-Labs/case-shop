import { describe, expect, it } from 'vitest';
import { CaseClient } from '../src/case/client';

const config = {
  network: 'testnet' as const,
  rpcUrl: 'https://near-testnet.drpc.org',
  tokenContractId: 'token.testnet',
  caseContractId: 'case.testnet',
};

describe('Testnet read transport', () => {
  it('falls back after rate limiting without changing the read request', async () => {
    const urls: string[] = [];
    const bodies: string[] = [];
    const request: typeof fetch = async (url, init) => {
      urls.push(String(url));
      bodies.push(String(init?.body));
      return urls.length === 1
        ? new Response('', { status: 429 })
        : Response.json({ result: { header: { height: 123 } } });
    };
    expect(await new CaseClient(config, request).finalBlockHeight()).toBe('123');
    expect(urls).toEqual(['https://near-testnet.drpc.org', 'https://rpc.testnet.near.org']);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it('never broadcasts or retries a signed transaction through the read transport', async () => {
    let calls = 0;
    const request: typeof fetch = async () => {
      calls++;
      return Response.json({ result: 'unexpected' });
    };
    await expect(new CaseClient(config, request).rpc('broadcast_tx_commit', {})).rejects.toThrow(/read/);
    expect(calls).toBe(0);
  });
});

it('uses the alternate read provider when the primary times out', async () => {
  let attempts = 0;
  const request: typeof fetch = async () => {
    if (++attempts === 1) throw new DOMException('Endpoint timed out', 'TimeoutError');
    return Response.json({ result: { header: { height: 456 } } });
  };
  expect(await new CaseClient(config, request).finalBlockHeight()).toBe('456');
  expect(attempts).toBe(2);
});
