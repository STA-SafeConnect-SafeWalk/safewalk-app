import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  GlobalSignOutCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  NotAuthorizedException,
  UserNotFoundException,
  UsernameExistsException,
  CodeMismatchException,
  ExpiredCodeException,
  InvalidPasswordException,
  LimitExceededException,
} from '@aws-sdk/client-cognito-identity-provider';
import { handler as _handler } from '../auth-handler/index';
const handler = _handler as (event: any) => Promise<any>;

const cognitoMock = mockClient(CognitoIdentityProviderClient);

const makeEvent = (routeKey: string, body?: unknown) =>
  ({
    routeKey,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    requestContext: {},
    headers: {},
    isBase64Encoded: false,
    rawPath: '',
    rawQueryString: '',
    version: '2.0',
  }) as any;

describe('auth-handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    cognitoMock.reset();
    process.env = { ...originalEnv, APP_CLIENT_ID: 'test-client-id' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ---------------------------------------------------------------------------
  // Configuration guard
  // ---------------------------------------------------------------------------

  it('returns 500 when APP_CLIENT_ID is missing', async () => {
    delete process.env.APP_CLIENT_ID;
    const res = await handler(makeEvent('POST /auth/sign-up', { email: 'a@b.com', password: 'secret' }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/APP_CLIENT_ID/);
  });

  it('returns 404 for unknown route', async () => {
    const res = await handler(makeEvent('GET /unknown'));
    expect(res.statusCode).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // POST /auth/sign-up
  // ---------------------------------------------------------------------------

  describe('POST /auth/sign-up', () => {
    it('returns 201 on successful sign-up', async () => {
      cognitoMock.on(SignUpCommand).resolves({ UserSub: 'sub-abc', UserConfirmed: false });
      const res = await handler(makeEvent('POST /auth/sign-up', { email: 'user@test.com', password: 'Pass123!' }));
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.userSub).toBe('sub-abc');
      expect(body.confirmed).toBe(false);
    });

    it('passes displayName to Cognito when provided', async () => {
      cognitoMock.on(SignUpCommand).resolves({ UserSub: 'sub-xyz', UserConfirmed: false });
      await handler(makeEvent('POST /auth/sign-up', { email: 'user@test.com', password: 'Pass123!', displayName: 'Alice' }));
      const call = cognitoMock.calls()[0].args[0].input as any;
      expect(call.UserAttributes).toContainEqual({ Name: 'name', Value: 'Alice' });
    });

    it('returns 400 when email is missing', async () => {
      const res = await handler(makeEvent('POST /auth/sign-up', { password: 'Pass123!' }));
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when password is missing', async () => {
      const res = await handler(makeEvent('POST /auth/sign-up', { email: 'user@test.com' }));
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when body is missing', async () => {
      const res = await handler(makeEvent('POST /auth/sign-up'));
      expect(res.statusCode).toBe(400);
    });

    it('returns 409 for UsernameExistsException', async () => {
      cognitoMock.on(SignUpCommand).rejects(new UsernameExistsException({ message: 'exists', $metadata: {} }));
      const res = await handler(makeEvent('POST /auth/sign-up', { email: 'dup@test.com', password: 'Pass123!' }));
      expect(res.statusCode).toBe(409);
    });

    it('returns 400 for InvalidPasswordException', async () => {
      cognitoMock.on(SignUpCommand).rejects(new InvalidPasswordException({ message: 'weak', $metadata: {} }));
      const res = await handler(makeEvent('POST /auth/sign-up', { email: 'user@test.com', password: 'weak' }));
      expect(res.statusCode).toBe(400);
    });

    it('returns 429 for LimitExceededException', async () => {
      cognitoMock.on(SignUpCommand).rejects(new LimitExceededException({ message: 'limit', $metadata: {} }));
      const res = await handler(makeEvent('POST /auth/sign-up', { email: 'user@test.com', password: 'Pass123!' }));
      expect(res.statusCode).toBe(429);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/confirm
  // ---------------------------------------------------------------------------

  describe('POST /auth/confirm', () => {
    it('returns 200 on successful confirmation', async () => {
      cognitoMock.on(ConfirmSignUpCommand).resolves({});
      const res = await handler(makeEvent('POST /auth/confirm', { email: 'user@test.com', confirmationCode: '123456' }));
      expect(res.statusCode).toBe(200);
    });

    it('returns 400 when confirmationCode is missing', async () => {
      const res = await handler(makeEvent('POST /auth/confirm', { email: 'user@test.com' }));
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for CodeMismatchException', async () => {
      cognitoMock.on(ConfirmSignUpCommand).rejects(new CodeMismatchException({ message: 'mismatch', $metadata: {} }));
      const res = await handler(makeEvent('POST /auth/confirm', { email: 'user@test.com', confirmationCode: 'wrong' }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/confirmation code/i);
    });

    it('returns 400 for ExpiredCodeException', async () => {
      cognitoMock.on(ConfirmSignUpCommand).rejects(new ExpiredCodeException({ message: 'expired', $metadata: {} }));
      const res = await handler(makeEvent('POST /auth/confirm', { email: 'user@test.com', confirmationCode: 'old' }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/expired/i);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/sign-in
  // ---------------------------------------------------------------------------

  describe('POST /auth/sign-in', () => {
    it('returns 200 with tokens on successful sign-in', async () => {
      cognitoMock.on(InitiateAuthCommand).resolves({
        AuthenticationResult: {
          IdToken: 'id-token',
          AccessToken: 'access-token',
          RefreshToken: 'refresh-token',
          ExpiresIn: 3600,
        },
      });
      const res = await handler(makeEvent('POST /auth/sign-in', { email: 'user@test.com', password: 'Pass123!' }));
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({ idToken: 'id-token', accessToken: 'access-token', refreshToken: 'refresh-token' });
    });

    it('returns 401 when Cognito returns no AuthenticationResult', async () => {
      cognitoMock.on(InitiateAuthCommand).resolves({ AuthenticationResult: undefined });
      const res = await handler(makeEvent('POST /auth/sign-in', { email: 'user@test.com', password: 'Pass123!' }));
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 for NotAuthorizedException', async () => {
      cognitoMock.on(InitiateAuthCommand).rejects(new NotAuthorizedException({ message: 'bad creds', $metadata: {} }));
      const res = await handler(makeEvent('POST /auth/sign-in', { email: 'user@test.com', password: 'wrong' }));
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 for UserNotFoundException', async () => {
      cognitoMock.on(InitiateAuthCommand).rejects(new UserNotFoundException({ message: 'not found', $metadata: {} }));
      const res = await handler(makeEvent('POST /auth/sign-in', { email: 'missing@test.com', password: 'Pass123!' }));
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 when email is missing', async () => {
      const res = await handler(makeEvent('POST /auth/sign-in', { password: 'Pass123!' }));
      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/refresh
  // ---------------------------------------------------------------------------

  describe('POST /auth/refresh', () => {
    it('returns 200 with new tokens on success', async () => {
      cognitoMock.on(InitiateAuthCommand).resolves({
        AuthenticationResult: {
          IdToken: 'new-id-token',
          AccessToken: 'new-access-token',
          ExpiresIn: 3600,
        },
      });
      const res = await handler(makeEvent('POST /auth/refresh', { refreshToken: 'valid-refresh-token' }));
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({ idToken: 'new-id-token', accessToken: 'new-access-token' });
      // Refresh endpoint must NOT leak a new refresh token
      expect(body.refreshToken).toBeUndefined();
    });

    it('returns 401 when Cognito returns no AuthenticationResult', async () => {
      cognitoMock.on(InitiateAuthCommand).resolves({ AuthenticationResult: undefined });
      const res = await handler(makeEvent('POST /auth/refresh', { refreshToken: 'stale-token' }));
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when refreshToken is missing', async () => {
      const res = await handler(makeEvent('POST /auth/refresh', {}));
      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/sign-out
  // ---------------------------------------------------------------------------

  describe('POST /auth/sign-out', () => {
    it('returns 200 on successful sign-out', async () => {
      cognitoMock.on(GlobalSignOutCommand).resolves({});
      const res = await handler(makeEvent('POST /auth/sign-out', { accessToken: 'valid-access-token' }));
      expect(res.statusCode).toBe(200);
    });

    it('returns 400 when accessToken is missing', async () => {
      const res = await handler(makeEvent('POST /auth/sign-out', {}));
      expect(res.statusCode).toBe(400);
    });

    it('returns 401 for NotAuthorizedException', async () => {
      cognitoMock.on(GlobalSignOutCommand).rejects(new NotAuthorizedException({ message: 'bad token', $metadata: {} }));
      const res = await handler(makeEvent('POST /auth/sign-out', { accessToken: 'expired-token' }));
      expect(res.statusCode).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/forgot-password
  // ---------------------------------------------------------------------------

  describe('POST /auth/forgot-password', () => {
    it('returns 200 on success', async () => {
      cognitoMock.on(ForgotPasswordCommand).resolves({});
      const res = await handler(makeEvent('POST /auth/forgot-password', { email: 'user@test.com' }));
      expect(res.statusCode).toBe(200);
    });

    it('returns 200 even for UserNotFoundException (anti-enumeration)', async () => {
      cognitoMock.on(ForgotPasswordCommand).rejects(new UserNotFoundException({ message: 'not found', $metadata: {} }));
      const res = await handler(makeEvent('POST /auth/forgot-password', { email: 'ghost@test.com' }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).message).toMatch(/if an account/i);
    });

    it('returns 200 even for NotAuthorizedException (anti-enumeration)', async () => {
      cognitoMock.on(ForgotPasswordCommand).rejects(new NotAuthorizedException({ message: 'not authorized', $metadata: {} }));
      const res = await handler(makeEvent('POST /auth/forgot-password', { email: 'user@test.com' }));
      expect(res.statusCode).toBe(200);
    });

    it('returns 400 when email is missing', async () => {
      const res = await handler(makeEvent('POST /auth/forgot-password', {}));
      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/confirm-forgot-password
  // ---------------------------------------------------------------------------

  describe('POST /auth/confirm-forgot-password', () => {
    it('returns 200 on success', async () => {
      cognitoMock.on(ConfirmForgotPasswordCommand).resolves({});
      const res = await handler(
        makeEvent('POST /auth/confirm-forgot-password', {
          email: 'user@test.com',
          confirmationCode: '123456',
          newPassword: 'NewPass123!',
        }),
      );
      expect(res.statusCode).toBe(200);
    });

    it('returns 400 when newPassword is missing', async () => {
      const res = await handler(
        makeEvent('POST /auth/confirm-forgot-password', { email: 'user@test.com', confirmationCode: '123456' }),
      );
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for CodeMismatchException', async () => {
      cognitoMock
        .on(ConfirmForgotPasswordCommand)
        .rejects(new CodeMismatchException({ message: 'mismatch', $metadata: {} }));
      const res = await handler(
        makeEvent('POST /auth/confirm-forgot-password', {
          email: 'user@test.com',
          confirmationCode: 'wrong',
          newPassword: 'NewPass123!',
        }),
      );
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for InvalidPasswordException', async () => {
      cognitoMock
        .on(ConfirmForgotPasswordCommand)
        .rejects(new InvalidPasswordException({ message: 'weak', $metadata: {} }));
      const res = await handler(
        makeEvent('POST /auth/confirm-forgot-password', {
          email: 'user@test.com',
          confirmationCode: '123456',
          newPassword: 'weak',
        }),
      );
      expect(res.statusCode).toBe(400);
    });
  });
});
