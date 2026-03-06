import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import * as https from 'https';
import * as http from 'http';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

interface GenerateSharingCodeRequest {
  userId: string;
}

interface ConnectWithCodeRequest {
  userId: string;
  sharingCode: string;
}

interface PlatformSharingCodePayload {
  safeWalkId: string;
}

/** Response from POST /sharing-codes on the platform --> valid for 24 hours. */
interface PlatformSharingCodeResponse {
  success: boolean;
  data: {
    sharingCode: string;
    safeWalkId: string;
    createdAt: string;
    expiresAt: string;
  };
}

interface PlatformTrustedContactPayload {
  requesterSafeWalkId: string;
  sharingCode: string;
}

interface PlatformTrustedContactResponse {
  success: boolean;
  data?: Record<string, unknown>;
}

interface TrustedContact {
  contactId: string;
  safeWalkId: string;
  displayName?: string;
  locationSharing: boolean;
  sosSharing: boolean;
}

interface PlatformListContactsResponse {
  success: boolean;
  data: {
    contacts: TrustedContact[];
  };
}

interface UpdateContactSettingsRequest {
  userId: string;
  locationSharing: boolean;
  sosSharing: boolean;
}

interface PlatformUpdateContactPayload {
  safeWalkId: string;
  locationSharing: boolean;
  sosSharing: boolean;
}

interface PlatformUpdateContactResponse {
  success: boolean;
  data?: Record<string, unknown>;
}

interface PlatformDeleteContactPayload {
  safeWalkId: string;
}

interface PlatformDeleteContactResponse {
  success: boolean;
  data?: Record<string, unknown>;
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

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const tableName = getEnv('TABLE_NAME');
  if (!tableName) return missingEnvResponse('TABLE_NAME');

  switch (event.routeKey) {
    case 'GET /sharing-code':
      return handleGetSharingCode(event, tableName);

    case 'POST /sharing-code':
      return handleGenerateSharingCode(event, tableName);

    case 'POST /sharing-code/connect':
      return handleConnectWithCode(event, tableName);

    case 'GET /contacts':
      return handleListContacts(event, tableName);

    case 'PATCH /contacts/{contactId}':
      return handleUpdateContactSettings(event, tableName);

    case 'DELETE /contacts/{contactId}':
      return handleDeleteContact(event, tableName);

    default:
      return jsonResponse(404, { error: 'Route not found' });
  }
};

