import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, SQSEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { randomUUID } from 'crypto';
import * as https from 'https';
import * as http from 'http';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sqsClient = new SQSClient({});

const SOS_TTL_DAYS = 30;
const DEFAULT_PROPAGATION_DELAY_SECONDS = 10;

interface GeoLocation {
  lat: number;
  lng: number;
  accuracy?: number;
}

interface TriggerSOSRequest {
  geoLocation?: GeoLocation;
}

interface UpdateSOSRequest {
  geoLocation?: GeoLocation;
}

interface PlatformSOSResponse {
  success: boolean;
  data: {
    sosId: string;
    status: string;
    contactsNotified: number;
    createdAt: string;
  };
}

interface PlatformLocationUpdateResponse {
  success: boolean;
  data: {
    sosId: string;
    status: string;
    contactsNotified: number;
    latestGeoLocation: GeoLocation;
    updatedAt: string;
  };
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const getEnv = (name: string): string | undefined => process.env[name];

const jsonResponse = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const missingEnvResponse = (name: string): APIGatewayProxyResultV2 => ({
  statusCode: 500,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ error: `Server configuration error: ${name} not set` }),
});

const getAuthenticatedUserId = (event: APIGatewayProxyEventV2): string | undefined => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = event.requestContext as any;
  return ctx.authorizer?.jwt?.claims?.sub as string | undefined;
};

const UNAUTHORIZED_RESPONSE: APIGatewayProxyResultV2 = {
  statusCode: 401,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ error: 'Unauthorized' }),
};

function isValidGeoLocation(geo: unknown): geo is GeoLocation {
  if (!geo || typeof geo !== 'object') return false;
  const g = geo as Record<string, unknown>;
  if (typeof g.lat !== 'number' || typeof g.lng !== 'number') return false;
  if (g.lat < -90 || g.lat > 90) return false;
  if (g.lng < -180 || g.lng > 180) return false;
  if (g.accuracy !== undefined && (typeof g.accuracy !== 'number' || g.accuracy < 0)) return false;
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler = async (event: any): Promise<any> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  if (event.Records && event.Records[0]?.eventSource === 'aws:sqs') {
    return handleSQSEvent(event as SQSEvent);
  }

  return handleAPIGatewayEvent(event as APIGatewayProxyEventV2);
};

async function handleAPIGatewayEvent(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const sosTableName = getEnv('SOS_TABLE_NAME');
  if (!sosTableName) return missingEnvResponse('SOS_TABLE_NAME');

  const appUsersTableName = getEnv('APP_USERS_TABLE_NAME');
  if (!appUsersTableName) return missingEnvResponse('APP_USERS_TABLE_NAME');

  switch (event.routeKey) {
    case 'POST /sos':
      return handleTriggerSOS(event, sosTableName, appUsersTableName);
    case 'PATCH /sos/{sosId}':
      return handleUpdateSOS(event, sosTableName);
    case 'DELETE /sos/{sosId}':
      return handleCancelSOS(event, sosTableName);
    default:
      return jsonResponse(404, { error: 'Route not found' });
  }
}

