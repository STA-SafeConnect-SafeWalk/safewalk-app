import { test, expect } from './fixtures';
import { createHmac } from 'crypto';

const WEBHOOK_SECRET = 'e2e-webhook-secret';

test.describe('SOS API', () => {
  // ── Helpers ────────────────────────────────────────────────────────────────

  async function setupUser(api: any, server: any, suffix: string) {
    const sub  = `sub-sos-${suffix}-${Date.now()}`;
    const email = `sos-${suffix}-${Date.now()}@example.com`;
    const safeWalkId = `sw-sos-${suffix}`;
    await server.seedUser({ sub, email, password: 'Pass1!', displayName: `SOS User ${suffix}`, safeWalkId });
    const { idToken } = await (await api.post('/auth/sign-in', { data: { email, password: 'Pass1!' } })).json();
    return { sub, idToken, safeWalkId };
  }

  function auth(token: string) { return { Authorization: `Bearer ${token}` }; }

  function buildWebhookHeaders(body: string, eventType: string) {
    const timestamp = new Date().toISOString();
    const sig = createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
    return {
      'x-safewalk-signature': `sha256=${sig}`,
      'x-safewalk-timestamp': timestamp,
      'x-safewalk-event': eventType,
    };
  }

  // ── POST /sos ──────────────────────────────────────────────────────────────

  test('trigger SOS creates PENDING event', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'trigger');

    const res = await api.post('/sos', {
      headers: auth(idToken),
      data: { geoLocation: { lat: 52.52, lng: 13.405 } },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.sosId).toBeTruthy();
    expect(body.data.status).toBe('PENDING');
    expect(body.data.geoLocation.lat).toBe(52.52);
    expect(body.data.propagationDelaySeconds).toBe(0);

    // SQS message queued for propagation
    const msgs = await server.getSQSMessages();
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(msgs[0].body).sosId).toBe(body.data.sosId);
  });

  test('trigger SOS without geoLocation is accepted', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'nogeo');
    const res = await api.post('/sos', { headers: auth(idToken), data: {} });
    expect(res.status()).toBe(201);
    expect((await res.json()).data.status).toBe('PENDING');
  });

  test('trigger SOS with invalid coordinates returns 400', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'badgeo');
    const res = await api.post('/sos', {
      headers: auth(idToken),
      data: { geoLocation: { lat: 999, lng: 0 } },
    });
    expect(res.status()).toBe(400);
  });

  test('trigger SOS for unregistered user returns 400', async ({ api, server }) => {
    // User exists in Cognito but has no AppUsers record
    const email = `sos-unreg-${Date.now()}@example.com`;
    await api.post('/auth/sign-up', { data: { email, password: 'Pass1!' } });
    await api.post('/auth/confirm', { data: { email, confirmationCode: '123456' } });
    const { idToken } = await (await api.post('/auth/sign-in', { data: { email, password: 'Pass1!' } })).json();

    const res = await api.post('/sos', { headers: auth(idToken), data: {} });
    expect(res.status()).toBe(400);
  });

  test('trigger SOS without auth returns 401', async ({ api }) => {
    const res = await api.post('/sos', { data: { geoLocation: { lat: 52.52, lng: 13.405 } } });
    expect(res.status()).toBe(401);
  });

  // ── POST /sos/:id/propagate ────────────────────────────────────────────────

  test('immediate propagation transitions PENDING → ACTIVE', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'prop');
    const { data: { sosId } } = await (await api.post('/sos', { headers: auth(idToken), data: { geoLocation: { lat: 48.0, lng: 11.0 } } })).json();

    const res = await api.post(`/sos/${sosId}/propagate`, { headers: auth(idToken) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('ACTIVE');
    expect(body.data.platformSosId).toBeTruthy();
  });

  test('propagate non-existent SOS returns 404', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'prop404');
    const res = await api.post('/sos/ghost-id/propagate', { headers: auth(idToken) });
    expect(res.status()).toBe(404);
  });

  test('propagate twice returns 409', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'prop2x');
    const { data: { sosId } } = await (await api.post('/sos', { headers: auth(idToken), data: {} })).json();
    await api.post(`/sos/${sosId}/propagate`, { headers: auth(idToken) });
    const res = await api.post(`/sos/${sosId}/propagate`, { headers: auth(idToken) });
    expect(res.status()).toBe(409);
  });

  // ── PATCH /sos/:id ─────────────────────────────────────────────────────────

  test('update SOS location on PENDING event', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'upd');
    const { data: { sosId } } = await (await api.post('/sos', { headers: auth(idToken), data: {} })).json();

    const res = await api.patch(`/sos/${sosId}`, {
      headers: auth(idToken),
      data: { geoLocation: { lat: 51.5, lng: -0.12 } },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.geoLocation.lat).toBe(51.5);
  });

  test('update SOS with invalid coords returns 400', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'updbad');
    const { data: { sosId } } = await (await api.post('/sos', { headers: auth(idToken), data: {} })).json();
    const res = await api.patch(`/sos/${sosId}`, {
      headers: auth(idToken),
      data: { geoLocation: { lat: 0, lng: 999 } },
    });
    expect(res.status()).toBe(400);
  });

  test('update non-existent SOS returns 404', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'upd404');
    const res = await api.patch('/sos/no-such-id', {
      headers: auth(idToken),
      data: { geoLocation: { lat: 0, lng: 0 } },
    });
    expect(res.status()).toBe(404);
  });

  test('update cancelled SOS returns 410', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'upd410');
    const { data: { sosId } } = await (await api.post('/sos', { headers: auth(idToken), data: {} })).json();
    await api.delete(`/sos/${sosId}`, { headers: auth(idToken) });

    const res = await api.patch(`/sos/${sosId}`, {
      headers: auth(idToken),
      data: { geoLocation: { lat: 0, lng: 0 } },
    });
    expect(res.status()).toBe(410);
  });

  // ── DELETE /sos/:id ────────────────────────────────────────────────────────

  test('cancel SOS transitions to CANCELLED', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'cancel');
    const { data: { sosId } } = await (await api.post('/sos', { headers: auth(idToken), data: {} })).json();

    const res = await api.delete(`/sos/${sosId}`, { headers: auth(idToken) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('CANCELLED');
    expect(body.data.sosId).toBe(sosId);
  });

  test('cancel non-existent SOS returns 404', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'cancel404');
    const res = await api.delete('/sos/does-not-exist', { headers: auth(idToken) });
    expect(res.status()).toBe(404);
  });

  test('cancel already-cancelled SOS returns 410', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'cancel410');
    const { data: { sosId } } = await (await api.post('/sos', { headers: auth(idToken), data: {} })).json();
    await api.delete(`/sos/${sosId}`, { headers: auth(idToken) });
    const res = await api.delete(`/sos/${sosId}`, { headers: auth(idToken) });
    expect(res.status()).toBe(410);
  });

  test('new SOS supersedes previous PENDING SOS', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'supersede');
    const { data: first } = await (await api.post('/sos', { headers: auth(idToken), data: {} })).json();
    const { data: second } = await (await api.post('/sos', { headers: auth(idToken), data: {} })).json();

    expect(second.sosId).not.toBe(first.sosId);

    // Original SOS is now SUPERSEDED → cancel returns 410
    const cancelOld = await api.delete(`/sos/${first.sosId}`, { headers: auth(idToken) });
    expect(cancelOld.status()).toBe(410);
  });

  // ── GET /sos/received ──────────────────────────────────────────────────────

  test('GET /sos/received returns empty list initially', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'received');
    const res = await api.get('/sos/received', { headers: auth(idToken) });
    expect(res.status()).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });

  // ── POST /webhook/sos ──────────────────────────────────────────────────────

  test('webhook SOS_CREATED stores received SOS', async ({ api, server }) => {
    const { sub } = await setupUser(api, server, 'wh-create');
    const payload = {
      type: 'SOS_CREATED',
      sosId: `wh-sos-${Date.now()}`,
      timestamp: new Date().toISOString(),
      victim: { safeWalkId: 'sw-victim', platformId: 'e2e', platformUserId: 'victim-sub', displayName: 'Victim' },
      targets: [{ safeWalkId: 'sw-target', platformId: 'e2e', platformUserId: sub }],
      geoLocation: { lat: 48.0, lng: 11.0, timestamp: new Date().toISOString() },
    };
    const body = JSON.stringify(payload);
    const headers = buildWebhookHeaders(body, 'SOS_CREATED');

    const res = await api.post('/webhook/sos', { headers: { ...headers, 'Content-Type': 'application/json' }, data: payload });
    expect(res.status()).toBe(200);
  });

  test('webhook with invalid signature returns 401', async ({ api }) => {
    const payload = { type: 'SOS_CREATED', sosId: 'x', timestamp: new Date().toISOString(), victim: {}, targets: [] };
    const res = await api.post('/webhook/sos', {
      headers: {
        'x-safewalk-signature': 'sha256=invalidsig',
        'x-safewalk-timestamp': new Date().toISOString(),
        'x-safewalk-event': 'SOS_CREATED',
        'Content-Type': 'application/json',
      },
      data: payload,
    });
    expect(res.status()).toBe(401);
  });

  test('webhook with missing headers returns 401', async ({ api }) => {
    const res = await api.post('/webhook/sos', { data: { type: 'SOS_CREATED' } });
    expect(res.status()).toBe(401);
  });

  test('webhook SOS_CANCELLED processes without error', async ({ api, server }) => {
    const { sub } = await setupUser(api, server, 'wh-cancel');
    const payload = {
      type: 'SOS_CANCELLED',
      sosId: `wh-cancel-${Date.now()}`,
      timestamp: new Date().toISOString(),
      victim: { safeWalkId: 'sw-victim2', platformId: 'e2e', platformUserId: 'victim-sub2', displayName: 'Victim2' },
      targets: [{ safeWalkId: 'sw-tgt2', platformId: 'e2e', platformUserId: sub }],
    };
    const body = JSON.stringify(payload);
    const headers = buildWebhookHeaders(body, 'SOS_CANCELLED');
    const res = await api.post('/webhook/sos', { headers: { ...headers, 'Content-Type': 'application/json' }, data: payload });
    expect(res.status()).toBe(200);
  });
});
