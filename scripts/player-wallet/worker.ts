import { PrismaClient } from '@prisma/client';
import { SigningWorker } from '../../src/game-wallet/worker';
import { TestnetRpc } from '../../src/game-wallet/chain';
import { createManagedSigner } from '../../src/game-wallet/kms';
import {
  signerConfiguration,
  publicTestnetWritesEnabled,
} from '../../src/game-wallet/config';
// Deliberately does not load dotenv or the web application's environment files.
if (!signerConfiguration().configured || !publicTestnetWritesEnabled())
  throw new Error(
    'Configure a dedicated player KMS worker and explicitly authorize Testnet activation first.',
  );
const db = new PrismaClient();
const worker = new SigningWorker(db, new TestnetRpc(), createManagedSigner());
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
try {
  while (!stopping) {
    try {
      await worker.tick();
    } catch {
      console.error(
        'Player worker unavailable; no new operation is authorized.',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
} finally {
  await db.$disconnect();
}
