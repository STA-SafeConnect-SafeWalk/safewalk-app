import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import * as https from 'https';
import * as http from 'http';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

interface LocationUpdateRequest {
  lat: number;
  lng: number;
  accuracy: number;
}

interface LiveLocationRecord {
  safeWalkId: string;
  lat: number;
  lng: number;
  accuracy: number;
  updatedAt: string;
  expiresAt: number;
}

interface PlatformContact {
  contactId: string;
  status: string;
  targetSafeWalkId: string;
  requesterSafeWalkId: string;
  platformId: string;
  locationSharing: boolean;
  sosSharing: boolean;
  direction: 'outgoing' | 'incoming';
  peerName?: string;
  createdAt: string;
  updatedAt: string;
}

interface PlatformListContactsResponse {
  success: boolean;
  data: {
    contacts: PlatformContact[];
  };
}

interface ContactLocationResponse {
  safeWalkId: string;
  displayName: string;
  lat: number;
  lng: number;
  accuracy: number;
  updatedAt: string;
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const getEnv = (name: string): string | undefined => process.env[name];

const missingEnvResponse = (name: string): APIGatewayProxyResultV2 => ({
  statusCode: 500,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ error: `Server configuration error: ${name} not set` }),
});

const jsonResponse = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const getAuthenticatedUserId = (event: APIGatewayProxyEventV2): string | undefined => {
  const ctx = event.requestContext as any;
  return ctx.authorizer?.jwt?.claims?.sub as string | undefined;
};

const UNAUTHORIZED_RESPONSE: APIGatewayProxyResultV2 = {
  statusCode: 401,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ error: 'Unauthorized' }),
};

export const handler = async (event: APIGatewayProxyEventV2): Promise<any> => {
  const locationsTable = getEnv('LIVE_LOCATIONS_TABLE_NAME');
  if (!locationsTable) return missingEnvResponse('LIVE_LOCATIONS_TABLE_NAME');

  const usersTable = getEnv('APP_USERS_TABLE_NAME');
  if (!usersTable) return missingEnvResponse('APP_USERS_TABLE_NAME');

  switch (event.routeKey) {
    case 'PUT /location':
      return handleUpdateLocation(event, locationsTable, usersTable);

    case 'DELETE /location':
      return handleDeleteLocation(event, locationsTable, usersTable);

    case 'GET /location/contacts':
      return handleGetContactLocations(event, locationsTable, usersTable);

    case 'GET /location/contacts/{safeWalkId}':
      return handleGetSingleContactLocation(event, locationsTable, usersTable);

    default:
      return jsonResponse(404, { error: 'Route not found' });
  }
};

async function resolveUserSafeWalkId(
  userId: string,
  usersTable: string,
): Promise<string | null> {
  const result = await docClient.send(
    new GetCommand({ TableName: usersTable, Key: { safeWalkAppId: userId } }),
  );
  return (result.Item?.safeWalkId as string) ?? null;
}

function getPartnerSafeWalkId(c: PlatformContact): string {
  return c.direction === 'outgoing' ? c.targetSafeWalkId : c.requesterSafeWalkId;
}

/**
 * Resolves which contacts share their location with the requesting user.
 */
async function resolveContactsWhoShareLocation(
  safeWalkId: string,
): Promise<Map<string, string>> {
  const platformDomain = getEnv('PLATFORM_DOMAIN');
  const apiKey = getEnv('API_KEY');
  if (!platformDomain || !apiKey) return new Map();

  const contactsUrl = `${platformDomain}/contacts/${encodeURIComponent(safeWalkId)}`;
  const response = await sendRequest<PlatformListContactsResponse>(contactsUrl, 'GET', apiKey);

  if (!response.success) return new Map();

  const sharingContacts = new Map<string, string>();
  const byPartner = new Map<string, { outgoing?: PlatformContact; incoming?: PlatformContact }>();

  for (const c of response.data.contacts) {
    const partnerId = getPartnerSafeWalkId(c);
    const entry = byPartner.get(partnerId) ?? {};
    if (c.direction === 'outgoing') entry.outgoing = c;
    else entry.incoming = c;
    byPartner.set(partnerId, entry);
  }

  for (const [partnerId, { outgoing }] of byPartner.entries()) {
    // outgoing.locationSharing means the contact configured sharing TO the requesting user
    if (outgoing?.locationSharing) {
      sharingContacts.set(partnerId, outgoing.peerName ?? 'Unbenannte Kontaktperson');
    }
  }

  return sharingContacts;
}