async function handleTriggerSOS(
  event: APIGatewayProxyEventV2,
  sosTableName: string,
  appUsersTableName: string,
): Promise<APIGatewayProxyResultV2> {
  const queueUrl = getEnv('QUEUE_URL');
  if (!queueUrl) return missingEnvResponse('QUEUE_URL');

  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  let requestBody: TriggerSOSRequest;
  try {
    if (!event.body) return jsonResponse(400, { error: 'Request body is required' });
    requestBody = JSON.parse(event.body) as TriggerSOSRequest;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON in request body' });
  }

  if (requestBody.geoLocation !== undefined && !isValidGeoLocation(requestBody.geoLocation)) {
    return jsonResponse(400, {
      error: 'Valid geoLocation with lat (-90..90) and lng (-180..180) is required',
    });
  }

  // Look up user to get safeWalkId
  let safeWalkId: string;
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: appUsersTableName, Key: { safeWalkAppId: userId } }),
    );
    if (!result.Item?.safeWalkId) {
      return jsonResponse(400, { error: 'User has not been registered on the platform yet' });
    }
    safeWalkId = result.Item.safeWalkId as string;
  } catch (error) {
    console.error('Error retrieving user:', error);
    return jsonResponse(500, { error: 'Failed to retrieve user data' });
  }

  // Supersede any existing PENDING or ACTIVE SOS for this user
  try {
    const existingResult = await docClient.send(
      new QueryCommand({
        TableName: sosTableName,
        IndexName: 'UserIndex',
        KeyConditionExpression: 'userId = :userId',
        FilterExpression: '#s IN (:pending, :active)',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':userId': userId,
          ':pending': 'PENDING',
          ':active': 'ACTIVE',
        },
      }),
    );

    for (const item of existingResult.Items ?? []) {
      await docClient.send(
        new UpdateCommand({
          TableName: sosTableName,
          Key: { sosId: item.sosId },
          UpdateExpression: 'SET #s = :superseded, updatedAt = :now',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':superseded': 'SUPERSEDED',
            ':now': new Date().toISOString(),
          },
        }),
      );
      console.log(`Superseded existing SOS: ${item.sosId}`);
    }
  } catch (error) {
    console.error('Error superseding existing SOS events:', error);
    // Non-fatal: continue with creating new SOS
  }

  const sosId = randomUUID();
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + SOS_TTL_DAYS * 24 * 60 * 60;

  try {
    await docClient.send(
      new PutCommand({
        TableName: sosTableName,
        Item: {
          sosId,
          userId,
          safeWalkId,
          status: 'PENDING',
          ...(requestBody.geoLocation !== undefined && { geoLocation: requestBody.geoLocation }),
          createdAt: now,
          updatedAt: now,
          ttl,
        },
      }),
    );
  } catch (error) {
    console.error('Error creating SOS record:', error);
    return jsonResponse(500, { error: 'Failed to create SOS event' });
  }

  // Queue propagation with delay (SQS per-message delay)
  const delaySeconds = parseInt(
    getEnv('PROPAGATION_DELAY_SECONDS') ?? String(DEFAULT_PROPAGATION_DELAY_SECONDS),
    10,
  );

  try {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ sosId }),
        DelaySeconds: delaySeconds,
      }),
    );
  } catch (error) {
    console.error('Error queuing SOS propagation:', error);
    // SOS is saved locally — propagation won't auto-trigger but user
    // can cancel and retry if needed.
  }

  console.log(`SOS ${sosId} created for user ${userId}, propagation in ${delaySeconds}s`);
  return jsonResponse(201, {
    success: true,
    data: {
      sosId,
      status: 'PENDING',
      ...(requestBody.geoLocation !== undefined && { geoLocation: requestBody.geoLocation }),
      propagationDelaySeconds: delaySeconds,
      createdAt: now,
    },
  });
}

