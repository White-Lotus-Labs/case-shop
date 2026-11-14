import { createPublicKey } from 'node:crypto';
import { createRequire } from 'node:module';
import { baseEncode, PublicKey } from 'near-api-js';
import { kmsKeyRing } from './config';
export { signerConfiguration } from './config';

export interface ManagedSigner {
  allocate(
    walletId: string,
  ): Promise<{ accountId: string; publicKey: string; keyVersion: string }>;
  signHash(
    keyVersion: string,
    expectedPublicKey: string,
    hash: Uint8Array,
  ): Promise<Uint8Array>;
}
export interface KmsTransport {
  createCryptoKey(request: {
    parent: string;
    cryptoKeyId: string;
    cryptoKey: {
      purpose: 'ASYMMETRIC_SIGN';
      versionTemplate: {
        algorithm: 'EC_SIGN_ED25519';
        protectionLevel: 'SOFTWARE';
      };
    };
  }): Promise<unknown>;
  getCryptoKeyVersion(request: { name: string }): Promise<unknown>;
  getPublicKey(request: { name: string }): Promise<unknown>;
  asymmetricSign(request: {
    name: string;
    data: Uint8Array;
    dataCrc32c: { value: number };
  }): Promise<unknown>;
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Malformed managed signer response.');
  return Object.fromEntries(Object.entries(value));
}
function fieldIs(value: unknown, text: string, code: number): boolean {
  return value === text || value === code;
}
export function crc32c(data: Uint8Array): number {
  const module: unknown = createRequire(import.meta.url)('fast-crc32c/impls/js_crc32c');
  const calculate = object(module).calculate;
  if (typeof calculate !== 'function')
    throw new Error('CRC32C implementation unavailable.');
  const result: unknown = calculate(Buffer.from(data));
  if (typeof result !== 'number' || !Number.isInteger(result))
    throw new Error('Invalid CRC32C result.');
  return result >>> 0;
}
function checkCrc(data: Uint8Array, checksum: unknown): void {
  const value = object(checksum).value;
  if (
    value === undefined ||
    value === null ||
    String(value) !== String(crc32c(data))
  )
    throw new Error('Managed signer integrity check failed.');
}
function responseBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (
    typeof value === 'string' &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    return Buffer.from(value, 'base64');
  throw new Error('Malformed managed signature.');
}
function alreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 6 || error.code === 409)
  );
}

export function createKmsManagedSigner(
  keyRing: string,
  client: KmsTransport,
): ManagedSigner {
  if (kmsKeyRing(keyRing) !== keyRing)
    throw new Error('KMS key ring is required.');
  const versionPattern = new RegExp(
    `^${keyRing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/cryptoKeys/player-[0-9a-f]{32}/cryptoKeyVersions/1$`,
  );
  async function publicKeyFor(name: string): Promise<string> {
    if (!versionPattern.test(name))
      throw new Error('Unexpected managed key version.');
    const version = object(await client.getCryptoKeyVersion({ name }));
    if (
      version.name !== name ||
      !fieldIs(version.state, 'ENABLED', 1) ||
      !fieldIs(version.algorithm, 'EC_SIGN_ED25519', 40) ||
      !fieldIs(version.protectionLevel, 'SOFTWARE', 1)
    )
      throw new Error('Managed key configuration mismatch.');
    const response = object(await client.getPublicKey({ name }));
    if (
      response.name !== name ||
      !fieldIs(response.algorithm, 'EC_SIGN_ED25519', 40) ||
      !fieldIs(response.protectionLevel, 'SOFTWARE', 1) ||
      typeof response.pem !== 'string'
    )
      throw new Error('Managed public key configuration mismatch.');
    checkCrc(Buffer.from(response.pem), response.pemCrc32c);
    const key = createPublicKey(response.pem);
    if (key.asymmetricKeyType !== 'ed25519')
      throw new Error('Managed key must be Ed25519.');
    const jwk = key.export({ format: 'jwk' });
    if (jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string')
      throw new Error('Malformed managed Ed25519 key.');
    const raw = Buffer.from(jwk.x, 'base64url');
    if (raw.length !== 32)
      throw new Error('Malformed managed public key length.');
    return `ed25519:${baseEncode(raw)}`;
  }
  return {
    async allocate(walletId) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          walletId,
        )
      )
        throw new Error('Wallet allocation requires a UUID.');
      const cryptoKeyId = `player-${walletId.replaceAll('-', '')}`;
      const keyVersion = `${keyRing}/cryptoKeys/${cryptoKeyId}/cryptoKeyVersions/1`;
      try {
        await client.createCryptoKey({
          parent: keyRing,
          cryptoKeyId,
          cryptoKey: {
            purpose: 'ASYMMETRIC_SIGN',
            versionTemplate: {
              algorithm: 'EC_SIGN_ED25519',
              protectionLevel: 'SOFTWARE',
            },
          },
        });
      } catch (error) {
        if (!alreadyExists(error)) throw error;
      }
      const publicKey = await publicKeyFor(keyVersion);
      return {
        accountId: Buffer.from(PublicKey.fromString(publicKey).data).toString(
          'hex',
        ),
        publicKey,
        keyVersion,
      };
    },
    async signHash(keyVersion, expectedPublicKey, hash) {
      if (hash.length !== 32)
        throw new Error('NEAR signing requires a 32-byte transaction hash.');
      const publicKey = await publicKeyFor(keyVersion);
      if (publicKey !== expectedPublicKey)
        throw new Error('Pinned managed public key mismatch.');
      const response = object(
        await client.asymmetricSign({
          name: keyVersion,
          data: hash,
          dataCrc32c: { value: crc32c(hash) },
        }),
      );
      if (response.name !== keyVersion || response.verifiedDataCrc32c !== true)
        throw new Error('Managed signing request integrity failed.');
      const signature = responseBytes(response.signature);
      checkCrc(signature, response.signatureCrc32c);
      if (
        signature.length !== 64 ||
        !PublicKey.fromString(publicKey).verify(hash, signature)
      )
        throw new Error('Managed signature verification failed.');
      return signature;
    },
  };
}

