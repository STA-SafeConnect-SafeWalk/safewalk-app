import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from '../live-location-handler/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

jest.mock('https', () => {
  const actual = jest.requireActual('https');
  return { ...actual, request: jest.fn() };
});
jest.mock('http', () => {
  const actual = jest.requireActual('http');
  return { ...actual, request: jest.fn() };
});

const mockHttpsRequest = require('https').request as jest.Mock;

function setupHttpsMock(statusCode: number, responseBody: any) {
  mockHttpsRequest.mockImplementation((_opts: any, callback: any) => {
    const res: { statusCode: number; on: jest.Mock } = {
      statusCode,
      on: jest.fn(),
    };
    res.on.mockImplementation((event: string, fn: any) => {
      if (event === 'data') fn(JSON.stringify(responseBody));
      if (event === 'end') fn();
      return res;
    });
    callback(res);
    return {
      on: jest.fn(),
      setTimeout: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };
  });
}

describe('live-location-handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    ddbMock.reset();
    mockHttpsRequest.mockReset();
    process.env = { ...originalEnv };
    process.env.LIVE_LOCATIONS_TABLE_NAME = 'LiveLocations';
    process.env.APP_USERS_TABLE_NAME = 'AppUsers';
    process.env.PLATFORM_DOMAIN = 'https://platform.example.com';
    process.env.API_KEY = 'test-api-key';
    process.env.LOCATION_TTL_SECONDS = '120';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const generateApiGatewayEvent = (
    method: string,
    path: string,
    body?: any,
    pathParameters?: any,
    userId: string = 'user-123',
  ): APIGatewayProxyEventV2 => {
    let routeKeyPath = path;
    if (pathParameters) {
      for (const [key, value] of Object.entries(pathParameters)) {
        routeKeyPath = routeKeyPath.replace(value as string, `{${key}}`);
      }
    }
    return {
      version: '2.0',
      routeKey: `${method} ${routeKeyPath}`,
      rawPath: path,
      rawQueryString: '',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      pathParameters,
      requestContext: {
        http: { method, path, protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
        authorizer: {
          jwt: {
            claims: { sub: userId },
            scopes: [],
          },
        },
      } as any,
    } as any;
  };

  const validLocation = { lat: 48.1351, lng: 11.582, accuracy: 15 };

  // -----------------------------------------------------------------------
  // PUT /location
  // -----------------------------------------------------------------------

  describe('PUT /location', () => {
    it('should store location and return 200', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-abc' },
      });
      ddbMock.on(PutCommand).resolves({});

      const event = generateApiGatewayEvent('PUT', '/location', validLocation);
      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.safeWalkId).toBe('sw-abc');
      expect(body.lat).toBe(48.1351);
      expect(body.lng).toBe(11.582);
      expect(body.accuracy).toBe(15);
      expect(body.expiresAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();
    });

    it('should return 400 for missing fields', async () => {
      const event = generateApiGatewayEvent('PUT', '/location', { lat: 48 });
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-abc' },
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 400 for invalid lat range', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-abc' },
      });

      const event = generateApiGatewayEvent('PUT', '/location', {
        lat: 91,
        lng: 11,
        accuracy: 10,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 400 for invalid lng range', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-abc' },
      });

      const event = generateApiGatewayEvent('PUT', '/location', {
        lat: 48,
        lng: 181,
        accuracy: 10,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 400 for negative accuracy', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-abc' },
      });

      const event = generateApiGatewayEvent('PUT', '/location', {
        lat: 48,
        lng: 11,
        accuracy: -5,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 401 for unauthenticated user', async () => {
      const event = generateApiGatewayEvent('PUT', '/location', validLocation, undefined, '');
      (event.requestContext as any).authorizer = undefined;
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
    });

    it('should return 400 if user not registered on platform', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123' },
      });

      const event = generateApiGatewayEvent('PUT', '/location', validLocation);
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 400 for invalid JSON body', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-abc' },
      });

      const event = generateApiGatewayEvent('PUT', '/location');
      event.body = 'not-json';
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /location
  // -----------------------------------------------------------------------

  describe('DELETE /location', () => {
    it('should delete location and return 204', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-abc' },
      });
      ddbMock.on(DeleteCommand).resolves({});

      const event = generateApiGatewayEvent('DELETE', '/location');
      const result = await handler(event);
      expect(result.statusCode).toBe(204);
    });

    it('should return 401 for unauthenticated user', async () => {
      const event = generateApiGatewayEvent('DELETE', '/location');
      (event.requestContext as any).authorizer = undefined;
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // GET /location/contacts
  // -----------------------------------------------------------------------

  describe('GET /location/contacts', () => {
    const platformContactsResponse = {
      success: true,
      data: {
        contacts: [
          {
            contactId: 'c1',
            status: 'active',
            requesterSafeWalkId: 'sw-abc',
            targetSafeWalkId: 'sw-contact1',
            platformId: 'p1',
            locationSharing: true,
            sosSharing: true,
            direction: 'outgoing',
            peerName: 'Contact One',
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          },
          {
            contactId: 'c2',
            status: 'active',
            requesterSafeWalkId: 'sw-abc',
            targetSafeWalkId: 'sw-contact2',
            platformId: 'p1',
            locationSharing: false,
            sosSharing: true,
            direction: 'outgoing',
            peerName: 'Contact Two',
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          },
        ],
      },
    };

    it('should return locations for contacts who share location', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-abc' },
      });

      setupHttpsMock(200, platformContactsResponse);

      const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
      ddbMock.on(BatchGetCommand).resolves({
        Responses: {
          LiveLocations: [
            {
              safeWalkId: 'sw-contact1',
              lat: 48.137,
              lng: 11.576,
              accuracy: 10,
              updatedAt: '2026-04-22T14:00:00Z',
              expiresAt: futureExpiry,
            },
          ],
        },
      });

      const event = generateApiGatewayEvent('GET', '/location/contacts');
      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.locations).toHaveLength(1);
      expect(body.locations[0].safeWalkId).toBe('sw-contact1');
      expect(body.locations[0].displayName).toBe('Contact One');
      expect(body.locations[0].lat).toBe(48.137);
    });

    it('should NOT include contacts with locationSharing=false', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-abc' },
      });

      setupHttpsMock(200, platformContactsResponse);

      const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
      ddbMock.on(BatchGetCommand).resolves({
        Responses: {
          LiveLocations: [
            {
              safeWalkId: 'sw-contact1',
              lat: 48.137,
              lng: 11.576,
              accuracy: 10,
              updatedAt: '2026-04-22T14:00:00Z',
              expiresAt: futureExpiry,
            },
          ],
        },
      });

      const event = generateApiGatewayEvent('GET', '/location/contacts');
      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(body.locations).toHaveLength(1);
      // sw-contact2 should NOT be included (locationSharing=false)
      expect(body.locations.find((l: any) => l.safeWalkId === 'sw-contact2')).toBeUndefined();
    });

    it('should filter out expired locations', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-abc' },
      });

      setupHttpsMock(200, {
        success: true,
        data: {
          contacts: [
            {
              contactId: 'c1',
              status: 'active',
              requesterSafeWalkId: 'sw-abc',
              targetSafeWalkId: 'sw-contact1',
              platformId: 'p1',
              locationSharing: true,
              sosSharing: true,
              direction: 'outgoing',
              peerName: 'Contact One',
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01',
            },
          ],
        },
      });

      const pastExpiry = Math.floor(Date.now() / 1000) - 60;
      ddbMock.on(BatchGetCommand).resolves({
        Responses: {
          LiveLocations: [
            {
              safeWalkId: 'sw-contact1',
              lat: 48.137,
              lng: 11.576,
              accuracy: 10,
              updatedAt: '2026-04-22T14:00:00Z',
              expiresAt: pastExpiry,
            },
          ],
        },
      });

      const event = generateApiGatewayEvent('GET', '/location/contacts');
      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.locations).toHaveLength(0);
    });

    it('should return empty array when no contacts share location', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-abc' },
      });

      setupHttpsMock(200, {
        success: true,
        data: { contacts: [] },
      });

      const event = generateApiGatewayEvent('GET', '/location/contacts');
      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.locations).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // GET /location/contacts/{safeWalkId}
  // -----------------------------------------------------------------------

  describe('GET /location/contacts/{safeWalkId}', () => {
    it('should return a single contact location', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-abc' },
      });

      setupHttpsMock(200, {
        success: true,
        data: {
          contacts: [
            {
              contactId: 'c1',
              status: 'active',
              requesterSafeWalkId: 'sw-abc',
              targetSafeWalkId: 'sw-target',
              platformId: 'p1',
              locationSharing: true,
              sosSharing: true,
              direction: 'outgoing',
              peerName: 'Target User',
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01',
            },
          ],
        },
      });

      const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
      ddbMock.on(GetCommand, { TableName: 'LiveLocations' }).resolves({
        Item: {
          safeWalkId: 'sw-target',
          lat: 48.137,
          lng: 11.576,
          accuracy: 10,
          updatedAt: '2026-04-22T14:00:00Z',
          expiresAt: futureExpiry,
        },
      });

      const event = generateApiGatewayEvent(
        'GET',
        '/location/contacts/sw-target',
        undefined,
        { safeWalkId: 'sw-target' },
      );
      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.safeWalkId).toBe('sw-target');
      expect(body.displayName).toBe('Target User');
    });

    it('should return 404 if contact does not share location', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-abc' },
      });

      setupHttpsMock(200, {
        success: true,
        data: {
          contacts: [
            {
              contactId: 'c1',
              status: 'active',
              requesterSafeWalkId: 'sw-abc',
              targetSafeWalkId: 'sw-target',
              platformId: 'p1',
              locationSharing: false,
              sosSharing: true,
              direction: 'outgoing',
              peerName: 'Target User',
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01',
            },
          ],
        },
      });

      const event = generateApiGatewayEvent(
        'GET',
        '/location/contacts/sw-target',
        undefined,
        { safeWalkId: 'sw-target' },
      );
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });

    it('should return 404 if contact location has expired', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-abc' },
      });

      setupHttpsMock(200, {
        success: true,
        data: {
          contacts: [
            {
              contactId: 'c1',
              status: 'active',
              requesterSafeWalkId: 'sw-abc',
              targetSafeWalkId: 'sw-target',
              platformId: 'p1',
              locationSharing: true,
              sosSharing: true,
              direction: 'outgoing',
              peerName: 'Target User',
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01',
            },
          ],
        },
      });

      const pastExpiry = Math.floor(Date.now() / 1000) - 60;
      ddbMock.on(GetCommand, { TableName: 'LiveLocations' }).resolves({
        Item: {
          safeWalkId: 'sw-target',
          lat: 48.137,
          lng: 11.576,
          accuracy: 10,
          updatedAt: '2026-04-22T14:00:00Z',
          expiresAt: pastExpiry,
        },
      });

      const event = generateApiGatewayEvent(
        'GET',
        '/location/contacts/sw-target',
        undefined,
        { safeWalkId: 'sw-target' },
      );
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });

    it('should return 404 if contact is not sharing at all', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-abc' },
      });

      setupHttpsMock(200, {
        success: true,
        data: {
          contacts: [
            {
              contactId: 'c1',
              status: 'active',
              requesterSafeWalkId: 'sw-abc',
              targetSafeWalkId: 'sw-target',
              platformId: 'p1',
              locationSharing: true,
              sosSharing: true,
              direction: 'outgoing',
              peerName: 'Target User',
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01',
            },
          ],
        },
      });

      ddbMock.on(GetCommand, { TableName: 'LiveLocations' }).resolves({
        Item: undefined,
      });

      const event = generateApiGatewayEvent(
        'GET',
        '/location/contacts/sw-target',
        undefined,
        { safeWalkId: 'sw-target' },
      );
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // Unknown route
  // -----------------------------------------------------------------------

  describe('Unknown route', () => {
    it('should return 404', async () => {
      const event = generateApiGatewayEvent('POST', '/unknown');
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });
  });
});