async function handleUpdateSOS(
  event: APIGatewayProxyEventV2,
  sosTableName: string,
): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  const sosId = event.pathParameters?.sosId;
  if (!sosId) return jsonResponse(400, { error: 'sosId path parameter is required' });

  let requestBody: UpdateSOSRequest;
  try {
    if (!event.body) return jsonResponse(400, { error: 'Request body is required' });
    requestBody = JSON.parse(event.body) as UpdateSOSRequest;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON in request body' });
  }

  if (requestBody.geoLocation !== undefined && !isValidGeoLocation(requestBody.geoLocation)) {
    return jsonResponse(400, {
      error: 'Valid geoLocation with lat (-90..90) and lng (-180..180) is required',
    });
  }

  // Get SOS record and verify ownership
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sosRecord: Record<string, any>;
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: sosTableName, Key: { sosId } }),
    );
    if (!result.Item) {
      return jsonResponse(404, { error: 'SOS event not found' });
    }
    if (result.Item.userId !== userId) {
      return jsonResponse(403, { error: 'Not authorized to update this SOS event' });
    }
    sosRecord = result.Item;
  } catch (error) {
    console.error('Error retrieving SOS record:', error);
    return jsonResponse(500, { error: 'Failed to retrieve SOS event' });
  }

  if (sosRecord.status === 'CANCELLED' || sosRecord.status === 'SUPERSEDED') {
    return jsonResponse(410, { error: 'SOS event is no longer active' });
  }

  const now = new Date().toISOString();

  // Update local record with latest geo location
  try {
    const updateExpression = requestBody.geoLocation !== undefined
      ? 'SET geoLocation = :geo, updatedAt = :now'
      : 'SET updatedAt = :now';
    const expressionValues: Record<string, unknown> = { ':now': now };
    if (requestBody.geoLocation !== undefined) expressionValues[':geo'] = requestBody.geoLocation;
    await docClient.send(
      new UpdateCommand({
        TableName: sosTableName,
        Key: { sosId },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionValues,
      }),
    );
  } catch (error) {
    console.error('Error updating SOS record:', error);
    return jsonResponse(500, { error: 'Failed to update SOS event' });
  }

  // If already propagated, forward location update to platform
  let platformUpdated = false;
  if (sosRecord.status === 'ACTIVE' && sosRecord.platformSosId && requestBody.geoLocation !== undefined) {
    const platformDomain = getEnv('PLATFORM_DOMAIN');
    const apiKey = getEnv('API_KEY');

    if (platformDomain && apiKey) {
      try {
        const platformUrl = `${platformDomain}/sos/${encodeURIComponent(sosRecord.platformSosId)}`;
        await sendRequest<PlatformLocationUpdateResponse>(platformUrl, 'PATCH', apiKey, {
          geoLocation: requestBody.geoLocation,
        });
        platformUpdated = true;
        console.log('Platform location update successful for SOS:', sosRecord.platformSosId);
      } catch (error) {
        console.error('Error updating location on platform:', error);
        // Non-fatal: local record is updated, platform will get the next update
      }
    }
  }

  return jsonResponse(200, {
    success: true,
    data: {
      sosId,
      status: sosRecord.status,
      ...(requestBody.geoLocation !== undefined && { geoLocation: requestBody.geoLocation }),
      updatedAt: now,
      platformUpdated,
    },
  });
}

async function handleCancelSOS(
  event: APIGatewayProxyEventV2,
  sosTableName: string,
): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  const sosId = event.pathParameters?.sosId;
  if (!sosId) return jsonResponse(400, { error: 'sosId path parameter is required' });

  // Get SOS record and verify ownership
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sosRecord: Record<string, any>;
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: sosTableName, Key: { sosId } }),
    );
    if (!result.Item) {
      return jsonResponse(404, { error: 'SOS event not found' });
    }
    if (result.Item.userId !== userId) {
      return jsonResponse(403, { error: 'Not authorized to cancel this SOS event' });
    }
    sosRecord = result.Item;
  } catch (error) {
    console.error('Error retrieving SOS record:', error);
    return jsonResponse(500, { error: 'Failed to retrieve SOS event' });
  }

  if (sosRecord.status === 'CANCELLED' || sosRecord.status === 'SUPERSEDED') {
    return jsonResponse(410, { error: 'SOS event is no longer active' });
  }

  const now = new Date().toISOString();

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: sosTableName,
        Key: { sosId },
        UpdateExpression: 'SET #s = :cancelled, updatedAt = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':cancelled': 'CANCELLED',
          ':now': now,
        },
      }),
    );
  } catch (error) {
    console.error('Error cancelling SOS record:', error);
    return jsonResponse(500, { error: 'Failed to cancel SOS event' });
  }

  // If already propagated to platform, cancel there too
  let platformCancelled = false;
  if (sosRecord.status === 'ACTIVE' && sosRecord.platformSosId) {
    const platformDomain = getEnv('PLATFORM_DOMAIN');
    const apiKey = getEnv('API_KEY');

    if (platformDomain && apiKey) {
      try {
        const platformUrl = `${platformDomain}/sos/${encodeURIComponent(sosRecord.platformSosId)}`;
        await sendRequest(platformUrl, 'DELETE', apiKey);
        platformCancelled = true;
        console.log('Platform SOS cancelled:', sosRecord.platformSosId);
      } catch (error) {
        console.error('Error cancelling SOS on platform:', error);
      }
    }
  }

  console.log(`SOS ${sosId} cancelled by user ${userId} (was ${sosRecord.status})`);

  return jsonResponse(200, {
    success: true,
    data: {
      sosId,
      status: 'CANCELLED',
      previousStatus: sosRecord.status,
      platformCancelled,
      cancelledAt: now,
    },
  });
}

