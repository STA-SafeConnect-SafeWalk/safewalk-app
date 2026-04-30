import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from '../map-data-handler/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const REPORTS_TABLE = 'MapReports';
const CACHE_TABLE = 'MapDataCache';

const buildEvent = (
  routeKey: string,
  options: {
    userId?: string;
    body?: unknown;
    query?: Record<string, string>;
    pathParameters?: Record<string, string>;
  } = {},
): APIGatewayProxyEventV2 => {
  const path = routeKey.split(' ')[1] ?? '/';
  return {
    version: '2.0',
    routeKey,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    queryStringParameters: options.query,
    pathParameters: options.pathParameters,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    requestContext: {
      http: {
        method: routeKey.split(' ')[0],
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'jest',
      },
      authorizer: options.userId
        ? { jwt: { claims: { sub: options.userId }, scopes: [] } }
        : undefined,
    } as any,
  } as APIGatewayProxyEventV2;
};

const baseEnv = {
  MAP_REPORTS_TABLE_NAME: REPORTS_TABLE,
  MAP_CACHE_TABLE_NAME: CACHE_TABLE,
};

describe('map-data-handler', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    ddbMock.reset();
    process.env = { ...originalEnv, ...baseEnv };
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('GET /map-data', () => {
    const validQuery = { lat: '52.5200', lng: '13.4050', radius: '500' };

    it('returns 401 when JWT user is missing', async () => {
      const result = (await handler(
        buildEvent('GET /map-data', { query: validQuery }),
      )) as { statusCode: number };
      expect(result.statusCode).toBe(401);
    });

    it('returns 400 when lat/lng/radius are missing', async () => {
      const result = (await handler(
        buildEvent('GET /map-data', { userId: 'u1' }),
      )) as { statusCode: number; body: string };
      expect(result.statusCode).toBe(400);
    });

    it('returns 400 when radius exceeds maximum', async () => {
      const result = (await handler(
        buildEvent('GET /map-data', {
          userId: 'u1',
          query: { lat: '52.5', lng: '13.4', radius: '99999' },
        }),
      )) as { statusCode: number };
      expect(result.statusCode).toBe(400);
    });

    it('serves POIs from cache without calling Overpass', async () => {
      const cachedPois = [
        {
          id: 'node/1',
          category: 'HOSPITAL',
          lat: 52.5201,
          lng: 13.4051,
          name: 'Test Hospital',
        },
      ];
      ddbMock.on(GetCommand).resolves({
        Item: {
          cacheKey: 'osm#52.520#13.400#r5000',
          pois: cachedPois,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      });
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = (await handler(
        buildEvent('GET /map-data', { userId: 'u1', query: validQuery }),
      )) as { statusCode: number; body: string };
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.cache).toBe('HIT');
      expect(body.data.pois).toHaveLength(1);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('falls back to Overpass on cache miss and writes back', async () => {
      ddbMock.on(GetCommand).resolves({});
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          elements: [
            {
              type: 'node',
              id: 42,
              lat: 52.5201,
              lon: 13.4051,
              tags: { amenity: 'police', name: 'Police HQ' },
            },
            {
              type: 'node',
              id: 43,
              lat: 52.5205,
              lon: 13.4055,
              tags: { emergency: 'phone' },
            },
            {
              type: 'way',
              id: 99,
              center: { lat: 52.5202, lon: 13.4052 },
              tags: { highway: 'residential', lit: 'no' },
            },
          ],
        }),
      });

      const result = (await handler(
        buildEvent('GET /map-data', { userId: 'u1', query: validQuery }),
      )) as { statusCode: number; body: string };
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.data.cache).toBe('MISS');
      const categories = body.data.pois.map((p: { category: string }) => p.category).sort();
      expect(categories).toEqual(['EMERGENCY_PHONE', 'POLICE', 'UNLIT_WAY']);
    });

    it('filters POIs outside the requested radius', async () => {
      const farLat = 52.6;
      const farLng = 13.5;
      ddbMock.on(GetCommand).resolves({
        Item: {
          cacheKey: 'osm#52.520#13.400#r5000',
          pois: [
            { id: 'node/1', category: 'HOSPITAL', lat: 52.5200, lng: 13.4050 },
            { id: 'node/2', category: 'HOSPITAL', lat: farLat, lng: farLng },
          ],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      });
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = (await handler(
        buildEvent('GET /map-data', { userId: 'u1', query: validQuery }),
      )) as { statusCode: number; body: string };
      const body = JSON.parse(result.body);

      expect(body.data.pois).toHaveLength(1);
      expect(body.data.pois[0].id).toBe('node/1');
    });

    it('includes user reports for the requested area', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          cacheKey: 'osm#52.520#13.400#r5000',
          pois: [],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      });
      const futureExpire = Math.floor(Date.now() / 1000) + 3600;
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            bucket: '5252:1340',
            reportId: 'r1',
            userId: 'someone',
            type: 'UNLIT_WAY',
            lat: 52.5201,
            lng: 13.4051,
            comment: 'No lights at night',
            createdAt: '2026-04-30T00:00:00Z',
            expiresAt: futureExpire,
          },
        ],
      });

      const result = (await handler(
        buildEvent('GET /map-data', { userId: 'u1', query: validQuery }),
      )) as { statusCode: number; body: string };
      const body = JSON.parse(result.body);

      expect(body.data.reports.length).toBeGreaterThanOrEqual(1);
      expect(body.data.reports[0].type).toBe('UNLIT_WAY');
      expect(body.data.reports[0].comment).toBe('No lights at night');
    });

    it('returns 200 with empty POIs when Overpass and cache both fail', async () => {
      ddbMock.on(GetCommand).resolves({});
      ddbMock.on(QueryCommand).resolves({ Items: [] });
      (global.fetch as jest.Mock).mockRejectedValue(new Error('boom'));

      const result = (await handler(
        buildEvent('GET /map-data', { userId: 'u1', query: validQuery }),
      )) as { statusCode: number; body: string };
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.data.cache).toBe('BYPASS');
      expect(body.data.pois).toEqual([]);
    });
  });

  describe('POST /map-data/reports', () => {
    it('rejects when user not authenticated', async () => {
      const result = (await handler(
        buildEvent('POST /map-data/reports', {
          body: { lat: 52.5, lng: 13.4, type: 'UNLIT_WAY' },
        }),
      )) as { statusCode: number };
      expect(result.statusCode).toBe(401);
    });

    it('rejects unknown report types', async () => {
      const result = (await handler(
        buildEvent('POST /map-data/reports', {
          userId: 'u1',
          body: { lat: 52.5, lng: 13.4, type: 'NOT_A_TYPE' },
        }),
      )) as { statusCode: number };
      expect(result.statusCode).toBe(400);
    });

    it('rejects out-of-range coordinates', async () => {
      const result = (await handler(
        buildEvent('POST /map-data/reports', {
          userId: 'u1',
          body: { lat: 200, lng: 13.4, type: 'UNLIT_WAY' },
        }),
      )) as { statusCode: number };
      expect(result.statusCode).toBe(400);
    });

    it('persists a valid report with TTL and returns 201', async () => {
      ddbMock.on(PutCommand).resolves({});

      const result = (await handler(
        buildEvent('POST /map-data/reports', {
          userId: 'u1',
          body: {
            lat: 52.5,
            lng: 13.4,
            type: 'CRIME_INCIDENT',
            comment: 'Saw something suspicious',
          },
        }),
      )) as { statusCode: number; body: string };

      expect(result.statusCode).toBe(201);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.data.reportId).toBeDefined();
      expect(body.data.type).toBe('CRIME_INCIDENT');
      expect(body.data.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

      const putCalls = ddbMock.commandCalls(PutCommand);
      expect(putCalls.length).toBe(1);
      const item = putCalls[0].args[0].input.Item as Record<string, unknown>;
      expect(item.userId).toBe('u1');
      expect(item.type).toBe('CRIME_INCIDENT');
      expect(typeof item.bucket).toBe('string');
      expect(typeof item.expiresAt).toBe('number');
    });
  });

  describe('DELETE /map-data/reports/{reportId}', () => {
    it('returns 404 when report does not exist', async () => {
      ddbMock.on(GetCommand).resolves({});

      const result = (await handler(
        buildEvent('DELETE /map-data/reports/{reportId}', {
          userId: 'u1',
          pathParameters: { reportId: 'r1' },
          query: { lat: '52.5', lng: '13.4' },
        }),
      )) as { statusCode: number };
      expect(result.statusCode).toBe(404);
    });

    it('forbids deleting another user’s report', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          bucket: '5250:1340',
          reportId: 'r1',
          userId: 'someone-else',
          type: 'UNLIT_WAY',
          lat: 52.5,
          lng: 13.4,
          createdAt: '2026-04-30T00:00:00Z',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      });

      const result = (await handler(
        buildEvent('DELETE /map-data/reports/{reportId}', {
          userId: 'u1',
          pathParameters: { reportId: 'r1' },
          query: { lat: '52.5', lng: '13.4' },
        }),
      )) as { statusCode: number };
      expect(result.statusCode).toBe(403);
    });

    it('deletes own report', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          bucket: '5250:1340',
          reportId: 'r1',
          userId: 'u1',
          type: 'UNLIT_WAY',
          lat: 52.5,
          lng: 13.4,
          createdAt: '2026-04-30T00:00:00Z',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      });
      ddbMock.on(DeleteCommand).resolves({});

      const result = (await handler(
        buildEvent('DELETE /map-data/reports/{reportId}', {
          userId: 'u1',
          pathParameters: { reportId: 'r1' },
          query: { lat: '52.5', lng: '13.4' },
        }),
      )) as { statusCode: number };
      expect(result.statusCode).toBe(204);
      expect(ddbMock.commandCalls(DeleteCommand).length).toBe(1);
    });
  });

  it('returns 500 when env vars are missing', async () => {
    process.env = { ...originalEnv };
    const result = (await handler(
      buildEvent('GET /map-data', { userId: 'u1' }),
    )) as { statusCode: number };
    expect(result.statusCode).toBe(500);
  });

  it('returns 404 for unknown route', async () => {
    const result = (await handler(buildEvent('GET /unknown', { userId: 'u1' }))) as {
      statusCode: number;
    };
    expect(result.statusCode).toBe(404);
  });
});
