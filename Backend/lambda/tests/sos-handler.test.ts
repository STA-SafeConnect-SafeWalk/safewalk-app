import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { APIGatewayProxyEventV2, SQSEvent } from 'aws-lambda';
import { handler } from '../sos-handler/index';

const ddbMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

// Mock http/https for platform calls — preserve originals so AWS SDK internals still work
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

describe('sos-handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    ddbMock.reset();
    sqsMock.reset();
    mockHttpsRequest.mockReset();
    process.env = { ...originalEnv };
    process.env.SOS_TABLE_NAME = 'AppSOSEvents';
    process.env.APP_USERS_TABLE_NAME = 'AppUsers';
    process.env.QUEUE_URL = 'https://sqs.eu-central-1.amazonaws.com/123456789/safewalk-sos-propagation-queue';
    process.env.PLATFORM_DOMAIN = 'https://platform.example.com';
    process.env.API_KEY = 'test-api-key';
    process.env.PROPAGATION_DELAY_SECONDS = '10';
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
    // API Gateway v2 routeKey uses parameterized path (e.g. "PATCH /sos/{sosId}")
    // Replace actual param values with their placeholder names
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

  const generateSQSEvent = (sosId: string): SQSEvent => ({
    Records: [
      {
        messageId: 'msg-1',
        receiptHandle: 'receipt-1',
        body: JSON.stringify({ sosId }),
        attributes: {} as any,
        messageAttributes: {},
        md5OfBody: '',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:eu-central-1:123456789:safewalk-sos-propagation-queue',
        awsRegion: 'eu-central-1',
      },
    ],
  });

  const validGeoLocation = { lat: 48.8566, lng: 2.3522, accuracy: 10 };

  // -----------------------------------------------------------------------
  // POST /sos — Trigger SOS
  // -----------------------------------------------------------------------

  describe('POST /sos', () => {
    it('should create a PENDING SOS and queue propagation', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-id-123' },
      });
      ddbMock.on(QueryCommand).resolves({ Items: [] });
      ddbMock.on(PutCommand).resolves({});
      sqsMock.on(SendMessageCommand).resolves({});

      const event = generateApiGatewayEvent('POST', '/sos', {
        geoLocation: validGeoLocation,
      });

      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('PENDING');
      expect(body.data.sosId).toBeDefined();
      expect(body.data.propagationDelaySeconds).toBe(10);
      expect(body.data.geoLocation).toEqual(validGeoLocation);
    });

    it('should create SOS without geoLocation', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-id-123' },
      });
      ddbMock.on(QueryCommand).resolves({ Items: [] });
      ddbMock.on(PutCommand).resolves({});
      sqsMock.on(SendMessageCommand).resolves({});

      const event = generateApiGatewayEvent('POST', '/sos', {});
      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('PENDING');
      expect(body.data.geoLocation).toBeUndefined();
    });

    it('should return 400 if lat/lng are out of range', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-id-123' },
      });

      const event = generateApiGatewayEvent('POST', '/sos', {
        geoLocation: { lat: 100, lng: 200 },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 400 if user has no safeWalkId', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123' },
      });

      const event = generateApiGatewayEvent('POST', '/sos', {
        geoLocation: validGeoLocation,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 401 if not authenticated', async () => {
      const event = {
        ...generateApiGatewayEvent('POST', '/sos', { geoLocation: validGeoLocation }),
        requestContext: { http: { method: 'POST' }, authorizer: {} } as any,
      } as any;

      const result = await handler(event);
      expect(result.statusCode).toBe(401);
    });

    it('should supersede existing PENDING SOS events', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-id-123' },
      });
      ddbMock.on(QueryCommand).resolves({
        Items: [
          { sosId: 'old-sos-1', status: 'PENDING', userId: 'user-123' },
        ],
      });
      ddbMock.on(UpdateCommand).resolves({});
      ddbMock.on(PutCommand).resolves({});
      sqsMock.on(SendMessageCommand).resolves({});

      const event = generateApiGatewayEvent('POST', '/sos', {
        geoLocation: validGeoLocation,
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(201);
    });

    it('should send SQS message with configured delay', async () => {
      ddbMock.on(GetCommand, { TableName: 'AppUsers' }).resolves({
        Item: { safeWalkAppId: 'user-123', safeWalkId: 'sw-id-123' },
      });
      ddbMock.on(QueryCommand).resolves({ Items: [] });
      ddbMock.on(PutCommand).resolves({});
      sqsMock.on(SendMessageCommand).resolves({});

      const event = generateApiGatewayEvent('POST', '/sos', {
        geoLocation: validGeoLocation,
      });

      await handler(event);

      const sqsCalls = sqsMock.commandCalls(SendMessageCommand);
      expect(sqsCalls.length).toBe(1);
      expect(sqsCalls[0].args[0].input.DelaySeconds).toBe(10);
    });

    it('should return 400 for invalid JSON body', async () => {
      const event = {
        ...generateApiGatewayEvent('POST', '/sos'),
        body: 'not json',
      };

      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 400 when body is missing', async () => {
      const event = {
        ...generateApiGatewayEvent('POST', '/sos'),
        body: undefined,
      };

      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // PATCH /sos/{sosId} — Update location
  // -----------------------------------------------------------------------

  describe('PATCH /sos/{sosId}', () => {
    it('should update geoLocation for a PENDING SOS (local only)', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          sosId: 'sos-1',
          userId: 'user-123',
          status: 'PENDING',
          geoLocation: validGeoLocation,
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      const newGeo = { lat: 48.86, lng: 2.35, accuracy: 5 };
      const event = generateApiGatewayEvent(
        'PATCH',
        '/sos/sos-1',
        { geoLocation: newGeo },
        { sosId: 'sos-1' },
      );

      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('PENDING');
      expect(body.data.platformUpdated).toBe(false);
    });

    it('should update geoLocation and forward to platform for ACTIVE SOS', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          sosId: 'sos-1',
          userId: 'user-123',
          status: 'ACTIVE',
          platformSosId: 'platform-sos-1',
          geoLocation: validGeoLocation,
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      setupHttpsMock(200, {
        success: true,
        data: {
          sosId: 'platform-sos-1',
          status: 'ACTIVE',
          contactsNotified: 2,
          latestGeoLocation: { lat: 48.86, lng: 2.35 },
          updatedAt: new Date().toISOString(),
        },
      });

      const newGeo = { lat: 48.86, lng: 2.35, accuracy: 5 };
      const event = generateApiGatewayEvent(
        'PATCH',
        '/sos/sos-1',
        { geoLocation: newGeo },
        { sosId: 'sos-1' },
      );

      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.data.platformUpdated).toBe(true);
    });

    it('should return 410 for CANCELLED SOS', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { sosId: 'sos-1', userId: 'user-123', status: 'CANCELLED' },
      });

      const event = generateApiGatewayEvent(
        'PATCH',
        '/sos/sos-1',
        { geoLocation: validGeoLocation },
        { sosId: 'sos-1' },
      );

      const result = await handler(event);
      expect(result.statusCode).toBe(410);
    });

    it('should return 404 for non-existent SOS', async () => {
      ddbMock.on(GetCommand).resolves({});

      const event = generateApiGatewayEvent(
        'PATCH',
        '/sos/nonexistent',
        { geoLocation: validGeoLocation },
        { sosId: 'nonexistent' },
      );

      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });

    it('should return 403 for SOS owned by another user', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { sosId: 'sos-1', userId: 'other-user', status: 'PENDING' },
      });

      const event = generateApiGatewayEvent(
        'PATCH',
        '/sos/sos-1',
        { geoLocation: validGeoLocation },
        { sosId: 'sos-1' },
      );

      const result = await handler(event);
      expect(result.statusCode).toBe(403);
    });

    it('should return 400 for invalid geoLocation', async () => {
      const event = generateApiGatewayEvent(
        'PATCH',
        '/sos/sos-1',
        { geoLocation: { lat: 'invalid' } },
        { sosId: 'sos-1' },
      );

      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should update SOS without geoLocation (updatedAt only)', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { sosId: 'sos-1', userId: 'user-123', status: 'PENDING' },
      });
      ddbMock.on(UpdateCommand).resolves({});

      const event = generateApiGatewayEvent(
        'PATCH',
        '/sos/sos-1',
        {},
        { sosId: 'sos-1' },
      );

      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.data.geoLocation).toBeUndefined();
      expect(body.data.platformUpdated).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /sos/{sosId} — Cancel SOS
  // -----------------------------------------------------------------------

  describe('DELETE /sos/{sosId}', () => {
    it('should cancel a PENDING SOS (local only, no platform call)', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { sosId: 'sos-1', userId: 'user-123', status: 'PENDING' },
      });
      ddbMock.on(UpdateCommand).resolves({});

      const event = generateApiGatewayEvent(
        'DELETE',
        '/sos/sos-1',
        undefined,
        { sosId: 'sos-1' },
      );

      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('CANCELLED');
      expect(body.data.previousStatus).toBe('PENDING');
      expect(body.data.platformCancelled).toBe(false);
    });

    it('should cancel an ACTIVE SOS and call platform DELETE', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          sosId: 'sos-1',
          userId: 'user-123',
          status: 'ACTIVE',
          platformSosId: 'platform-sos-1',
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      setupHttpsMock(200, { success: true });

      const event = generateApiGatewayEvent(
        'DELETE',
        '/sos/sos-1',
        undefined,
        { sosId: 'sos-1' },
      );

      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.data.status).toBe('CANCELLED');
      expect(body.data.previousStatus).toBe('ACTIVE');
      expect(body.data.platformCancelled).toBe(true);
    });

    it('should return 410 for already CANCELLED SOS', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { sosId: 'sos-1', userId: 'user-123', status: 'CANCELLED' },
      });

      const event = generateApiGatewayEvent(
        'DELETE',
        '/sos/sos-1',
        undefined,
        { sosId: 'sos-1' },
      );

      const result = await handler(event);
      expect(result.statusCode).toBe(410);
    });

    it('should return 410 for SUPERSEDED SOS', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { sosId: 'sos-1', userId: 'user-123', status: 'SUPERSEDED' },
      });

      const event = generateApiGatewayEvent(
        'DELETE',
        '/sos/sos-1',
        undefined,
        { sosId: 'sos-1' },
      );

      const result = await handler(event);
      expect(result.statusCode).toBe(410);
    });

    it('should return 404 for non-existent SOS', async () => {
      ddbMock.on(GetCommand).resolves({});

      const event = generateApiGatewayEvent(
        'DELETE',
        '/sos/nonexistent',
        undefined,
        { sosId: 'nonexistent' },
      );

      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });

    it('should return 403 for SOS owned by another user', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { sosId: 'sos-1', userId: 'other-user', status: 'ACTIVE' },
      });

      const event = generateApiGatewayEvent(
        'DELETE',
        '/sos/sos-1',
        undefined,
        { sosId: 'sos-1' },
      );

      const result = await handler(event);
      expect(result.statusCode).toBe(403);
    });
  });

  // -----------------------------------------------------------------------
  // SQS Consumer — Delayed propagation
  // -----------------------------------------------------------------------

  describe('SQS propagation consumer', () => {
    it('should propagate PENDING SOS to platform and mark ACTIVE', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          sosId: 'sos-1',
          userId: 'user-123',
          safeWalkId: 'sw-id-123',
          status: 'PENDING',
          geoLocation: validGeoLocation,
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      setupHttpsMock(201, {
        success: true,
        data: {
          sosId: 'platform-sos-1',
          status: 'ACTIVE',
          contactsNotified: 3,
          createdAt: new Date().toISOString(),
        },
      });

      const sqsEvent = generateSQSEvent('sos-1');
      await handler(sqsEvent);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0].args[0].input.ExpressionAttributeValues?.[':active']).toBe('ACTIVE');
      expect(updateCalls[0].args[0].input.ExpressionAttributeValues?.[':pid']).toBe('platform-sos-1');
    });

    it('should skip propagation for CANCELLED SOS', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          sosId: 'sos-1',
          userId: 'user-123',
          status: 'CANCELLED',
        },
      });

      const sqsEvent = generateSQSEvent('sos-1');
      await handler(sqsEvent);

      // No UpdateCommand should be called (no status transition)
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBe(0);
    });

    it('should skip propagation for SUPERSEDED SOS', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          sosId: 'sos-1',
          userId: 'user-123',
          status: 'SUPERSEDED',
        },
      });

      const sqsEvent = generateSQSEvent('sos-1');
      await handler(sqsEvent);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBe(0);
    });

    it('should skip propagation if SOS record not found', async () => {
      ddbMock.on(GetCommand).resolves({});

      const sqsEvent = generateSQSEvent('sos-1');
      await handler(sqsEvent);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBe(0);
    });

    it('should mark SOS as FAILED if platform returns error', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          sosId: 'sos-1',
          userId: 'user-123',
          safeWalkId: 'sw-id-123',
          status: 'PENDING',
          geoLocation: validGeoLocation,
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      setupHttpsMock(201, { success: false });

      const sqsEvent = generateSQSEvent('sos-1');
      await handler(sqsEvent);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0].args[0].input.ExpressionAttributeValues?.[':status']).toBe('FAILED');
    });
  });

  // -----------------------------------------------------------------------
  // Route matching
  // -----------------------------------------------------------------------

  describe('Route matching', () => {
    it('should return 404 for unknown route', async () => {
      const event = generateApiGatewayEvent('GET', '/unknown');
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });
  });
});
