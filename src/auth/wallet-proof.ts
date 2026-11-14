import { createHash, createPublicKey, verify } from 'node:crypto';
import { AuthError } from './validation';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function decodeBase58(value: string): Buffer {
  if (!value || value.length > 100)
    throw new AuthError('Invalid wallet proof.', 401);
  let n = 0n;
  for (const char of value) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new AuthError('Invalid wallet proof.', 401);
    n = n * 58n + BigInt(digit);
  }
  const hex = n.toString(16);
  const bytes =
    n === 0n
      ? Buffer.alloc(0)
      : Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex');
  return Buffer.concat([
    Buffer.alloc(value.match(/^1*/)?.[0].length ?? 0),
    bytes,
  ]);
}
function borshString(value: string): Buffer {
  const text = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(text.length);
  return Buffer.concat([length, text]);
}
export function nep413Hash(
  message: string,
  recipient: string,
  nonceBase64: string,
): Buffer {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(2 ** 31 + 413);
  const nonce = Buffer.from(nonceBase64, 'base64');
  if (nonce.length !== 32) throw new AuthError('Invalid wallet proof.', 401);
  return createHash('sha256')
    .update(
      Buffer.concat([
        prefix,
        borshString(message),
        nonce,
        borshString(recipient),
        Buffer.from([0]),
      ]),
    )
    .digest();
}
export function verifyNep413(
  proof: { publicKey: string; signature: string },
  message: string,
  recipient: string,
  nonceBase64: string,
): void {
  if (
    !proof.publicKey.startsWith('ed25519:') ||
    !/^[A-Za-z0-9+/]{86}==$/.test(proof.signature)
  )
    throw new AuthError('Invalid wallet proof.', 401);
  const key = decodeBase58(proof.publicKey.slice(8));
  const signature = Buffer.from(proof.signature, 'base64');
  if (key.length !== 32 || signature.length !== 64)
    throw new AuthError('Invalid wallet proof.', 401);
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]),
    format: 'der',
    type: 'spki',
  });
  if (
    !verify(
      null,
      nep413Hash(message, recipient, nonceBase64),
      publicKey,
      signature,
    )
  )
    throw new AuthError('Invalid wallet proof.', 401);
}
export function testnetAccount(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    (!/^[0-9a-f]{64}$/.test(value) &&
      !/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(value))
  )
    throw new AuthError('A valid NEAR Testnet account is required.');
  return value;
}
export type KeyVerifier = (
  accountId: string,
  publicKey: string,
) => Promise<void>;
export const verifyFinalizedFullAccessKey: KeyVerifier = async (
  accountId,
  publicKey,
) => {
  const { TestnetRpc } = await import('../game-wallet/chain');
  const rpc = new TestnetRpc();
  await rpc.assertNetwork();
  const result = await rpc.call('query', {
    request_type: 'view_access_key',
    finality: 'final',
    account_id: accountId,
    public_key: publicKey,
  });
  if (
    !result ||
    typeof result !== 'object' ||
    !('permission' in result) ||
    result.permission !== 'FullAccess'
  )
    throw new AuthError('Wallet ownership could not be verified.', 401);
};
