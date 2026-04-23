import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import type { FullConfig } from '@playwright/test';

const HANDLER_DIRS_WITH_OWN_SDK = [
  'auth-handler',
  'notification-handler',
  'platform-registration-handler',
  'user-profile-handler',
  'sns-platform-app-resource',
];

async function globalSetup(_config: FullConfig) {
  const backendDir = path.resolve(__dirname, '..');
  const lambdaDir  = path.join(backendDir, 'lambda');
  const entryFile  = path.join(lambdaDir, 'e2e-server.ts');

  // tsx is installed at the backend level
  const tsxBin = path.join(backendDir, 'node_modules', '.bin', 'tsx');
  if (!fs.existsSync(tsxBin)) {
    throw new Error(`tsx not found at ${tsxBin} — run npm install in safewalk-app/Backend`);
  }

  // Hide per-handler @aws-sdk copies so the root-level mock takes precedence
  for (const dir of HANDLER_DIRS_WITH_OWN_SDK) {
    const sdkDir    = path.join(lambdaDir, dir, 'node_modules', '@aws-sdk');
    const hiddenDir = sdkDir + '.__e2e_hidden';
    if (fs.existsSync(sdkDir) && !fs.existsSync(hiddenDir)) {
      fs.renameSync(sdkDir, hiddenDir);
    }
  }

  return new Promise<void>((resolve, reject) => {
    const serverProcess = spawn(tsxBin, [entryFile], {
      cwd: lambdaDir,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    serverProcess.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
      const match = stdout.match(/SERVER_READY:(\d+)/);
      if (match) {
        process.env.E2E_BASE_URL = `http://127.0.0.1:${match[1]}`;
        (globalThis as any).__E2E_SERVER_PROCESS = serverProcess;
        resolve();
      }
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      stderr += msg;
      if (!msg.includes('ExperimentalWarning') && !msg.includes('DeprecationWarning')) {
        process.stderr.write(`[e2e-server] ${msg}`);
      }
    });

    serverProcess.on('error', (err) => { restoreHandlerDirs(lambdaDir); reject(err); });
    serverProcess.on('exit', (code) => {
      if (code !== null && code !== 0) {
        restoreHandlerDirs(lambdaDir);
        reject(new Error(`Server exited with code ${code}.\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    });

    setTimeout(() => {
      restoreHandlerDirs(lambdaDir);
      reject(new Error(`Server failed to start within 30 s.\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 30_000);
  });
}

function restoreHandlerDirs(lambdaDir: string) {
  for (const dir of HANDLER_DIRS_WITH_OWN_SDK) {
    const sdkDir    = path.join(lambdaDir, dir, 'node_modules', '@aws-sdk');
    const hiddenDir = sdkDir + '.__e2e_hidden';
    if (fs.existsSync(hiddenDir) && !fs.existsSync(sdkDir)) {
      fs.renameSync(hiddenDir, sdkDir);
    }
  }
}

export default globalSetup;
