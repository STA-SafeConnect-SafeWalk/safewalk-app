import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { handler as _handler } from '../user-profile-handler/index';
const handler = _handler as (event: any) => Promise<any>;

const ddbMock = mockClient(DynamoDBDocumentClient);
const cognitoMock = mockClient(CognitoIdentityProviderClient);

jest.mock('https', () => {
  const actual = jest.requireActual('https');
  return { ...actual, request: jest.fn() };
});
jest.mock('http', () => {
  const actual = jest.requireActual('http');
  return { ...actual, request: jest.fn() };
});

const mockHttpsRequest = require('https').request as jest.Mock;

function setupHttpsMock(statusCode: number, responseBody: unknown) {
  mockHttpsRequest.mockImplementation((_opts: unknown, callback: (res: any) => void) => {
    const res = { statusCode, on: jest.fn() };
    res.on.mockImplementation((event: string, fn: (data?: unknown) => void) => {
      if (event === 'data') fn(JSON.stringify(responseBody));
      if (event === 'end') fn();
      return res;
    });
    callback(res);
    return { on: jest.fn(), setTimeout: jest.fn(), write: jest.fn(), end: jest.fn(), destroy: jest.fn() };
  });
}

const makeEvent = (
  routeKey: string,
  userId = 'cognito-user-123',
  body?: unknown,
  pathParameters?: Record<string, string>,
) =>
  ({
    routeKey,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    pathParameters: pathParameters ?? {},
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId } } },
    },
    headers: {},
    isBase64Encoded: false,
    rawPath: '',
    rawQueryString: '',
    version: '2.0',
  }) as any;

const makeUnauthEvent = (routeKey: string) =>
  ({
    routeKey,
    body: undefined,
    pathParameters: {},
    requestContext: {},
    headers: {},
    isBase64Encoded: false,
    rawPath: '',
    rawQueryString: '',
    version: '2.0',
  }) as any;

