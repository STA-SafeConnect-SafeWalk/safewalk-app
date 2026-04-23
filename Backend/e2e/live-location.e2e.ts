import { test, expect } from './fixtures';

test.describe('Live Location API', () => {
  async function setupUser(api: any, server: any, suffix: string) {
    const sub = `sub-loc-${suffix}-${Date.now()}`;
    const email = `loc-${suffix}-${Date.now()}@example.com`;
    const safeWalkId = `sw-loc-${suffix}-${Date.now()}`;
    await server.seedUser({ sub, email, password: 'Pass1!', displayName: `Loc User ${suffix}`, safeWalkId });
    const { idToken } = await (await api.post('/auth/sign-in', { data: { email, password: 'Pass1!' } })).json();
    return { sub, idToken, safeWalkId };
  }

  function auth(t: string) { return { Authorization: `Bearer ${t}` }; }

  // ── PUT /location ──────────────────────────────────────────────────────────

  test('PUT /location stores current location', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'put');
    const res = await api.put('/location', {
      headers: auth(idToken),
      data: { lat: 48.1351, lng: 11.5820, accuracy: 10 },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.lat).toBe(48.1351);
    expect(body.lng).toBe(11.5820);
    expect(body.accuracy).toBe(10);
    expect(body.safeWalkId).toBeTruthy();
    expect(body.updatedAt).toBeTruthy();
  });

  test('PUT /location with invalid lat returns 400', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'put-badlat');
    const res = await api.put('/location', {
      headers: auth(idToken),
      data: { lat: 200, lng: 0, accuracy: 5 },
    });
    expect(res.status()).toBe(400);
  });

  test('PUT /location with invalid lng returns 400', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'put-badlng');
    const res = await api.put('/location', {
      headers: auth(idToken),
      data: { lat: 0, lng: -999, accuracy: 5 },
    });
    expect(res.status()).toBe(400);
  });

  test('PUT /location with negative accuracy returns 400', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'put-badacc');
    const res = await api.put('/location', {
      headers: auth(idToken),
      data: { lat: 0, lng: 0, accuracy: -1 },
    });
    expect(res.status()).toBe(400);
  });

  test('PUT /location missing fields returns 400', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'put-missing');
    const res = await api.put('/location', {
      headers: auth(idToken),
      data: { lat: 48.0 }, // lng and accuracy missing
    });
    expect(res.status()).toBe(400);
  });

  test('PUT /location without auth returns 401', async ({ api }) => {
    const res = await api.put('/location', { data: { lat: 0, lng: 0, accuracy: 5 } });
    expect(res.status()).toBe(401);
  });

  test('PUT /location for unregistered user returns 400', async ({ api, server }) => {
    // Cognito user exists but no AppUsers record
    const email = `loc-unreg-${Date.now()}@example.com`;
    await api.post('/auth/sign-up', { data: { email, password: 'Pass1!' } });
    await api.post('/auth/confirm', { data: { email, confirmationCode: '123456' } });
    const { idToken } = await (await api.post('/auth/sign-in', { data: { email, password: 'Pass1!' } })).json();
    const res = await api.put('/location', { headers: auth(idToken), data: { lat: 0, lng: 0, accuracy: 5 } });
    expect(res.status()).toBe(400);
  });

  // ── DELETE /location ───────────────────────────────────────────────────────

  test('DELETE /location stops sharing', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'del');
    await api.put('/location', { headers: auth(idToken), data: { lat: 0, lng: 0, accuracy: 5 } });
    const res = await api.delete('/location', { headers: auth(idToken) });
    expect(res.status()).toBe(204);
  });

  test('DELETE /location without auth returns 401', async ({ api }) => {
    const res = await api.delete('/location');
    expect(res.status()).toBe(401);
  });

  // ── GET /location/contacts ─────────────────────────────────────────────────

  test('GET /location/contacts returns empty when no contacts share', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'ctloc-empty');
    const res = await api.get('/location/contacts', { headers: auth(idToken) });
    expect(res.status()).toBe(200);
    expect((await res.json()).locations).toEqual([]);
  });

  test('GET /location/contacts without auth returns 401', async ({ api }) => {
    const res = await api.get('/location/contacts');
    expect(res.status()).toBe(401);
  });

  // ── GET /location/contacts/:safeWalkId ────────────────────────────────────

  test('GET /location/contacts/:id returns 404 when contact not sharing', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'ctloc-notsharing');
    const res = await api.get('/location/contacts/some-other-id', { headers: auth(idToken) });
    expect(res.status()).toBe(404);
  });

  test('GET /location/contacts/:id without auth returns 401', async ({ api }) => {
    const res = await api.get('/location/contacts/any-id');
    expect(res.status()).toBe(401);
  });
});