// PUT /location — Update my live location
async function handleUpdateLocation(
  event: APIGatewayProxyEventV2,
  locationsTable: string,
  usersTable: string,
): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  let body: LocationUpdateRequest;
  try {
    body = JSON.parse(event.body ?? '');
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  if (typeof body.lat !== 'number' || typeof body.lng !== 'number' || typeof body.accuracy !== 'number') {
    return jsonResponse(400, { error: 'lat, lng, and accuracy are required and must be numbers' });
  }

  if (body.lat < -90 || body.lat > 90) {
    return jsonResponse(400, { error: 'lat must be between -90 and 90' });
  }
  if (body.lng < -180 || body.lng > 180) {
    return jsonResponse(400, { error: 'lng must be between -180 and 180' });
  }
  if (body.accuracy < 0) {
    return jsonResponse(400, { error: 'accuracy must be non-negative' });
  }

  let safeWalkId: string;
  try {
    const resolved = await resolveUserSafeWalkId(userId, usersTable);
    if (!resolved) {
      return jsonResponse(400, { error: 'User has not been registered on the platform yet' });
    }
    safeWalkId = resolved;
  } catch (error) {
    console.error('Error resolving safeWalkId:', error);
    return jsonResponse(500, { error: 'Failed to resolve user identity' });
  }

  const ttlSeconds = parseInt(getEnv('LOCATION_TTL_SECONDS') ?? '120', 10);
  const now = new Date();
  const expiresAt = Math.floor(now.getTime() / 1000) + ttlSeconds;

  const record: LiveLocationRecord = {
    safeWalkId,
    lat: body.lat,
    lng: body.lng,
    accuracy: body.accuracy,
    updatedAt: now.toISOString(),
    expiresAt,
  };

  try {
    await docClient.send(
      new PutCommand({ TableName: locationsTable, Item: record }),
    );
  } catch (error) {
    console.error('Error storing location:', error);
    return jsonResponse(500, { error: 'Failed to store location' });
  }

  return jsonResponse(200, record);
}

// DELETE /location — Stop sharing my location
async function handleDeleteLocation(
  event: APIGatewayProxyEventV2,
  locationsTable: string,
  usersTable: string,
): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  let safeWalkId: string;
  try {
    const resolved = await resolveUserSafeWalkId(userId, usersTable);
    if (!resolved) {
      return jsonResponse(400, { error: 'User has not been registered on the platform yet' });
    }
    safeWalkId = resolved;
  } catch (error) {
    console.error('Error resolving safeWalkId:', error);
    return jsonResponse(500, { error: 'Failed to resolve user identity' });
  }

  try {
    await docClient.send(
      new DeleteCommand({ TableName: locationsTable, Key: { safeWalkId } }),
    );
  } catch (error) {
    console.error('Error deleting location:', error);
    return jsonResponse(500, { error: 'Failed to delete location' });
  }

  return { statusCode: 204, body: '' };
}

// GET /location/contacts — Get all contacts' live locations
async function handleGetContactLocations(
  event: APIGatewayProxyEventV2,
  locationsTable: string,
  usersTable: string,
): Promise<APIGatewayProxyResultV2> {
  const platformDomain = getEnv('PLATFORM_DOMAIN');
  if (!platformDomain) return missingEnvResponse('PLATFORM_DOMAIN');
  const apiKey = getEnv('API_KEY');
  if (!apiKey) return missingEnvResponse('API_KEY');

  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  let safeWalkId: string;
  try {
    const resolved = await resolveUserSafeWalkId(userId, usersTable);
    if (!resolved) {
      return jsonResponse(400, { error: 'User has not been registered on the platform yet' });
    }
    safeWalkId = resolved;
  } catch (error) {
    console.error('Error resolving safeWalkId:', error);
    return jsonResponse(500, { error: 'Failed to resolve user identity' });
  }

  let sharingContacts: Map<string, string>;
  try {
    sharingContacts = await resolveContactsWhoShareLocation(safeWalkId);
  } catch (error) {
    console.error('Error resolving contacts:', error);
    return jsonResponse(502, { error: 'Failed to fetch trusted contacts' });
  }

  if (sharingContacts.size === 0) {
    return jsonResponse(200, { locations: [] });
  }

  const contactIds = Array.from(sharingContacts.keys());

  try {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const locations: ContactLocationResponse[] = [];

    // BatchGetItem supports max 100 keys per request
    for (let i = 0; i < contactIds.length; i += 100) {
      const batch = contactIds.slice(i, i + 100);
      const result = await docClient.send(
        new BatchGetCommand({
          RequestItems: {
            [locationsTable]: {
              Keys: batch.map((id) => ({ safeWalkId: id })),
            },
          },
        }),
      );

      const items = result.Responses?.[locationsTable] ?? [];
      for (const item of items) {
        if ((item.expiresAt as number) > nowEpoch) {
          locations.push({
            safeWalkId: item.safeWalkId as string,
            displayName: sharingContacts.get(item.safeWalkId as string) ?? 'Unbenannte Kontaktperson',
            lat: item.lat as number,
            lng: item.lng as number,
            accuracy: item.accuracy as number,
            updatedAt: item.updatedAt as string,
          });
        }
      }
    }

    return jsonResponse(200, { locations });
  } catch (error) {
    console.error('Error fetching locations:', error);
    return jsonResponse(500, { error: 'Failed to fetch contact locations' });
  }
}