/** Parse credentials in the signer process only. Never include raw input in errors. */
export function workerCredentialsFromJson(
  raw: string,
  keyRing: string,
  expectedEmail: string,
): {
  projectId: string;
  credentials: { client_email: string; private_key: string };
} {
  try {
    if (raw.length > 65536) throw new Error();
    const value = object(JSON.parse(raw));
    const projectId = kmsKeyRing(keyRing)?.split('/')[1];
    if (
      !projectId ||
      !/^iroh-[a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(
        expectedEmail,
      ) ||
      !expectedEmail.endsWith(`@${projectId}.iam.gserviceaccount.com`) ||
      value.type !== 'service_account' ||
      value.project_id !== projectId ||
      value.client_email !== expectedEmail ||
      typeof value.private_key !== 'string' ||
      value.private_key.length === 0 ||
      value.private_key.length > 16384
    )
      throw new Error();
    return {
      projectId,
      credentials: {
        client_email: expectedEmail,
        private_key: value.private_key,
      },
    };
  } catch {
    throw new Error('Worker credentials are invalid.');
  }
}

export function createManagedSigner(): ManagedSigner {
  if (typeof window !== 'undefined')
    throw new Error('Managed signing is worker-only.');
  const keyRing = kmsKeyRing();
  if (!keyRing) throw new Error('Managed signing is not configured.');
  // A service-scoped secret is an optional prototype alternative to standard ADC.
  const rawCredentials = process.env.IROH_PLAYER_GOOGLE_CREDENTIALS_JSON;
  if (rawCredentials !== undefined)
    delete process.env.IROH_PLAYER_GOOGLE_CREDENTIALS_JSON;
  const clientOptions =
    rawCredentials === undefined
      ? undefined
      : workerCredentialsFromJson(
          rawCredentials,
          keyRing,
          process.env.IROH_PLAYER_SERVICE_ACCOUNT_EMAIL ?? '',
        );
  const pending = import('@google-cloud/kms').then(
    ({ KeyManagementServiceClient }) =>
      new KeyManagementServiceClient(clientOptions),
  );
  return createKmsManagedSigner(keyRing, {
    async createCryptoKey(request) {
      const [result] = await (await pending).createCryptoKey(request);
      return result;
    },
    async getCryptoKeyVersion(request) {
      const [result] = await (await pending).getCryptoKeyVersion(request);
      return result;
    },
    async getPublicKey(request) {
      const [result] = await (await pending).getPublicKey(request);
      return result;
    },
    async asymmetricSign(request) {
      const [result] = await (await pending).asymmetricSign(request);
      return result;
    },
  });
}
