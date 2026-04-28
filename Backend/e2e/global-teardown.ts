import path from 'path';
import fs from 'fs';

const HANDLER_DIRS_WITH_OWN_SDK = [
  'auth-handler',
  'notification-handler',
  'platform-registration-handler',
  'user-profile-handler',
  'sns-platform-app-resource',
];

async function globalTeardown() {
  const proc = (globalThis as any).__E2E_SERVER_PROCESS;
  if (proc) {
    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
      setTimeout(resolve, 5000);
    });
  }

  const lambdaDir = path.resolve(__dirname, '..', 'lambda');
  for (const dir of HANDLER_DIRS_WITH_OWN_SDK) {
    const sdkDir    = path.join(lambdaDir, dir, 'node_modules', '@aws-sdk');
    const hiddenDir = sdkDir + '.__e2e_hidden';
    if (fs.existsSync(hiddenDir) && !fs.existsSync(sdkDir)) {
      fs.renameSync(hiddenDir, sdkDir);
    }
  }
}

export default globalTeardown;
