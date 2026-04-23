import { test, expect } from './fixtures';

test.describe('Auth API', () => {
  // E2E confirmation code is hardcoded to '123456' in the Cognito mock
  const CONFIRM_CODE = '123456';
  const RESET_CODE   = '654321';

  async function signUp(api: any, email: string, password: string, displayName?: string) {
    return api.post('/auth/sign-up', { data: { email, password, ...(displayName ? { displayName } : {}) } });
  }

  async function confirm(api: any, email: string) {
    return api.post('/auth/confirm', { data: { email, confirmationCode: CONFIRM_CODE } });
  }

  async function signIn(api: any, email: string, password: string) {
    return api.post('/auth/sign-in', { data: { email, password } });
  }

  test('sign-up → confirm → sign-in returns tokens', async ({ api }) => {
    const email = `user-${Date.now()}@example.com`;
    const password = 'TestPass1!';

    const signUpRes = await signUp(api, email, password, 'Test User');
    expect(signUpRes.status()).toBe(201);
    const signUpBody = await signUpRes.json();
    expect(signUpBody.userSub).toBeTruthy();
    expect(signUpBody.confirmed).toBe(false);

    const confirmRes = await confirm(api, email);
    expect(confirmRes.status()).toBe(200);
    expect((await confirmRes.json()).message).toContain('confirmed');

    const signInRes = await signIn(api, email, password);
    expect(signInRes.status()).toBe(200);
    const tokens = await signInRes.json();
    expect(tokens.idToken).toBeTruthy();
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    expect(tokens.expiresIn).toBe(3600);
  });

  test('sign-up with duplicate email returns 409', async ({ api }) => {
    const email = `dup-${Date.now()}@example.com`;
    await signUp(api, email, 'Pass1!');
    const res = await signUp(api, email, 'Pass1!');
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain('already exists');
  });

  test('sign-up without email returns 400', async ({ api }) => {
    const res = await api.post('/auth/sign-up', { data: { password: 'Pass1!' } });
    expect(res.status()).toBe(400);
  });

  test('sign-up without password returns 400', async ({ api }) => {
    const res = await api.post('/auth/sign-up', { data: { email: 'a@b.com' } });
    expect(res.status()).toBe(400);
  });

  test('confirm with wrong code returns 400', async ({ api }) => {
    const email = `wrongcode-${Date.now()}@example.com`;
    await signUp(api, email, 'Pass1!');
    const res = await api.post('/auth/confirm', { data: { email, confirmationCode: '000000' } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('Invalid confirmation code');
  });

  test('sign-in before confirm returns 401', async ({ api }) => {
    const email = `unconfirmed-${Date.now()}@example.com`;
    await signUp(api, email, 'Pass1!');
    const res = await signIn(api, email, 'Pass1!');
    expect(res.status()).toBe(401);
  });

  test('sign-in with wrong password returns 401', async ({ api }) => {
    const email = `wrongpw-${Date.now()}@example.com`;
    await signUp(api, email, 'Pass1!');
    await confirm(api, email);
    const res = await signIn(api, email, 'WrongPass!');
    expect(res.status()).toBe(401);
  });

  test('sign-in with unknown user returns 404', async ({ api }) => {
    const res = await signIn(api, 'ghost@example.com', 'Pass1!');
    expect(res.status()).toBe(404);
  });

  test('token refresh returns new idToken', async ({ api }) => {
    const email = `refresh-${Date.now()}@example.com`;
    await signUp(api, email, 'Pass1!');
    await confirm(api, email);
    const { refreshToken } = await (await signIn(api, email, 'Pass1!')).json();

    const res = await api.post('/auth/refresh', { data: { refreshToken } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.idToken).toBeTruthy();
    expect(body.accessToken).toBeTruthy();
  });

  test('refresh with missing token returns 400', async ({ api }) => {
    const res = await api.post('/auth/refresh', { data: {} });
    expect(res.status()).toBe(400);
  });

  test('sign-out succeeds', async ({ api }) => {
    const email = `signout-${Date.now()}@example.com`;
    await signUp(api, email, 'Pass1!');
    await confirm(api, email);
    const { accessToken } = await (await signIn(api, email, 'Pass1!')).json();

    const res = await api.post('/auth/sign-out', { data: { accessToken } });
    expect(res.status()).toBe(200);
  });

  test('sign-out without accessToken returns 400', async ({ api }) => {
    const res = await api.post('/auth/sign-out', { data: {} });
    expect(res.status()).toBe(400);
  });

  test('forgot-password always returns 200 (account enumeration prevention)', async ({ api }) => {
    const res = await api.post('/auth/forgot-password', { data: { email: 'anyone@example.com' } });
    expect(res.status()).toBe(200);
    expect((await res.json()).message).toContain('reset code');
  });

  test('confirm-forgot-password resets password', async ({ api }) => {
    const email = `pwreset-${Date.now()}@example.com`;
    await signUp(api, email, 'OldPass1!');
    await confirm(api, email);

    const res = await api.post('/auth/confirm-forgot-password', {
      data: { email, confirmationCode: RESET_CODE, newPassword: 'NewPass1!' },
    });
    expect(res.status()).toBe(200);

    // Can now sign in with new password
    const loginRes = await signIn(api, email, 'NewPass1!');
    expect(loginRes.status()).toBe(200);
  });

  test('confirm-forgot-password with wrong code returns 400', async ({ api }) => {
    const email = `badreset-${Date.now()}@example.com`;
    await signUp(api, email, 'Pass1!');
    await confirm(api, email);

    const res = await api.post('/auth/confirm-forgot-password', {
      data: { email, confirmationCode: '000000', newPassword: 'NewPass1!' },
    });
    expect(res.status()).toBe(400);
  });
});