async function handleSQSEvent(event: SQSEvent): Promise<void> {
  const sosTableName = getEnv('SOS_TABLE_NAME');
  const platformDomain = getEnv('PLATFORM_DOMAIN');
  const apiKey = getEnv('API_KEY');

  if (!sosTableName || !platformDomain || !apiKey) {
    console.error('Missing required environment variables for SOS propagation');
    return;
  }

  for (const record of event.Records) {
    let sosId: string;
    try {
      const body = JSON.parse(record.body);
      sosId = body.sosId;
    } catch {
      console.error('Invalid SQS message body:', record.body);
      continue;
    }

    console.log(`Processing delayed propagation for SOS: ${sosId}`);

    // Get the current SOS record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sosRecord: Record<string, any>;
    try {
      const result = await docClient.send(
        new GetCommand({ TableName: sosTableName, Key: { sosId } }),
      );
      if (!result.Item) {
        console.log(`SOS ${sosId} not found, skipping`);
        continue;
      }
      sosRecord = result.Item;
    } catch (error) {
      console.error(`Error retrieving SOS ${sosId}:`, error);
      continue;
    }

    if (sosRecord.status !== 'PENDING') {
      console.log(`SOS ${sosId} is ${sosRecord.status}, skipping propagation`);
      continue;
    }

    const now = new Date().toISOString();
    try {
      const platformResponse = await sendRequest<PlatformSOSResponse>(
        `${platformDomain}/sos`,
        'POST',
        apiKey,
        {
          safeWalkId: sosRecord.safeWalkId,
          geoLocation: sosRecord.geoLocation,
        },
      );

      if (!platformResponse.success || !platformResponse.data?.sosId) {
        console.error(`Platform SOS creation failed for ${sosId}:`, platformResponse);
        await updateSOSStatus(sosTableName, sosId, 'FAILED', now);
        continue;
      }

      // Transition PENDING → ACTIVE with optimistic locking
      await docClient.send(
        new UpdateCommand({
          TableName: sosTableName,
          Key: { sosId },
          UpdateExpression:
            'SET #s = :active, platformSosId = :pid, contactsNotified = :cn, updatedAt = :now',
          ConditionExpression: '#s = :pending',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':active': 'ACTIVE',
            ':pending': 'PENDING',
            ':pid': platformResponse.data.sosId,
            ':cn': platformResponse.data.contactsNotified,
            ':now': now,
          },
        }),
      );

      console.log(
        `SOS ${sosId} propagated → platform sosId ${platformResponse.data.sosId}, ` +
          `${platformResponse.data.contactsNotified} contacts notified`,
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        console.log(`SOS ${sosId} was cancelled/superseded during propagation, skipping`);
      } else {
        console.error(`Error propagating SOS ${sosId}:`, error);
        try {
          await updateSOSStatus(sosTableName, sosId, 'FAILED', now);
        } catch (updateError) {
          console.error(`Error marking SOS ${sosId} as FAILED:`, updateError);
        }
      }
    }
  }
}

async function updateSOSStatus(
  tableName: string,
  sosId: string,
  status: string,
  now: string,
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { sosId },
      UpdateExpression: 'SET #s = :status, updatedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':status': status,
        ':now': now,
      },
    }),
  );
}

async function sendRequest<T>(
  url: string,
  method: HttpMethod,
  apiKey: string,
  payload?: unknown,
): Promise<T> {
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
      res.on('data', (chunk) => {
        responseData += chunk;
      });
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
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.setTimeout(15000);
    if (data !== undefined) req.write(data);
    req.end();
  });
}