async function handleGetSharingCode(
  event: APIGatewayProxyEventV2,
  tableName: string,
): Promise<APIGatewayProxyResultV2> {
  const userId = event.queryStringParameters?.userId;
  if (!userId) {
    return jsonResponse(400, { error: 'userId query parameter is required' });
  }

  try {
    const result = await docClient.send(
      new GetCommand({ TableName: tableName, Key: { safeWalkAppId: userId } }),
    );

    if (!result.Item) {
      return jsonResponse(404, { error: 'User not found' });
    }

    const { sharingCode, sharingCodeExpiresAt } = result.Item;
    if (!sharingCode || !sharingCodeExpiresAt) {
      return jsonResponse(404, { error: 'No sharing code found for this user' });
    }

    return jsonResponse(200, { sharingCode, sharingCodeExpiresAt });
  } catch (error) {
    console.error('Error fetching sharing code:', error);
    return jsonResponse(500, {
      error: 'Failed to retrieve sharing code',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function handleGenerateSharingCode(
  event: APIGatewayProxyEventV2,
  tableName: string,
): Promise<APIGatewayProxyResultV2> {
  const platformBaseDomain = getEnv('PLATFORM_DOMAIN');
  if (!platformBaseDomain) return missingEnvResponse('PLATFORM_DOMAIN');

  const apiKey = getEnv('API_KEY');
  if (!apiKey) return missingEnvResponse('API_KEY');

  let requestBody: GenerateSharingCodeRequest;
  try {
    if (!event.body) return jsonResponse(400, { error: 'Request body is required' });
    requestBody = JSON.parse(event.body) as GenerateSharingCodeRequest;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON in request body' });
  }

  if (!requestBody.userId || typeof requestBody.userId !== 'string') {
    return jsonResponse(400, { error: 'userId is required and must be a string' });
  }

  let safeWalkId: string;
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: tableName, Key: { safeWalkAppId: requestBody.userId } }),
    );

    if (!result.Item?.safeWalkId) {
      return jsonResponse(400, { error: 'User has not been registered on the platform yet' });
    }
    safeWalkId = result.Item.safeWalkId as string;
  } catch (error) {
    console.error('Error retrieving user:', error);
    return jsonResponse(500, {
      error: 'Failed to retrieve user data',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  const sharingCodesUrl = `${platformBaseDomain}/sharing-codes`;
  const payload: PlatformSharingCodePayload = { safeWalkId };

  try {
    const platformResponse = await sendRequest<PlatformSharingCodeResponse>(
      sharingCodesUrl,
      'POST',
      apiKey,
      payload,
    );

    if (!platformResponse.success || !platformResponse.data?.sharingCode || !platformResponse.data?.expiresAt) {
      console.error('Invalid platform sharing code response:', platformResponse);
      return jsonResponse(502, {
        error: 'Invalid platform response',
        details: 'Sharing code response missing required fields',
      });
    }

    const { sharingCode, expiresAt: sharingCodeExpiresAt } = platformResponse.data;

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { safeWalkAppId: requestBody.userId },
        UpdateExpression:
          'SET sharingCode = :sharingCode, sharingCodeExpiresAt = :sharingCodeExpiresAt, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':sharingCode': sharingCode,
          ':sharingCodeExpiresAt': sharingCodeExpiresAt,
          ':updatedAt': new Date().toISOString(),
        },
      }),
    );

    console.log('Sharing code generated and stored for user:', requestBody.userId);
    return jsonResponse(200, { sharingCode, sharingCodeExpiresAt });
  } catch (error) {
    console.error('Error generating sharing code:', error);
    return jsonResponse(502, {
      error: 'Failed to generate sharing code',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function handleConnectWithCode(
  event: APIGatewayProxyEventV2,
  tableName: string,
): Promise<APIGatewayProxyResultV2> {
  const platformBaseDomain = getEnv('PLATFORM_DOMAIN');
  if (!platformBaseDomain) return missingEnvResponse('PLATFORM_DOMAIN');

  const apiKey = getEnv('API_KEY');
  if (!apiKey) return missingEnvResponse('API_KEY');

  let requestBody: ConnectWithCodeRequest;
  try {
    if (!event.body) return jsonResponse(400, { error: 'Request body is required' });
    requestBody = JSON.parse(event.body) as ConnectWithCodeRequest;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON in request body' });
  }

  if (!requestBody.userId || typeof requestBody.userId !== 'string') {
    return jsonResponse(400, { error: 'userId is required and must be a string' });
  }
  if (!requestBody.sharingCode || typeof requestBody.sharingCode !== 'string') {
    return jsonResponse(400, { error: 'sharingCode is required and must be a string' });
  }

  let safeWalkId: string;
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: tableName, Key: { safeWalkAppId: requestBody.userId } }),
    );

    if (!result.Item?.safeWalkId) {
      return jsonResponse(400, { error: 'User has not been registered on the platform yet' });
    }
    safeWalkId = result.Item.safeWalkId as string;
  } catch (error) {
    console.error('Error retrieving user:', error);
    return jsonResponse(500, {
      error: 'Failed to retrieve user data',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  const trustedContactsUrl = `${platformBaseDomain}/contacts`;
  const payload: PlatformTrustedContactPayload = {
    requesterSafeWalkId: safeWalkId,
    sharingCode: requestBody.sharingCode,
  };

  try {
    const platformResponse = await sendRequest<PlatformTrustedContactResponse>(
      trustedContactsUrl,
      'POST',
      apiKey,
      payload,
    );

    if (!platformResponse.success) {
      console.error('Platform rejected trusted contact registration:', platformResponse);
      return jsonResponse(502, { error: 'Platform rejected trusted contact registration' });
    }

    console.log('Successfully registered as trusted contact for user:', requestBody.userId);
    return jsonResponse(200, { message: 'Successfully connected as trusted contact' });
  } catch (error) {
    console.error('Error registering as trusted contact:', error);
    return jsonResponse(502, {
      error: 'Failed to register as trusted contact',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function handleListContacts(
  event: APIGatewayProxyEventV2,
  tableName: string,
): Promise<APIGatewayProxyResultV2> {
  const platformBaseDomain = getEnv('PLATFORM_DOMAIN');
  if (!platformBaseDomain) return missingEnvResponse('PLATFORM_DOMAIN');

  const apiKey = getEnv('API_KEY');
  if (!apiKey) return missingEnvResponse('API_KEY');

  const userId = event.queryStringParameters?.userId;
  if (!userId) return jsonResponse(400, { error: 'userId query parameter is required' });

  let safeWalkId: string;
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: tableName, Key: { safeWalkAppId: userId } }),
    );
    if (!result.Item?.safeWalkId) {
      return jsonResponse(400, { error: 'User has not been registered on the platform yet' });
    }
    safeWalkId = result.Item.safeWalkId as string;
  } catch (error) {
    console.error('Error retrieving user:', error);
    return jsonResponse(500, {
      error: 'Failed to retrieve user data',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  try {
    const contactsUrl = `${platformBaseDomain}/contacts/${encodeURIComponent(safeWalkId)}`;
    const platformResponse = await sendRequest<PlatformListContactsResponse>(
      contactsUrl,
      'GET',
      apiKey,
    );

    if (!platformResponse.success) {
      return jsonResponse(502, { error: 'Platform rejected contacts list request' });
    }

    return jsonResponse(200, { contacts: platformResponse.data.contacts });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    return jsonResponse(502, {
      error: 'Failed to fetch trusted contacts',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function handleUpdateContactSettings(
  event: APIGatewayProxyEventV2,
  tableName: string,
): Promise<APIGatewayProxyResultV2> {
  const platformBaseDomain = getEnv('PLATFORM_DOMAIN');
  if (!platformBaseDomain) return missingEnvResponse('PLATFORM_DOMAIN');

  const apiKey = getEnv('API_KEY');
  if (!apiKey) return missingEnvResponse('API_KEY');

  const contactId = event.pathParameters?.contactId;
  if (!contactId) return jsonResponse(400, { error: 'contactId path parameter is required' });

  let requestBody: UpdateContactSettingsRequest;
  try {
    if (!event.body) return jsonResponse(400, { error: 'Request body is required' });
    requestBody = JSON.parse(event.body) as UpdateContactSettingsRequest;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON in request body' });
  }

  if (!requestBody.userId || typeof requestBody.userId !== 'string') {
    return jsonResponse(400, { error: 'userId is required and must be a string' });
  }
  if (typeof requestBody.locationSharing !== 'boolean') {
    return jsonResponse(400, { error: 'locationSharing is required and must be a boolean' });
  }
  if (typeof requestBody.sosSharing !== 'boolean') {
    return jsonResponse(400, { error: 'sosSharing is required and must be a boolean' });
  }

  let safeWalkId: string;
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: tableName, Key: { safeWalkAppId: requestBody.userId } }),
    );
    if (!result.Item?.safeWalkId) {
      return jsonResponse(400, { error: 'User has not been registered on the platform yet' });
    }
    safeWalkId = result.Item.safeWalkId as string;
  } catch (error) {
    console.error('Error retrieving user:', error);
    return jsonResponse(500, {
      error: 'Failed to retrieve user data',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  const updateUrl = `${platformBaseDomain}/contacts/${encodeURIComponent(contactId)}`;
  const payload: PlatformUpdateContactPayload = {
    safeWalkId,
    locationSharing: requestBody.locationSharing,
    sosSharing: requestBody.sosSharing,
  };

  try {
    const platformResponse = await sendRequest<PlatformUpdateContactResponse>(
      updateUrl,
      'PATCH',
      apiKey,
      payload,
    );

    if (!platformResponse.success) {
      return jsonResponse(502, { error: 'Platform rejected contact settings update' });
    }

    console.log('Contact settings updated for contactId:', contactId, 'by user:', requestBody.userId);
    return jsonResponse(200, { message: 'Contact settings updated successfully' });
  } catch (error) {
    console.error('Error updating contact settings:', error);
    return jsonResponse(502, {
      error: 'Failed to update contact settings',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function handleDeleteContact(
  event: APIGatewayProxyEventV2,
  tableName: string,
): Promise<APIGatewayProxyResultV2> {
  const platformBaseDomain = getEnv('PLATFORM_DOMAIN');
  if (!platformBaseDomain) return missingEnvResponse('PLATFORM_DOMAIN');

  const apiKey = getEnv('API_KEY');
  if (!apiKey) return missingEnvResponse('API_KEY');

  const contactId = event.pathParameters?.contactId;
  if (!contactId) return jsonResponse(400, { error: 'contactId path parameter is required' });

  const userId = event.queryStringParameters?.userId;
  if (!userId) return jsonResponse(400, { error: 'userId query parameter is required' });

  let safeWalkId: string;
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: tableName, Key: { safeWalkAppId: userId } }),
    );
    if (!result.Item?.safeWalkId) {
      return jsonResponse(400, { error: 'User has not been registered on the platform yet' });
    }
    safeWalkId = result.Item.safeWalkId as string;
  } catch (error) {
    console.error('Error retrieving user:', error);
    return jsonResponse(500, {
      error: 'Failed to retrieve user data',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  const deleteUrl = `${platformBaseDomain}/contacts/${encodeURIComponent(contactId)}`;

  try {
    const platformResponse = await sendRequest<PlatformDeleteContactResponse>(
      deleteUrl,
      'DELETE',
      apiKey,
    );

    if (!platformResponse.success) {
      return jsonResponse(502, { error: 'Platform rejected contact deletion' });
    }

    console.log('Trusted contact deleted, contactId:', contactId, 'by user:', userId);
    return jsonResponse(200, { message: 'Trusted contact removed successfully' });
  } catch (error) {
    console.error('Error deleting contact:', error);
    return jsonResponse(502, {
      error: 'Failed to delete trusted contact',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// ---------------------------------------------------------------------------
// HTTP helper – supports GET, POST, PATCH, DELETE to the platform
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

    console.log('Sending request to platform:', {
      hostname: options.hostname,
      port: options.port,
      path: options.path,
      method,
    });

    const req = httpModule.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        console.log('Platform response status:', res.statusCode);
        console.log('Platform response body:', responseData);
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
