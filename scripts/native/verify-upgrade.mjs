import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// A pinned source fixture makes deployed-layout compatibility independently rerunnable.
const beforeRevision = '91484c2f90928c15fee49156bb91577b8eba6404';
const repository = process.cwd();
const temporary = mkdtempSync(join(tmpdir(), 'fujitora-upgrade-'));
try {
  const archive = execFileSync('git', ['archive', beforeRevision, 'contracts', 'config'], { maxBuffer: 32 * 1024 * 1024 });
  const archivePath = join(temporary, 'before.tar');
  writeFileSync(archivePath, archive);
  execFileSync('tar', ['-xf', archivePath, '-C', temporary]);
  const target = join(temporary, 'target');
  execFileSync(process.env.IROH_CARGO_BIN ?? 'cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'near-native-case-pool'], {
    cwd: join(temporary, 'contracts'), stdio: 'inherit',
    env: { ...process.env, CARGO_TARGET_DIR: target, RUSTFLAGS: `${process.env.RUSTFLAGS ?? ''} -C target-cpu=mvp` },
  });
  execFileSync('bash', ['scripts/contracts.sh', 'native-integration'], {
    cwd: repository, stdio: 'inherit',
    env: { ...process.env, NATIVE_PRE_UPGRADE_WASM: resolve(target, 'wasm32-unknown-unknown/release/near_native_case_pool.wasm') },
  });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