async function handleGetSingleContactLocation(
  event: APIGatewayProxyEventV2,
  locationsTable: string,
  usersTable: string,
): Promise<APIGatewayProxyResultV2> {
  const platformDomain = getEnv('PLATFORM_DOMAIN');
  if (!platformDomain) return missingEnvResponse('PLATFORM_DOMAIN');
  const apiKey = getEnv('API_KEY');
  if (!apiKey) return missingEnvResponse('API_KEY');

  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  const targetSafeWalkId = event.pathParameters?.safeWalkId;
  if (!targetSafeWalkId) {
    return jsonResponse(400, { error: 'Missing safeWalkId path parameter' });
  }

  let safeWalkId: string;
  try {
    const resolved = await resolveUserSafeWalkId(userId, usersTable);
    if (!resolved) {
      return jsonResponse(400, { error: 'User has not been registered on the platform yet' });
    }
    safeWalkId = resolved;
  } catch (error) {
    console.error('Error resolving safeWalkId:', error);
    return jsonResponse(500, { error: 'Failed to resolve user identity' });
  }

  let sharingContacts: Map<string, string>;
  try {
    sharingContacts = await resolveContactsWhoShareLocation(safeWalkId);
  } catch (error) {
    console.error('Error resolving contacts:', error);
    return jsonResponse(502, { error: 'Failed to fetch trusted contacts' });
  }

  if (!sharingContacts.has(targetSafeWalkId)) {
    return jsonResponse(404, { error: 'Contact not found or not sharing location' });
  }

  try {
    const result = await docClient.send(
      new GetCommand({ TableName: locationsTable, Key: { safeWalkId: targetSafeWalkId } }),
    );

    if (!result.Item) {
      return jsonResponse(404, { error: 'Contact is not currently sharing their location' });
    }

    const nowEpoch = Math.floor(Date.now() / 1000);
    if ((result.Item.expiresAt as number) <= nowEpoch) {
      return jsonResponse(404, { error: 'Contact location has expired' });
    }

    const location: ContactLocationResponse = {
      safeWalkId: result.Item.safeWalkId as string,
      displayName: sharingContacts.get(targetSafeWalkId) ?? 'Unbenannte Kontaktperson',
      lat: result.Item.lat as number,
      lng: result.Item.lng as number,
      accuracy: result.Item.accuracy as number,
      updatedAt: result.Item.updatedAt as string,
    };

    return jsonResponse(200, location);
  } catch (error) {
    console.error('Error fetching location:', error);
    return jsonResponse(500, { error: 'Failed to fetch contact location' });
  }
}

// ---------------------------------------------------------------------------
// HTTP helper — supports GET, POST, PATCH, DELETE to the platform
// ---------------------------------------------------------------------------

async function sendRequest<T>(url: string, method: HttpMethod, apiKey: string, payload?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const data = payload !== undefined ? JSON.stringify(payload) : undefined;
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    };
    if (data !== undefined) {
      headers['Content-Length'] = Buffer.byteLength(data);
    }

    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers,
    };

    const req = httpModule.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(responseData) as T);
          } catch {
            reject(new Error(`Failed to parse platform response: ${responseData}`));
          }
        } else {
          reject(new Error(`Platform returned status ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.setTimeout(15000);
    if (data !== undefined) req.write(data);
    req.end();
  });
}
