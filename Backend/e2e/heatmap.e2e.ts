import { test, expect } from './fixtures';

test.describe('Heatmap API', () => {
  async function setupUser(api: any, server: any, suffix: string) {
    const sub = `sub-hm-${suffix}-${Date.now()}`;
    const email = `hm-${suffix}-${Date.now()}@example.com`;
    await server.seedUser({ sub, email, password: 'Pass1!', safeWalkId: `sw-hm-${suffix}` });
    const { idToken } = await (await api.post('/auth/sign-in', { data: { email, password: 'Pass1!' } })).json();
    return { sub, idToken };
  }

  function auth(t: string) { return { Authorization: `Bearer ${t}` }; }

  // ── POST /heatmap/reports ──────────────────────────────────────────────────

  test('submit a valid report returns 201', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'submit');
    const res = await api.post('/heatmap/reports', {
      headers: auth(idToken),
      data: { lat: 48.1351, lng: 11.5820, category: 'SAFE_AREA' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.reportId).toBeTruthy();
    expect(body.data.category).toBe('SAFE_AREA');
    expect(body.data.lat).toBe(48.1351);
  });

  test('submit report with description', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'submit-desc');
    const res = await api.post('/heatmap/reports', {
      headers: auth(idToken),
      data: { lat: 48.1351, lng: 11.5820, category: 'POORLY_LIT', description: 'Very dark street' },
    });
    expect(res.status()).toBe(201);
    expect((await res.json()).data.description).toBe('Very dark street');
  });

  test('submit report with invalid category returns 400', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'submit-badcat');
    const res = await api.post('/heatmap/reports', {
      headers: auth(idToken),
      data: { lat: 48.0, lng: 11.0, category: 'FLYING_UNICORN' },
    });
    expect(res.status()).toBe(400);
  });

  test('submit report with invalid coordinates returns 400', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'submit-badcoord');
    const res = await api.post('/heatmap/reports', {
      headers: auth(idToken),
      data: { lat: 999, lng: 11.0, category: 'SAFE_AREA' },
    });
    expect(res.status()).toBe(400);
  });

  test('submit report without auth returns 401', async ({ api }) => {
    const res = await api.post('/heatmap/reports', {
      data: { lat: 48.0, lng: 11.0, category: 'SAFE_AREA' },
    });
    expect(res.status()).toBe(401);
  });

  test('submit report without body returns 400', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'submit-nobody');
    const res = await api.post('/heatmap/reports', { headers: auth(idToken) });
    expect(res.status()).toBe(400);
  });

  // ── GET /heatmap/reports ───────────────────────────────────────────────────

  test('GET /heatmap/reports returns own submitted reports', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'list');
    await api.post('/heatmap/reports', { headers: auth(idToken), data: { lat: 48.0, lng: 11.0, category: 'WELL_LIT' } });
    await api.post('/heatmap/reports', { headers: auth(idToken), data: { lat: 48.1, lng: 11.1, category: 'UNSAFE_AREA' } });

    const res = await api.get('/heatmap/reports', { headers: auth(idToken) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.reports.length).toBeGreaterThanOrEqual(2);
    expect(body.data.reports[0].reportId).toBeTruthy();
    expect(body.data.reports[0].category).toBeTruthy();
  });

  test('GET /heatmap/reports returns empty for new user', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'list-empty');
    const res = await api.get('/heatmap/reports', { headers: auth(idToken) });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.reports).toEqual([]);
  });

  test('GET /heatmap/reports without auth returns 401', async ({ api }) => {
    const res = await api.get('/heatmap/reports');
    expect(res.status()).toBe(401);
  });

  // ── DELETE /heatmap/reports/:id ────────────────────────────────────────────

  test('DELETE /heatmap/reports/:id removes own report', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'del');
    const { data: { reportId } } = await (await api.post('/heatmap/reports', {
      headers: auth(idToken),
      data: { lat: 48.0, lng: 11.0, category: 'SAFE_AREA' },
    })).json();

    const res = await api.delete(`/heatmap/reports/${reportId}`, { headers: auth(idToken) });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.deleted).toBe(true);
  });

  test('DELETE /heatmap/reports/:id returns 404 for non-existent report', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'del-notfound');
    const res = await api.delete('/heatmap/reports/ghost-id', { headers: auth(idToken) });
    expect(res.status()).toBe(404);
  });

  test('DELETE /heatmap/reports/:id without auth returns 401', async ({ api }) => {
    const res = await api.delete('/heatmap/reports/some-id');
    expect(res.status()).toBe(401);
  });

  // ── GET /heatmap ───────────────────────────────────────────────────────────

  test('GET /heatmap returns cells for area with reports', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'query');
    // Submit a couple of reports near Munich
    await api.post('/heatmap/reports', { headers: auth(idToken), data: { lat: 48.1351, lng: 11.5820, category: 'SAFE_AREA' } });
    await api.post('/heatmap/reports', { headers: auth(idToken), data: { lat: 48.1353, lng: 11.5822, category: 'WELL_LIT' } });

    const res = await api.get('/heatmap?lat=48.1351&lng=11.5820&radiusKm=1', { headers: auth(idToken) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.cells)).toBe(true);
    expect(body.data.boundingBox).toBeTruthy();
    expect(typeof body.data.userReportsFound).toBe('number');
  });

  test('GET /heatmap without lat/lng returns 400', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'query-nolatlng');
    const res = await api.get('/heatmap', { headers: auth(idToken) });
    expect(res.status()).toBe(400);
  });

  test('GET /heatmap with out-of-range radiusKm returns 400', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'query-bigradius');
    const res = await api.get('/heatmap?lat=48.0&lng=11.0&radiusKm=999', { headers: auth(idToken) });
    expect(res.status()).toBe(400);
  });

  test('GET /heatmap with invalid coords returns 400', async ({ api, server }) => {
    const { idToken } = await setupUser(api, server, 'query-badcoord');
    const res = await api.get('/heatmap?lat=999&lng=11.0', { headers: auth(idToken) });
    expect(res.status()).toBe(400);
  });

  test('GET /heatmap without auth returns 401', async ({ api }) => {
    const res = await api.get('/heatmap?lat=48.0&lng=11.0');
    expect(res.status()).toBe(401);
  });
});
