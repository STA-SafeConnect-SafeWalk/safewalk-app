import { test as base, APIRequestContext } from '@playwright/test';

interface ServerControls {
  /** Reset all in-memory state (DB, Cognito users, SQS, SNS). */
  reset: () => Promise<void>;
  /** Return SQS messages captured since last reset. */
  getSQSMessages: () => Promise<Array<{ queueUrl: string; body: string }>>;
  /** Return SNS publishes captured since last reset. */
  getSNSPublishes: () => Promise<Array<{ targetArn?: string; message: string }>>;
  /** Return platform users registered on the mock SafeConnect platform. */
  getPlatformUsers: () => Promise<Array<{ safeWalkId: string; platformUserId: string }>>;
  /** Seed a tip directly into TipsTable. */
  seedTip: (tip: Record<string, unknown>) => Promise<void>;
  /** Seed a fully-registered user (Cognito + DynamoDB + platform) without going through the full sign-up flow. */
  seedUser: (opts: { sub: string; email: string; password: string; displayName?: string; safeWalkId?: string }) => Promise<void>;
}

type Fixtures = {
  api: APIRequestContext;
  server: ServerControls;
};

export const test = base.extend<Fixtures>({
  api: async ({ playwright }, use) => {
    const baseURL = process.env.E2E_BASE_URL;
    if (!baseURL) throw new Error('E2E_BASE_URL not set — is globalSetup running?');
    const ctx = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'Content-Type': 'application/json' },
    });
    await use(ctx);
    await ctx.dispose();
  },

  server: async ({ api }, use) => {
    await api.post('/__reset');

    const controls: ServerControls = {
      reset: async () => { await api.post('/__reset'); },
      getSQSMessages: async () => (await (await api.get('/__sqs')).json()),
      getSNSPublishes: async () => (await (await api.get('/__sns')).json()),
      getPlatformUsers: async () => (await (await api.get('/__platform/users')).json()),
      seedTip: async (tip) => { await api.post('/__platform/seed-tip', { data: tip }); },
      seedUser: async (opts) => { await api.post('/__platform/seed-user', { data: opts }); },
    };

    await use(controls);
  },
});

export { expect } from '@playwright/test';
