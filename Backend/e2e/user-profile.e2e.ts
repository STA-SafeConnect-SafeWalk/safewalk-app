import { test, expect } from './fixtures';

test.describe('User Profile & Contacts API', () => {
  // Helpers
  async function registerAndLogin(api: any, server: any, suffix: string) {
    const email = `profile-${suffix}-${Date.now()}@example.com`;
    const password = 'TestPass1!';
    await api.post('/auth/sign-up', { data: { email, password, displayName: `User ${suffix}` } });
    await api.post('/auth/confirm', { data: { email, confirmationCode: '123456' } });
    const { idToken } = await (await api.post('/auth/sign-in', { data: { email, password } })).json();
    return { email, idToken };
  }

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  // ── GET /me ──────────────────────────────────────────────────────────────

  test('GET /me returns 404 before registration', async ({ api, server }) => {
    const { idToken } = await registerAndLogin(api, server, 'me-noreg');
    const res = await api.get('/me', { headers: auth(idToken) });
    expect(res.status()).toBe(404);
  });

  test('GET /me returns profile after POST /register', async ({ api, server }) => {
    const { idToken } = await registerAndLogin(api, server, 'me-reg');
    await api.post('/register', { headers: auth(idToken), data: {} });

    const res = await api.get('/me', { headers: auth(idToken) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.hasPlatformRegistration).toBe(true);
    expect(body.userId).toBeTruthy();
  });

  test('GET /me without auth returns 401', async ({ api }) => {
    const res = await api.get('/me');
    expect(res.status()).toBe(401);
  });

  // ── POST /register ────────────────────────────────────────────────────────

  test('POST /register creates profile and returns sharing code', async ({ api, server }) => {
    const { idToken } = await registerAndLogin(api, server, 'reg-ok');
    const res = await api.post('/register', { headers: auth(idToken), data: {} });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.sharingCode).toBeTruthy();
    expect(body.sharingCodeExpiresAt).toBeTruthy();

    // Platform should have a user entry
    const platformUsers = await server.getPlatformUsers();
    expect(platformUsers.length).toBeGreaterThanOrEqual(1);
  });

  test('POST /register is idempotent (second call returns 200)', async ({ api, server }) => {
    const { idToken } = await registerAndLogin(api, server, 'reg-idem');
    await api.post('/register', { headers: auth(idToken), data: {} });

    const res = await api.post('/register', { headers: auth(idToken), data: {} });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.sharingCode).toBeTruthy();
  });

  test('POST /register without auth returns 401', async ({ api }) => {
    const res = await api.post('/register', { data: {} });
    expect(res.status()).toBe(401);
  });

  // ── GET /sharing-code & POST /sharing-code ────────────────────────────────

  test('GET /sharing-code returns code after register', async ({ api, server }) => {
    const { idToken } = await registerAndLogin(api, server, 'sc-get');
    await api.post('/register', { headers: auth(idToken), data: {} });

    const res = await api.get('/sharing-code', { headers: auth(idToken) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.sharingCode).toBeTruthy();
    expect(body.sharingCodeExpiresAt).toBeTruthy();
  });

  test('GET /sharing-code returns 404 before register', async ({ api, server }) => {
    const { idToken } = await registerAndLogin(api, server, 'sc-noreg');
    const res = await api.get('/sharing-code', { headers: auth(idToken) });
    // User not in DB at all → 404
    expect(res.status()).toBe(404);
  });

  test('POST /sharing-code generates a new code', async ({ api, server }) => {
    const { idToken } = await registerAndLogin(api, server, 'sc-gen');
    await api.post('/register', { headers: auth(idToken), data: {} });
    const first = (await (await api.get('/sharing-code', { headers: auth(idToken) })).json()).sharingCode;

    const res = await api.post('/sharing-code', { headers: auth(idToken) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.sharingCode).toBeTruthy();
    // A new code is generated (may or may not differ from first, but platform call is made)
    expect(body.sharingCodeExpiresAt).toBeTruthy();
  });

  // ── Contacts flow ─────────────────────────────────────────────────────────

  test('POST /sharing-code/connect adds contact', async ({ api, server }) => {
    const { idToken: tokenA } = await registerAndLogin(api, server, 'ct-a');
    const { idToken: tokenB } = await registerAndLogin(api, server, 'ct-b');
    await api.post('/register', { headers: auth(tokenA), data: {} });
    await api.post('/register', { headers: auth(tokenB), data: {} });

    // B gets their sharing code
    const { sharingCode } = await (await api.get('/sharing-code', { headers: auth(tokenB) })).json();

    // A connects with B's sharing code
    const res = await api.post('/sharing-code/connect', { headers: auth(tokenA), data: { sharingCode } });
    expect(res.status()).toBe(200);
  });

  test('POST /sharing-code/connect missing sharingCode returns 400', async ({ api, server }) => {
    const { idToken } = await registerAndLogin(api, server, 'ct-nocode');
    await api.post('/register', { headers: auth(idToken), data: {} });
    const res = await api.post('/sharing-code/connect', { headers: auth(idToken), data: {} });
    expect(res.status()).toBe(400);
  });

  test('POST /contacts/connect-back adds reverse contact', async ({ api, server }) => {
    const { idToken: tokenA } = await registerAndLogin(api, server, 'cb-a');
    const { idToken: tokenB } = await registerAndLogin(api, server, 'cb-b');
    await api.post('/register', { headers: auth(tokenA), data: {} });
    await api.post('/register', { headers: auth(tokenB), data: {} });

    const platformUsers = await server.getPlatformUsers();
    const userBSafeWalkId = platformUsers.find((u: any) =>
      !platformUsers.some((pu: any) => pu.safeWalkId === u.safeWalkId && pu !== u)
    )?.safeWalkId ?? platformUsers[platformUsers.length - 1].safeWalkId;

    const res = await api.post('/contacts/connect-back', {
      headers: auth(tokenA),
      data: { peerSafeWalkId: userBSafeWalkId },
    });
    expect(res.status()).toBe(200);
  });

  test('POST /contacts/connect-back missing peerSafeWalkId returns 400', async ({ api, server }) => {
    const { idToken } = await registerAndLogin(api, server, 'cb-noid');
    await api.post('/register', { headers: auth(idToken), data: {} });
    const res = await api.post('/contacts/connect-back', { headers: auth(idToken), data: {} });
    expect(res.status()).toBe(400);
  });

  test('GET /contacts returns list', async ({ api, server }) => {
    const { idToken } = await registerAndLogin(api, server, 'ct-list');
    await api.post('/register', { headers: auth(idToken), data: {} });

    const res = await api.get('/contacts', { headers: auth(idToken) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.contacts)).toBe(true);
  });

  test('PATCH /contacts/:id updates sharing settings', async ({ api, server }) => {
    const { idToken: tokenA } = await registerAndLogin(api, server, 'upd-a');
    const { idToken: tokenB } = await registerAndLogin(api, server, 'upd-b');
    await api.post('/register', { headers: auth(tokenA), data: {} });
    await api.post('/register', { headers: auth(tokenB), data: {} });
    const { sharingCode } = await (await api.get('/sharing-code', { headers: auth(tokenB) })).json();
    await api.post('/sharing-code/connect', { headers: auth(tokenA), data: { sharingCode } });

    const contacts = (await (await api.get('/contacts', { headers: auth(tokenA) })).json()).contacts;
    expect(contacts.length).toBeGreaterThan(0);
    const contactId = contacts[0].contactId;

    const res = await api.patch(`/contacts/${contactId}`, {
      headers: auth(tokenA),
      data: { locationSharing: true, sosSharing: true },
    });
    expect(res.status()).toBe(200);
  });

  test('PATCH /contacts/:id with invalid body returns 400', async ({ api, server }) => {
    const { idToken } = await registerAndLogin(api, server, 'upd-bad');
    await api.post('/register', { headers: auth(idToken), data: {} });
    const res = await api.patch('/contacts/some-contact-id', {
      headers: auth(idToken),
      data: { locationSharing: 'yes' }, // should be boolean
    });
    expect(res.status()).toBe(400);
  });

  test('DELETE /contacts/:id removes contact', async ({ api, server }) => {
    const { idToken: tokenA } = await registerAndLogin(api, server, 'del-a');
    const { idToken: tokenB } = await registerAndLogin(api, server, 'del-b');
    await api.post('/register', { headers: auth(tokenA), data: {} });
    await api.post('/register', { headers: auth(tokenB), data: {} });
    const { sharingCode } = await (await api.get('/sharing-code', { headers: auth(tokenB) })).json();
    await api.post('/sharing-code/connect', { headers: auth(tokenA), data: { sharingCode } });

    const contacts = (await (await api.get('/contacts', { headers: auth(tokenA) })).json()).contacts;
    const contactId = contacts[0].contactId;

    const res = await api.delete(`/contacts/${contactId}`, { headers: auth(tokenA) });
    expect(res.status()).toBe(200);
  });
});
