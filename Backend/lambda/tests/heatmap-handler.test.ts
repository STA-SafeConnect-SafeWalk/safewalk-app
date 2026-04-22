import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handler } from '../heatmap-handler/index';

// The handler returns APIGatewayProxyResultV2 which is a union of structured result | string.
// We always return structured results, so cast for test convenience.
const invokeHandler = async (event: unknown): Promise<APIGatewayProxyStructuredResultV2> =>
  handler(event) as Promise<APIGatewayProxyStructuredResultV2>;
import {
  encodeGeohash,
  decodeGeohash,
  boundingBoxFromCenter,
  computeSafetyScore,
  isValidCategory,
  sanitizeDescription,
} from '../heatmap-handler/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock https for Overpass API calls
jest.mock('https', () => {
  const actual = jest.requireActual('https');
  return { ...actual, request: jest.fn() };
});

const mockHttpsRequest = require('https').request as jest.Mock;

function setupOverpassMock(statusCode: number, responseBody: unknown) {
  mockHttpsRequest.mockImplementation((_opts: unknown, callback: (res: unknown) => void) => {
    const res: { statusCode: number; on: jest.Mock } = {
      statusCode,
      on: jest.fn(),
    };
    res.on.mockImplementation((event: string, fn: (data?: string) => void) => {
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

describe('heatmap-handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    ddbMock.reset();
    mockHttpsRequest.mockReset();
    process.env = { ...originalEnv };
    process.env.HEATMAP_REPORTS_TABLE_NAME = 'HeatmapReports';
    process.env.HEATMAP_PUBLIC_DATA_TABLE_NAME = 'HeatmapPublicDataCache';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const generateApiGatewayEvent = (
    method: string,
    path: string,
    body?: unknown,
    pathParameters?: Record<string, string>,
    queryStringParameters?: Record<string, string>,
    userId: string = 'user-123',
  ): APIGatewayProxyEventV2 => {
    let routeKeyPath = path;
    if (pathParameters) {
      for (const [key, value] of Object.entries(pathParameters)) {
        routeKeyPath = routeKeyPath.replace(value, `{${key}}`);
      }
    }
    return {
      version: '2.0',
      routeKey: `${method} ${routeKeyPath}`,
      rawPath: path,
      rawQueryString: '',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      pathParameters: pathParameters ?? undefined,
      queryStringParameters: queryStringParameters ?? undefined,
      requestContext: {
        http: { method, path, protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'test' },
        authorizer: {
          jwt: {
            claims: { sub: userId },
            scopes: [],
          },
        },
        accountId: '123456789',
        apiId: 'testapi',
        domainName: 'test.execute-api.eu-central-1.amazonaws.com',
        domainPrefix: 'test',
        requestId: 'test-request-id',
        routeKey: `${method} ${routeKeyPath}`,
        stage: '$default',
        time: '01/Jan/2026:00:00:00 +0000',
        timeEpoch: 1767225600000,
      },
      isBase64Encoded: false,
    } as unknown as APIGatewayProxyEventV2;
  };

  // -----------------------------------------------------------------------
  // Missing environment variables
  // -----------------------------------------------------------------------

  describe('missing env vars', () => {
    it('should return 500 when HEATMAP_REPORTS_TABLE_NAME is missing', async () => {
      delete process.env.HEATMAP_REPORTS_TABLE_NAME;
      const event = generateApiGatewayEvent('POST', '/heatmap/reports', {
        lat: 48.1,
        lng: 11.5,
        category: 'SAFE_AREA',
      });
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body as string).error).toContain('HEATMAP_REPORTS_TABLE_NAME');
    });

    it('should return 500 when HEATMAP_PUBLIC_DATA_TABLE_NAME is missing', async () => {
      delete process.env.HEATMAP_PUBLIC_DATA_TABLE_NAME;
      const event = generateApiGatewayEvent('GET', '/heatmap', undefined, undefined, {
        lat: '48.1',
        lng: '11.5',
      });
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body as string).error).toContain('HEATMAP_PUBLIC_DATA_TABLE_NAME');
    });
  });

  // -----------------------------------------------------------------------
  // POST /heatmap/reports
  // -----------------------------------------------------------------------

  describe('POST /heatmap/reports', () => {
    it('should return 401 when not authenticated', async () => {
      const event = generateApiGatewayEvent(
        'POST',
        '/heatmap/reports',
        { lat: 48.1, lng: 11.5, category: 'SAFE_AREA' },
        undefined,
        undefined,
        '',
      );
      // Remove authorizer
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (event.requestContext as any).authorizer = {};
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(401);
    });

    it('should return 400 when body is missing', async () => {
      const event = generateApiGatewayEvent('POST', '/heatmap/reports');
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body as string).error).toContain('Request body is required');
    });

    it('should return 400 for invalid coordinates', async () => {
      const event = generateApiGatewayEvent('POST', '/heatmap/reports', {
        lat: 91,
        lng: 11.5,
        category: 'SAFE_AREA',
      });
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body as string).error).toContain('lat');
    });

    it('should return 400 for invalid longitude', async () => {
      const event = generateApiGatewayEvent('POST', '/heatmap/reports', {
        lat: 48.1,
        lng: 181,
        category: 'SAFE_AREA',
      });
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 400 for invalid category', async () => {
      const event = generateApiGatewayEvent('POST', '/heatmap/reports', {
        lat: 48.1,
        lng: 11.5,
        category: 'INVALID_CATEGORY',
      });

      // Mock rate limit check
      ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });

      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body as string).error).toContain('Invalid category');
    });

    it('should return 400 for description exceeding max length', async () => {
      const event = generateApiGatewayEvent('POST', '/heatmap/reports', {
        lat: 48.1,
        lng: 11.5,
        category: 'SAFE_AREA',
        description: 'x'.repeat(501),
      });

      ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });

      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body as string).error).toContain('500 characters');
    });

    it('should return 429 when rate limit is exceeded', async () => {
      const event = generateApiGatewayEvent('POST', '/heatmap/reports', {
        lat: 48.1,
        lng: 11.5,
        category: 'SAFE_AREA',
      });

      ddbMock.on(QueryCommand).resolves({ Count: 50 });

      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(429);
      expect(JSON.parse(result.body as string).error).toContain('Rate limit');
    });

    it('should create a report successfully', async () => {
      const event = generateApiGatewayEvent('POST', '/heatmap/reports', {
        lat: 48.1351,
        lng: 11.582,
        category: 'WELL_LIT',
        description: 'Well lit street near Marienplatz',
      });

      ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });
      ddbMock.on(PutCommand).resolves({});

      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body as string);
      expect(body.success).toBe(true);
      expect(body.data.reportId).toBeDefined();
      expect(body.data.category).toBe('WELL_LIT');
      expect(body.data.lat).toBe(48.1351);
      expect(body.data.lng).toBe(11.582);
      expect(body.data.description).toBe('Well lit street near Marienplatz');
      expect(body.data.createdAt).toBeDefined();

      // Verify PutCommand was called with correct structure
      const putCalls = ddbMock.commandCalls(PutCommand);
      expect(putCalls.length).toBe(1);
      const item = putCalls[0].args[0].input.Item;
      expect(item?.geohash5).toBeDefined();
      expect(item?.sk).toMatch(/^report#/);
      expect(item?.userId).toBe('user-123');
      expect(item?.ttl).toBeDefined();
    });

    it('should sanitize HTML from description', async () => {
      const event = generateApiGatewayEvent('POST', '/heatmap/reports', {
        lat: 48.1,
        lng: 11.5,
        category: 'UNSAFE_AREA',
        description: '<script>alert("xss")</script>Dangerous path',
      });

      ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });
      ddbMock.on(PutCommand).resolves({});

      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(201);

      const putCalls = ddbMock.commandCalls(PutCommand);
      const item = putCalls[0].args[0].input.Item;
      expect(item?.description).toBe('alert("xss")Dangerous path');
    });
  });

  // -----------------------------------------------------------------------
  // GET /heatmap/reports
  // -----------------------------------------------------------------------

  describe('GET /heatmap/reports', () => {
    it('should return own reports', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            reportId: 'report-1',
            category: 'SAFE_AREA',
            lat: 48.1,
            lng: 11.5,
            description: 'Safe area',
            geohash5: 'u281z',
            createdAt: '2026-04-20T10:00:00.000Z',
          },
          {
            reportId: 'report-2',
            category: 'POORLY_LIT',
            lat: 48.2,
            lng: 11.6,
            geohash5: 'u282b',
            createdAt: '2026-04-19T10:00:00.000Z',
          },
        ],
      });

      const event = generateApiGatewayEvent('GET', '/heatmap/reports');
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body as string);
      expect(body.success).toBe(true);
      expect(body.data.reports).toHaveLength(2);
      expect(body.data.reports[0].reportId).toBe('report-1');
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /heatmap/reports/{reportId}
  // -----------------------------------------------------------------------

  describe('DELETE /heatmap/reports/{reportId}', () => {
    it('should return 404 when report not found', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const event = generateApiGatewayEvent(
        'DELETE',
        '/heatmap/reports/nonexistent-id',
        undefined,
        { reportId: 'nonexistent-id' },
      );
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(404);
    });

    it('should return 403 when trying to delete another users report', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            reportId: 'report-1',
            userId: 'other-user',
            geohash5: 'u281z',
            sk: 'report#u281zqr#report-1',
          },
        ],
      });

      const event = generateApiGatewayEvent(
        'DELETE',
        '/heatmap/reports/report-1',
        undefined,
        { reportId: 'report-1' },
      );
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(403);
    });

    it('should delete own report successfully', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            reportId: 'report-1',
            userId: 'user-123',
            geohash5: 'u281z',
            sk: 'report#u281zqr#report-1',
          },
        ],
      });
      ddbMock.on(DeleteCommand).resolves({});

      const event = generateApiGatewayEvent(
        'DELETE',
        '/heatmap/reports/report-1',
        undefined,
        { reportId: 'report-1' },
      );
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body as string);
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);

      const deleteCalls = ddbMock.commandCalls(DeleteCommand);
      expect(deleteCalls.length).toBe(1);
      expect(deleteCalls[0].args[0].input.Key).toEqual({
        geohash5: 'u281z',
        sk: 'report#u281zqr#report-1',
      });
    });
  });

  // -----------------------------------------------------------------------
  // GET /heatmap
  // -----------------------------------------------------------------------

  describe('GET /heatmap', () => {
    it('should return 400 when lat/lng are missing', async () => {
      const event = generateApiGatewayEvent('GET', '/heatmap');
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body as string).error).toContain('lat and lng');
    });

    it('should return 400 for invalid coordinates', async () => {
      const event = generateApiGatewayEvent('GET', '/heatmap', undefined, undefined, {
        lat: '91',
        lng: '11.5',
      });
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 400 for excessive radius', async () => {
      const event = generateApiGatewayEvent('GET', '/heatmap', undefined, undefined, {
        lat: '48.1',
        lng: '11.5',
        radiusKm: '15',
      });
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body as string).error).toContain('radiusKm');
    });

    it('should return heatmap data with aggregated cells', async () => {
      // Mock: all DynamoDB queries return user reports in one cell + fresh cache metadata
      const queryResponses: Array<{ Items?: Record<string, unknown>[]; Count?: number }> = [];

      ddbMock.on(QueryCommand).callsFake((input) => {
        const sk = input.ExpressionAttributeValues?.[':prefix'] ?? input.ExpressionAttributeValues?.[':meta'];

        // Cache metadata checks — return fresh meta
        if (sk === '_meta#osm') {
          return {
            Items: [
              {
                geohash5: input.ExpressionAttributeValues?.[':gh5'],
                sk: '_meta#osm',
                lastFetched: new Date().toISOString(),
                pointCount: 2,
              },
            ],
          };
        }

        // User report queries
        if (sk === 'report#') {
          return {
            Items: [
              {
                geohash5: 'u281z',
                sk: 'report#u281zqr#r1',
                reportId: 'r1',
                userId: 'user-456',
                geohash7: 'u281zqr',
                lat: 48.135,
                lng: 11.582,
                category: 'SAFE_AREA',
                createdAt: '2026-04-20T10:00:00Z',
              },
              {
                geohash5: 'u281z',
                sk: 'report#u281zqr#r2',
                reportId: 'r2',
                userId: 'user-789',
                geohash7: 'u281zqr',
                lat: 48.136,
                lng: 11.583,
                category: 'WELL_LIT',
                createdAt: '2026-04-20T11:00:00Z',
              },
            ],
          };
        }

        // Public data queries
        if (sk === 'source#') {
          return {
            Items: [
              {
                geohash5: 'u281z',
                sk: 'source#STREET_LAMP#node123',
                dataType: 'STREET_LAMP',
                lat: 48.135,
                lng: 11.582,
                geohash7: 'u281zqr',
              },
            ],
          };
        }

        return { Items: [] };
      });

      const event = generateApiGatewayEvent('GET', '/heatmap', undefined, undefined, {
        lat: '48.135',
        lng: '11.582',
        radiusKm: '1',
      });
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body as string);
      expect(body.success).toBe(true);
      expect(body.data.cells).toBeDefined();
      expect(body.data.boundingBox).toBeDefined();
      expect(body.data.radiusKm).toBe(1);
      expect(body.data.queriedAt).toBeDefined();

      // Verify no userId is leaked in the response
      const responseStr = result.body as string;
      expect(responseStr).not.toContain('user-456');
      expect(responseStr).not.toContain('user-789');
    });

    it('should trigger Overpass fetch when cache is stale', async () => {
      // Return stale (or no) meta, then empty reports and sources
      ddbMock.on(QueryCommand).callsFake((input) => {
        const sk = input.ExpressionAttributeValues?.[':prefix'] ?? input.ExpressionAttributeValues?.[':meta'];

        if (sk === '_meta#osm') {
          return { Items: [] }; // No cache metadata = stale
        }

        return { Items: [] };
      });
      ddbMock.on(BatchWriteCommand).resolves({});

      // Mock Overpass API response
      setupOverpassMock(200, {
        elements: [
          {
            type: 'node',
            id: 12345,
            lat: 48.135,
            lon: 11.582,
            tags: { highway: 'street_lamp' },
          },
          {
            type: 'node',
            id: 12346,
            lat: 48.136,
            lon: 11.583,
            tags: { amenity: 'police' },
          },
        ],
      });

      const event = generateApiGatewayEvent('GET', '/heatmap', undefined, undefined, {
        lat: '48.135',
        lng: '11.582',
        radiusKm: '1',
      });
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(200);

      // Verify Overpass was called
      expect(mockHttpsRequest).toHaveBeenCalled();

      // Verify data was cached via BatchWrite
      const batchCalls = ddbMock.commandCalls(BatchWriteCommand);
      expect(batchCalls.length).toBeGreaterThan(0);
    });

    it('should use cached data and skip Overpass when cache is fresh', async () => {
      ddbMock.on(QueryCommand).callsFake((input) => {
        const sk = input.ExpressionAttributeValues?.[':prefix'] ?? input.ExpressionAttributeValues?.[':meta'];

        if (sk === '_meta#osm') {
          return {
            Items: [
              {
                geohash5: input.ExpressionAttributeValues?.[':gh5'],
                sk: '_meta#osm',
                lastFetched: new Date().toISOString(), // fresh
                pointCount: 1,
              },
            ],
          };
        }

        return { Items: [] };
      });

      const event = generateApiGatewayEvent('GET', '/heatmap', undefined, undefined, {
        lat: '48.135',
        lng: '11.582',
        radiusKm: '1',
      });
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(200);

      // Overpass should NOT have been called
      expect(mockHttpsRequest).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Utility function tests
  // -----------------------------------------------------------------------

  describe('geohash utilities', () => {
    it('should encode and decode a geohash correctly', () => {
      // Munich city center
      const hash = encodeGeohash(48.1351, 11.582, 7);
      expect(hash.length).toBe(7);

      const decoded = decodeGeohash(hash);
      expect(Math.abs(decoded.lat - 48.1351)).toBeLessThan(0.01);
      expect(Math.abs(decoded.lng - 11.582)).toBeLessThan(0.01);
    });

    it('should compute bounding box from center correctly', () => {
      const bbox = boundingBoxFromCenter(48.135, 11.582, 2);
      expect(bbox.minLat).toBeLessThan(48.135);
      expect(bbox.maxLat).toBeGreaterThan(48.135);
      expect(bbox.minLng).toBeLessThan(11.582);
      expect(bbox.maxLng).toBeGreaterThan(11.582);
    });

    it('should correctly validate categories', () => {
      expect(isValidCategory('SAFE_AREA')).toBe(true);
      expect(isValidCategory('WELL_LIT')).toBe(true);
      expect(isValidCategory('CRIME_INCIDENT')).toBe(true);
      expect(isValidCategory('INVALID')).toBe(false);
      expect(isValidCategory('')).toBe(false);
    });

    it('should sanitize HTML from descriptions', () => {
      expect(sanitizeDescription('<b>bold</b> text')).toBe('bold text');
      expect(sanitizeDescription('<script>alert(1)</script>hello')).toBe('alert(1)hello');
      expect(sanitizeDescription('normal text')).toBe('normal text');
    });
  });

  describe('safety score computation', () => {
    it('should return null for empty data', () => {
      expect(computeSafetyScore({}, {})).toBeNull();
    });

    it('should return 50 for neutral data', () => {
      // One positive and one negative report that cancel out
      const score = computeSafetyScore({ WELL_LIT: 1, POORLY_LIT: 1 }, {});
      expect(score).toBe(50);
    });

    it('should return high score for safe data', () => {
      const score = computeSafetyScore(
        { SAFE_AREA: 5, WELL_LIT: 3 },
        { STREET_LAMP: 10, POLICE_STATION: 1 },
      );
      expect(score).not.toBeNull();
      expect(score!).toBeGreaterThan(50);
    });

    it('should return low score for unsafe data', () => {
      const score = computeSafetyScore(
        { UNSAFE_AREA: 5, CRIME_INCIDENT: 3, POORLY_LIT: 2 },
        { UNLIT_WAY: 5 },
      );
      expect(score).not.toBeNull();
      expect(score!).toBeLessThan(50);
    });

    it('should clamp extreme scores to 0-100 range', () => {
      // Extremely negative
      const lowScore = computeSafetyScore({ CRIME_INCIDENT: 100 }, {});
      expect(lowScore).toBeGreaterThanOrEqual(0);
      expect(lowScore).toBeLessThanOrEqual(100);

      // Extremely positive
      const highScore = computeSafetyScore({ SAFE_AREA: 100 }, {});
      expect(highScore).toBeGreaterThanOrEqual(0);
      expect(highScore).toBeLessThanOrEqual(100);
    });
  });

  // -----------------------------------------------------------------------
  // Route not found
  // -----------------------------------------------------------------------

  describe('unknown route', () => {
    it('should return 404 for unknown route', async () => {
      const event = generateApiGatewayEvent('POST', '/unknown');
      const result = await invokeHandler(event);
      expect(result.statusCode).toBe(404);
    });
  });
});
