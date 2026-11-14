const TESTNET_ENDPOINTS = [
  'https://rpc.testnet.fastnear.com',
  'https://rpc.testnet.near.org',
];

export function testnetRpcUrl(value = process.env.IROH_PLAYER_RPC_URL): string {
  const url = value ?? TESTNET_ENDPOINTS[0];
  if (!TESTNET_ENDPOINTS.includes(url))
    throw new Error('Player RPC must be an approved NEAR Testnet endpoint.');
  return url;
}

export function kmsKeyRing(
  value = process.env.IROH_PLAYER_KMS_KEY_RING,
): string | null {
  if (!value) return null;
  if (
    !/^projects\/[a-zA-Z0-9:_-]+\/locations\/[a-zA-Z0-9_-]+\/keyRings\/[a-zA-Z0-9_-]+$/.test(
      value,
    )
  )
    throw new Error('Invalid player KMS key ring metadata.');
  return value;
}

export function signerConfiguration(): {
  configured: boolean;
  reason: string | null;
} {
  try {
    if (!kmsKeyRing())
      return {
        configured: false,
        reason: 'Managed signing is not configured.',
      };
    testnetRpcUrl();
    return { configured: true, reason: null };
  } catch {
    return {
      configured: false,
      reason: 'Player signing configuration is invalid.',
    };
  }
}

export function publicTestnetWritesEnabled(): boolean {
  return process.env.IROH_PLAYER_TESTNET_WRITES_ENABLED === '1';
}