describe('user-profile-handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    ddbMock.reset();
    cognitoMock.reset();
    mockHttpsRequest.mockReset();
    process.env = {
      ...originalEnv,
      TABLE_NAME: 'AppUsers',
      PLATFORM_DOMAIN: 'https://platform.example.com',
      VENDOR_ID: 'vendor-001',
      API_KEY: 'test-api-key',
      COGNITO_USER_POOL_ID: 'us-east-1_TestPool',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ---------------------------------------------------------------------------
  // Configuration guards
  // ---------------------------------------------------------------------------

  it('returns 500 when TABLE_NAME is missing', async () => {
    delete process.env.TABLE_NAME;
    const res = await handler(makeEvent('GET /me'));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/TABLE_NAME/);
  });

  it('returns 404 for unknown route', async () => {
    const res = await handler(makeEvent('GET /unknown'));
    expect(res.statusCode).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // GET /me
  // ---------------------------------------------------------------------------

  describe('GET /me', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await handler(makeUnauthEvent('GET /me'));
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 when user profile does not exist', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      const res = await handler(makeEvent('GET /me'));
      expect(res.statusCode).toBe(404);
    });

    it('returns 200 with profile data', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { safeWalkAppId: 'cognito-user-123', email: 'u@test.com', displayName: 'Alice', safeWalkId: 'sw-1' },
      });
      const res = await handler(makeEvent('GET /me'));
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({ userId: 'cognito-user-123', email: 'u@test.com', hasPlatformRegistration: true });
    });

    it('returns hasPlatformRegistration=false when safeWalkId is absent', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { safeWalkAppId: 'cognito-user-123', email: 'u@test.com' },
      });
      const res = await handler(makeEvent('GET /me'));
      expect(JSON.parse(res.body).hasPlatformRegistration).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /register
  // ---------------------------------------------------------------------------

  describe('POST /register', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await handler(makeUnauthEvent('POST /register'));
      expect(res.statusCode).toBe(401);
    });

    it('returns 500 when PLATFORM_DOMAIN is missing', async () => {
      delete process.env.PLATFORM_DOMAIN;
      const res = await handler(makeEvent('POST /register'));
      expect(res.statusCode).toBe(500);
    });

    it('creates a new profile and registers on platform (201)', async () => {
      ddbMock
        .on(GetCommand)
        .resolvesOnce({ Item: undefined })
        .resolvesOnce({ Item: { safeWalkAppId: 'cognito-user-123' } });
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(UpdateCommand).resolves({});

      let callCount = 0;
      mockHttpsRequest.mockImplementation((_opts: unknown, callback: (res: any) => void) => {
        callCount++;
        const responseBody =
          callCount === 1
            ? { success: true, data: { safeWalkId: 'sw-new-1' } }
            : { success: true, data: { sharingCode: 'CODE123', safeWalkId: 'sw-new-1', expiresAt: '2099-01-01T00:00:00Z' } };
        const res = { statusCode: 200, on: jest.fn() };
        res.on.mockImplementation((event: string, fn: (data?: unknown) => void) => {
          if (event === 'data') fn(JSON.stringify(responseBody));
          if (event === 'end') fn();
          return res;
        });
        callback(res);
        return { on: jest.fn(), setTimeout: jest.fn(), write: jest.fn(), end: jest.fn(), destroy: jest.fn() };
      });

      const res = await handler(makeEvent('POST /register', 'cognito-user-123', { displayName: 'Alice' }));
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.sharingCode).toBe('CODE123');
    });

    it('returns 200 for an existing profile with a valid sharing code', async () => {
      const futureExpiry = new Date(Date.now() + 3_600_000).toISOString();
      ddbMock
        .on(GetCommand)
        .resolvesOnce({ Item: { safeWalkAppId: 'cognito-user-123' } })
        .resolvesOnce({
          Item: {
            safeWalkAppId: 'cognito-user-123',
            safeWalkId: 'sw-existing',
            sharingCode: 'EXISTCODE',
            sharingCodeExpiresAt: futureExpiry,
          },
        });

      const res = await handler(makeEvent('POST /register'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).sharingCode).toBe('EXISTCODE');
    });

    it('returns partial success when platform registration fails', async () => {
      ddbMock
        .on(GetCommand)
        .resolvesOnce({ Item: undefined })
        .resolvesOnce({ Item: { safeWalkAppId: 'cognito-user-123' } });
      ddbMock.on(PutCommand).resolves({});
      setupHttpsMock(500, { error: 'internal' });

      const res = await handler(makeEvent('POST /register'));
      expect(res.statusCode).toBe(201);
      expect(JSON.parse(res.body).platformRegistrationError).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // GET /sharing-code
  // ---------------------------------------------------------------------------

  describe('GET /sharing-code', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await handler(makeUnauthEvent('GET /sharing-code'));
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 when user not found', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      const res = await handler(makeEvent('GET /sharing-code'));
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when no sharing code is stored', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { safeWalkAppId: 'cognito-user-123' } });
      const res = await handler(makeEvent('GET /sharing-code'));
      expect(res.statusCode).toBe(404);
    });

    it('returns 200 with sharing code', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { safeWalkAppId: 'cognito-user-123', sharingCode: 'SC123', sharingCodeExpiresAt: '2099-01-01T00:00:00Z' },
      });
      const res = await handler(makeEvent('GET /sharing-code'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ sharingCode: 'SC123', sharingCodeExpiresAt: '2099-01-01T00:00:00Z' });
    });
  });

  // ---------------------------------------------------------------------------
  // POST /sharing-code
  // ---------------------------------------------------------------------------

  describe('POST /sharing-code', () => {
    it('returns 400 when user has no safeWalkId', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { safeWalkAppId: 'cognito-user-123' } });
      const res = await handler(makeEvent('POST /sharing-code'));
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 with new sharing code on success', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { safeWalkAppId: 'cognito-user-123', safeWalkId: 'sw-1' } });
      ddbMock.on(UpdateCommand).resolves({});
      setupHttpsMock(200, {
        success: true,
        data: { sharingCode: 'NEWCODE', safeWalkId: 'sw-1', expiresAt: '2099-01-01T00:00:00Z' },
      });

      const res = await handler(makeEvent('POST /sharing-code'));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).sharingCode).toBe('NEWCODE');
    });

    it('returns 502 when platform returns invalid response', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { safeWalkAppId: 'cognito-user-123', safeWalkId: 'sw-1' } });
      setupHttpsMock(200, { success: false });

      const res = await handler(makeEvent('POST /sharing-code'));
      expect(res.statusCode).toBe(502);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /sharing-code/connect
  // ---------------------------------------------------------------------------

  describe('POST /sharing-code/connect', () => {
    it('returns 400 when sharingCode is missing', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { safeWalkAppId: 'cognito-user-123', safeWalkId: 'sw-1' } });
      const res = await handler(makeEvent('POST /sharing-code/connect', 'cognito-user-123', {}));
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 on successful connection', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { safeWalkAppId: 'cognito-user-123', safeWalkId: 'sw-1' } });
      setupHttpsMock(200, { success: true, data: {} });

      const res = await handler(makeEvent('POST /sharing-code/connect', 'cognito-user-123', { sharingCode: 'PEERCODE' }));
      expect(res.statusCode).toBe(200);
    });

    it('returns 502 when platform rejects', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { safeWalkAppId: 'cognito-user-123', safeWalkId: 'sw-1' } });
      setupHttpsMock(200, { success: false });

      const res = await handler(makeEvent('POST /sharing-code/connect', 'cognito-user-123', { sharingCode: 'BADCODE' }));
      expect(res.statusCode).toBe(502);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /contacts
  // ---------------------------------------------------------------------------

  describe('GET /contacts', () => {
    it('returns 400 when user has no safeWalkId', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { safeWalkAppId: 'cognito-user-123' } });
      const res = await handler(makeEvent('GET /contacts'));
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 with contacts list', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { safeWalkAppId: 'cognito-user-123', safeWalkId: 'sw-1' } });
      setupHttpsMock(200, {
        success: true,
        data: {
          contacts: [
            {
              contactId: 'c1',
              status: 'accepted',
              targetSafeWalkId: 'sw-2',
              requesterSafeWalkId: 'sw-1',
              platformId: 'p1',
              locationSharing: true,
              sosSharing: true,
              direction: 'outgoing',
              peerName: 'Bob',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
          ],
        },
      });

      const res = await handler(makeEvent('GET /contacts'));
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.contacts).toHaveLength(1);
      expect(body.contacts[0]).toMatchObject({ safeWalkId: 'sw-2', displayName: 'Bob' });
    });

    it('merges outgoing and incoming entries for the same partner', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { safeWalkAppId: 'cognito-user-123', safeWalkId: 'sw-1' } });
      setupHttpsMock(200, {
        success: true,
        data: {
          contacts: [
            {
              contactId: 'c-out',
              status: 'accepted',
              targetSafeWalkId: 'sw-peer',
              requesterSafeWalkId: 'sw-1',
              platformId: 'p1',
              locationSharing: true,
              sosSharing: false,
              direction: 'outgoing',
              peerName: 'Peer',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
            {
              contactId: 'c-in',
              status: 'accepted',
              targetSafeWalkId: 'sw-1',
              requesterSafeWalkId: 'sw-peer',
              platformId: 'p2',
              locationSharing: false,
              sosSharing: true,
              direction: 'incoming',
              peerName: 'Peer',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
          ],
        },
      });

      const res = await handler(makeEvent('GET /contacts'));
      const body = JSON.parse(res.body);
      expect(body.contacts).toHaveLength(1);
      const contact = body.contacts[0];
      expect(contact.safeWalkId).toBe('sw-peer');
      expect(contact.isOutgoing).toBe(true);
      expect(contact.sharesBackLocation).toBe(true); // outgoing entry
      expect(contact.locationSharing).toBe(false); // incoming entry
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /contacts/{contactId}
  // ---------------------------------------------------------------------------

  describe('PATCH /contacts/{contactId}', () => {
    it('returns 400 when contactId path parameter is missing', async () => {
      const res = await handler(
        makeEvent('PATCH /contacts/{contactId}', 'cognito-user-123', { locationSharing: true, sosSharing: false }),
      );
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when locationSharing is not boolean', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { safeWalkAppId: 'cognito-user-123', safeWalkId: 'sw-1' } });
      const res = await handler(
        makeEvent(
          'PATCH /contacts/{contactId}',
          'cognito-user-123',
          { locationSharing: 'yes', sosSharing: false },
          { contactId: 'c1' },
        ),
      );
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 when update succeeds', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { safeWalkAppId: 'cognito-user-123', safeWalkId: 'sw-1' } });
      setupHttpsMock(200, { success: true, data: {} });

      const res = await handler(
        makeEvent(
          'PATCH /contacts/{contactId}',
          'cognito-user-123',
          { locationSharing: true, sosSharing: false },
          { contactId: 'c1' },
        ),
      );
      expect(res.statusCode).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /contacts/{contactId}
  // ---------------------------------------------------------------------------

  describe('DELETE /contacts/{contactId}', () => {
    it('returns 400 when contactId path parameter is missing', async () => {
      const res = await handler(makeEvent('DELETE /contacts/{contactId}'));
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 on successful deletion', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { safeWalkAppId: 'cognito-user-123', safeWalkId: 'sw-1' } });
      setupHttpsMock(200, { success: true, data: {} });

      const res = await handler(
        makeEvent('DELETE /contacts/{contactId}', 'cognito-user-123', undefined, { contactId: 'c1' }),
      );
      expect(res.statusCode).toBe(200);
    });

    it('returns 502 when platform rejects deletion', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { safeWalkAppId: 'cognito-user-123', safeWalkId: 'sw-1' } });
      setupHttpsMock(200, { success: false });

      const res = await handler(
        makeEvent('DELETE /contacts/{contactId}', 'cognito-user-123', undefined, { contactId: 'c1' }),
      );
      expect(res.statusCode).toBe(502);
    });
  });

  // PATCH /me
  describe('PATCH /me', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await handler(makeUnauthEvent('PATCH /me'));
      expect(res.statusCode).toBe(401);
    });

    it('returns 500 when COGNITO_USER_POOL_ID is missing', async () => {
      delete process.env.COGNITO_USER_POOL_ID;
      const res = await handler(makeEvent('PATCH /me', 'cognito-user-123', { displayName: 'Alice' }));
      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).error).toMatch(/COGNITO_USER_POOL_ID/);
    });

    it('returns 400 when body is missing', async () => {
      const res = await handler(makeEvent('PATCH /me'));
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when displayName is missing from body', async () => {
      const res = await handler(makeEvent('PATCH /me', 'cognito-user-123', {}));
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when displayName is empty', async () => {
      const res = await handler(makeEvent('PATCH /me', 'cognito-user-123', { displayName: '   ' }));
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when user profile does not exist', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      const res = await handler(makeEvent('PATCH /me', 'cognito-user-123', { displayName: 'Alice' }));
      expect(res.statusCode).toBe(404);
    });

    it('returns 200 and updates displayName', async () => {
      ddbMock
        .on(GetCommand)
        .resolves({ Item: { safeWalkAppId: 'cognito-user-123', email: 'alice@test.com', displayName: 'Old Name' } });
      ddbMock.on(UpdateCommand).resolves({});
      cognitoMock.on(AdminUpdateUserAttributesCommand).resolves({});

      const res = await handler(makeEvent('PATCH /me', 'cognito-user-123', { displayName: '  Alice  ' }));
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.displayName).toBe('Alice');
    });

    it('returns 200 even when Cognito update fails (non-fatal)', async () => {
      ddbMock
        .on(GetCommand)
        .resolves({ Item: { safeWalkAppId: 'cognito-user-123', email: 'alice@test.com' } });
      ddbMock.on(UpdateCommand).resolves({});
      cognitoMock.on(AdminUpdateUserAttributesCommand).rejects(new Error('Cognito error'));

      const res = await handler(makeEvent('PATCH /me', 'cognito-user-123', { displayName: 'Alice' }));
      expect(res.statusCode).toBe(200);
    });
  });

  // DELETE /me
  describe('DELETE /me', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await handler(makeUnauthEvent('DELETE /me'));
      expect(res.statusCode).toBe(401);
    });

    it('returns 500 when COGNITO_USER_POOL_ID is missing', async () => {
      delete process.env.COGNITO_USER_POOL_ID;
      const res = await handler(makeEvent('DELETE /me'));
      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).error).toMatch(/COGNITO_USER_POOL_ID/);
    });

    it('returns 404 when user profile does not exist', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      const res = await handler(makeEvent('DELETE /me'));
      expect(res.statusCode).toBe(404);
    });

    it('returns 204 and deletes user from DynamoDB and Cognito', async () => {
      ddbMock
        .on(GetCommand)
        .resolves({ Item: { safeWalkAppId: 'cognito-user-123', email: 'alice@test.com' } });
      ddbMock.on(DeleteCommand).resolves({});
      cognitoMock.on(AdminDeleteUserCommand).resolves({});

      const res = await handler(makeEvent('DELETE /me'));
      expect(res.statusCode).toBe(204);
    });

    it('returns 204 even when Cognito delete fails (non-fatal)', async () => {
      ddbMock
        .on(GetCommand)
        .resolves({ Item: { safeWalkAppId: 'cognito-user-123', email: 'alice@test.com' } });
      ddbMock.on(DeleteCommand).resolves({});
      cognitoMock.on(AdminDeleteUserCommand).rejects(new Error('Cognito error'));

      const res = await handler(makeEvent('DELETE /me'));
      expect(res.statusCode).toBe(204);
    });

    it('returns 500 when DynamoDB delete fails', async () => {
      ddbMock
        .on(GetCommand)
        .resolves({ Item: { safeWalkAppId: 'cognito-user-123', email: 'alice@test.com' } });
      ddbMock.on(DeleteCommand).rejects(new Error('DynamoDB error'));

      const res = await handler(makeEvent('DELETE /me'));
      expect(res.statusCode).toBe(500);
    });
  });
});
