import { test, expect } from './fixtures';

test.describe('Tips API', () => {
  async function signedInToken(api: any) {
    const email = `tips-${Date.now()}@example.com`;
    await api.post('/auth/sign-up', { data: { email, password: 'Pass1!' } });
    await api.post('/auth/confirm', { data: { email, confirmationCode: '123456' } });
    const { idToken } = await (await api.post('/auth/sign-in', { data: { email, password: 'Pass1!' } })).json();
    return idToken;
  }

  function auth(t: string) { return { Authorization: `Bearer ${t}` }; }

  test('GET /tips returns empty data when no tips seeded', async ({ api, server }) => {
    const idToken = await signedInToken(api);
    const res = await api.get('/tips', { headers: auth(idToken) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.tipOfTheDay).toBeNull();
    expect(body.data.tips).toEqual([]);
  });

  test('GET /tips returns tipOfTheDay when tips are seeded', async ({ api, server }) => {
    await server.seedTip({ tipId: 'tip-1', icon: '🔒', title: 'Stay Safe', description: 'Always be aware', category: 'General', isActive: true });
    await server.seedTip({ tipId: 'tip-2', icon: '💡', title: 'Stay Lit', description: 'Use well-lit paths', category: 'General', isActive: true });

    const idToken = await signedInToken(api);
    const res = await api.get('/tips', { headers: auth(idToken) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.tipOfTheDay).toBeTruthy();
    expect(body.data.tipOfTheDay.tipId).toBeTruthy();
    expect(body.data.tipOfTheDay.title).toBeTruthy();
    // tipOfTheDay is excluded from the general list
    const tipOfDayId = body.data.tipOfTheDay.tipId;
    expect(body.data.tips.every((t: any) => t.tipId !== tipOfDayId)).toBe(true);
  });

  test('GET /tips only returns active tips', async ({ api, server }) => {
    await server.seedTip({ tipId: 'tip-active', title: 'Active Tip', icon: '✅', description: 'Active', category: 'General', isActive: true });
    await server.seedTip({ tipId: 'tip-inactive', title: 'Inactive Tip', icon: '❌', description: 'Inactive', category: 'General', isActive: false });

    const idToken = await signedInToken(api);
    const body = await (await api.get('/tips', { headers: auth(idToken) })).json();
    const allTips = [body.data.tipOfTheDay, ...body.data.tips].filter(Boolean);
    expect(allTips.some((t: any) => t.tipId === 'tip-inactive')).toBe(false);
    expect(allTips.some((t: any) => t.tipId === 'tip-active')).toBe(true);
  });

  test('GET /tips without auth returns 401', async ({ api }) => {
    const res = await api.get('/tips');
    expect(res.status()).toBe(401);
  });
});
