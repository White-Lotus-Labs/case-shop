import { expect, it } from 'vitest';
import { workerCredentialsFromJson } from '../src/game-wallet/kms';
const ring =
  'projects/ai-video-editor-509418/locations/europe-west1/keyRings/iroh-player-wallets-testnet';
const email =
  'iroh-player-signer@ai-video-editor-509418.iam.gserviceaccount.com';
const credentials = {
  type: 'service_account',
  project_id: 'ai-video-editor-509418',
  client_email: email,
  private_key: 'test-only-private-key-placeholder',
};
it('accepts credentials only for the explicitly configured worker identity and project', () => {
  expect(
    workerCredentialsFromJson(JSON.stringify(credentials), ring, email),
  ).toEqual({
    projectId: 'ai-video-editor-509418',
    credentials: { client_email: email, private_key: credentials.private_key },
  });
  for (const changed of [
    { ...credentials, project_id: 'another-project' },
    {
      ...credentials,
      client_email: 'another@ai-video-editor-509418.iam.gserviceaccount.com',
    },
    { ...credentials, type: 'authorized_user' },
  ])
    expect(() =>
      workerCredentialsFromJson(JSON.stringify(changed), ring, email),
    ).toThrow('Worker credentials are invalid.');
});
it('never includes secret values in errors from malformed or wrong-account credentials', () => {
  const marker = 'do-not-leak-test-marker';
  for (const value of [
    marker,
    JSON.stringify({
      ...credentials,
      private_key: marker,
      project_id: 'wrong-project',
    }),
  ]) {
    try {
      workerCredentialsFromJson(value, ring, email);
      throw Error('Credentials unexpectedly accepted');
    } catch (error) {
      expect(String(error)).not.toContain(marker);
      expect(String(error)).toContain('Worker credentials are invalid.');
    }
  }
});
