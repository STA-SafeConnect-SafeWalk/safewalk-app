import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import * as https from 'https';
import * as http from 'http';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

interface PlatformRegistrationPayload {
  platformUserId: string;
  platformId: string;
}

interface SharingCodePayload {
  safeWalkId: string;
}

/** sharing code must be fetched separately. */
interface PlatformRegistrationResponse {
  success: boolean;
  data: {
    safeWalkId: string;
  };
}

/** Response from POST /sharing-codes --> valid for 24 hours. */
interface SharingCodeResponse {
  success: boolean;
  data: {
    sharingCode: string;
    safeWalkId: string;
    createdAt: string;
    expiresAt: string;
  };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const platformBaseDomain = process.env.PLATFORM_DOMAIN;
  const platformId = process.env.VENDOR_ID;
  const tableName = process.env.TABLE_NAME;
  const apiKey = process.env.API_KEY;

  if (!platformBaseDomain) {
    console.error('PLATFORM_DOMAIN environment variable is not set');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error: PLATFORM_DOMAIN not set' }),
    };
  }

  if (!platformId) {
    console.error('VENDOR_ID environment variable is not set');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error: VENDOR_ID not set' }),
    };
  }

  if (!tableName) {
    console.error('TABLE_NAME environment variable is not set');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error: TABLE_NAME not set' }),
    };
  }

  if (!apiKey) {
    console.error('API_KEY environment variable is not set');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error: API_KEY not set' }),
    };
  }

  const registerUrl = platformBaseDomain + '/register';
  const sharingCodesUrl = platformBaseDomain + '/sharing-codes';

  // Identify the caller via the JWT sub injected by the API Gateway JWT authorizer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (event.requestContext as any).authorizer?.jwt?.claims?.sub as string | undefined;
  if (!userId) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  let existingSafeWalkId: string | undefined;
  try {
    const existingUser = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          safeWalkAppId: userId,
        },
      })
    );

    if (existingUser.Item?.sharingCode && existingUser.Item?.sharingCodeExpiresAt) {
      const expiresAt = new Date(existingUser.Item.sharingCodeExpiresAt as string);
      if (expiresAt > new Date()) {
        console.log('User already has a valid sharing code, returning existing:', existingUser.Item.sharingCode);
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'User already registered',
            userId,
            sharingCode: existingUser.Item.sharingCode,
            sharingCodeExpiresAt: existingUser.Item.sharingCodeExpiresAt,
          }),
        };
      }
      console.log('Existing sharing code has expired, requesting a new one');
      existingSafeWalkId = existingUser.Item.safeWalkId as string;
    } else if (existingUser.Item?.safeWalkId) {
      existingSafeWalkId = existingUser.Item.safeWalkId as string;
    }
  } catch (error) {
    console.error('Error checking existing user:', error);
  }

  try {
    let safeWalkId: string;

    if (existingSafeWalkId) {
      safeWalkId = existingSafeWalkId;
      console.log('Reusing existing safeWalkId:', safeWalkId);
    } else {
      // register the user on the platform
      const registrationPayload: PlatformRegistrationPayload = {
        platformUserId: userId,
        platformId: platformId,
      };

      const registrationResponse = await sendRequest<PlatformRegistrationResponse>(
        registerUrl,
        registrationPayload,
        apiKey
      );
      console.log('Platform registration successful:', registrationResponse);

      if (!registrationResponse.success || !registrationResponse.data?.safeWalkId) {
        console.error('Invalid platform registration response: missing success or safeWalkId');
        return {
          statusCode: 502,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'Invalid platform response',
            details: 'Registration response missing required field: safeWalkId',
          }),
        };
      }

      safeWalkId = registrationResponse.data.safeWalkId;
    }

    // Generate a sharing code with 24 hours of validity
    const sharingCodePayload: SharingCodePayload = { safeWalkId };
    const sharingCodeResponse = await sendRequest<SharingCodeResponse>(
      sharingCodesUrl,
      sharingCodePayload,
      apiKey
    );
    console.log('Sharing code generated:', sharingCodeResponse);

    if (!sharingCodeResponse.success || !sharingCodeResponse.data?.sharingCode || !sharingCodeResponse.data?.expiresAt) {
      console.error('Invalid sharing code response: missing success, sharingCode, or expiresAt');
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Invalid platform response',
          details: 'Sharing code response missing required fields: sharingCode or expiresAt',
        }),
      };
    }

    const { sharingCode, expiresAt: sharingCodeExpiresAt } = sharingCodeResponse.data;

    // Persist safeWalkId, sharingCode, and expiry in DynamoDB
    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          safeWalkAppId: userId,
        },
        UpdateExpression:
          'SET safeWalkId = :safeWalkId, sharingCode = :sharingCode, sharingCodeExpiresAt = :sharingCodeExpiresAt, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':safeWalkId': safeWalkId,
          ':sharingCode': sharingCode,
          ':sharingCodeExpiresAt': sharingCodeExpiresAt,
          ':updatedAt': new Date().toISOString(),
        },
      })
    );

    console.log('Successfully stored registration data in database for user:', userId);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: existingSafeWalkId ? 'Sharing code refreshed' : 'Platform registration successful',
        userId,
        sharingCode,
        sharingCodeExpiresAt,
      }),
    };
  } catch (error) {
    console.error('Platform registration failed:', error);
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to register with platform',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

async function sendRequest<T>(domain: string, payload: unknown, apiKey: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const data = JSON.stringify(payload);

    // Parse the domain to determine protocol and path
    const url = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'x-api-key': apiKey,
      },
    };

    console.log('Sending request to platform:', {
      hostname: options.hostname,
      port: options.port,
      path: options.path,
      method: options.method,
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
          } catch (error) {
            reject(new Error(`Failed to parse platform response: ${responseData}`));
          }
        } else {
          reject(new Error(`Platform returned status ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('Request error:', error);
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.setTimeout(15000); // 15 second timeout
    req.write(data);
    req.end();
  });
}
