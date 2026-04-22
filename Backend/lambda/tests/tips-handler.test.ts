import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from '../tips-handler/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const buildEvent = (
  routeKey: string,
  userId?: string,
): APIGatewayProxyEventV2 => ({
  version: '2.0',
  routeKey,
  rawPath: '/tips',
  rawQueryString: '',
  headers: {},
  requestContext: {
    http: {
      method: 'GET',
      path: '/tips',
      protocol: 'HTTP/1.1',
      sourceIp: '127.0.0.1',
      userAgent: 'jest',
    },
    authorizer: userId
      ? {
          jwt: {
            claims: { sub: userId },
            scopes: [],
          },
        }
      : undefined,
  } as any,
}) as APIGatewayProxyEventV2;

describe('tips-handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    ddbMock.reset();
    process.env = { ...originalEnv, TIPS_TABLE_NAME: 'AppSafetyTips' };
    jest.useFakeTimers().setSystemTime(new Date('2026-04-21T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns 401 when JWT user is missing', async () => {
    const result = (await handler(buildEvent('GET /tips'))) as {
      statusCode: number;
      body: string;
    };
    expect(result.statusCode).toBe(401);
  });

  it('returns tip of the day and remaining tips', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        {
          tipId: 'tip-a',
          icon: 'shield',
          title: 'Bleib sichtbar',
          description: 'Trage reflektierende Kleidung in der Nacht.',
          category: 'Sichtbarkeit',
          isActive: true,
        },
        {
          tipId: 'tip-b',
          icon: 'location',
          title: 'Teile deinen Standort',
          description: 'Aktiviere Standortfreigabe für Bezugspersonen.',
          category: 'Standort',
          isActive: true,
        },
        {
          tipId: 'tip-c',
          icon: 'call',
          title: 'Notruf parat halten',
          description: 'Halte den Notruf schnell erreichbar.',
          category: 'Notfall',
          isActive: true,
        },
      ],
    });

    const result = (await handler(buildEvent('GET /tips', 'user-123'))) as {
      statusCode: number;
      body: string;
    };
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.tipOfTheDay).toBeDefined();
    expect(body.data.tips.length).toBe(2);
    expect(
      body.data.tips.some(
        (tip: { tipId: string }) => tip.tipId === body.data.tipOfTheDay.tipId,
      ),
    ).toBe(false);
  });

  it('filters out inactive tips', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        {
          tipId: 'tip-a',
          icon: 'shield',
          title: 'Aktiver Tipp',
          description: 'Beschreibung',
          category: 'Allgemein',
          isActive: true,
        },
        {
          tipId: 'tip-b',
          icon: 'location',
          title: 'Inaktiver Tipp',
          description: 'Beschreibung',
          category: 'Allgemein',
          isActive: false,
        },
      ],
    });

    const result = (await handler(buildEvent('GET /tips', 'user-123'))) as {
      statusCode: number;
      body: string;
    };
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.success).toBe(true);

    const totalReturned =
      (body.data.tipOfTheDay ? 1 : 0) +
      (Array.isArray(body.data.tips) ? body.data.tips.length : 0);
    expect(totalReturned).toBe(1);
  });
});
