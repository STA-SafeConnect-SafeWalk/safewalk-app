import {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  SNSClient,
  CreatePlatformEndpointCommand,
  DeleteEndpointCommand,
  PublishCommand,
  SetEndpointAttributesCommand,
} from '@aws-sdk/client-sns';

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;
type Result = APIGatewayProxyResultV2;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sns = new SNSClient({});

const TABLE_NAME = process.env.DEVICE_TOKENS_TABLE!;
const FCM_PLATFORM_APP_ARN = process.env.FCM_PLATFORM_APP_ARN || '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const json = (statusCode: number, body: Record<string, unknown>): Result => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const parseBody = (event: Event): Record<string, unknown> => {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return {};
  }
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = async (event: Event): Promise<Result> => {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const userId = event.requestContext.authorizer.jwt.claims.sub as string;

  console.log('Notification handler:', method, path, 'user:', userId);

  try {
    if (path === '/device/register' && method === 'POST') {
      return registerDevice(userId, event);
    }
    if (path === '/device/unregister' && method === 'POST') {
      return unregisterDevice(userId, event);
    }
    if (path === '/notifications/send' && method === 'POST') {
      return sendNotification(userId, event);
    }
    return json(404, { message: 'Not found' });
  } catch (err) {
    console.error('Unhandled error:', err);
    return json(500, { message: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------
// POST /device/register
// Body: { deviceToken: string, platform: 'android' | 'ios' | 'web' }
// Creates an SNS platform endpoint and stores the user–device mapping.
// ---------------------------------------------------------------------------

async function registerDevice(userId: string, event: Event): Promise<Result> {
  const body = parseBody(event);
  const deviceToken = body.deviceToken as string | undefined;
  const platform = body.platform as string | undefined;

  if (!deviceToken || !platform) {
    return json(400, { message: 'deviceToken and platform are required' });
  }

  if (!FCM_PLATFORM_APP_ARN) {
    return json(503, {
      message:
        'Push notifications are not configured yet. FCM Platform Application ARN is missing.',
    });
  }

  // Create (or retrieve existing) SNS platform endpoint for this token.
  const endpointResponse = await sns.send(
    new CreatePlatformEndpointCommand({
      PlatformApplicationArn: FCM_PLATFORM_APP_ARN,
      Token: deviceToken,
      CustomUserData: userId,
    }),
  );

  const endpointArn = endpointResponse.EndpointArn!;

  // Ensure the endpoint is enabled and the token is current.
  await sns.send(
    new SetEndpointAttributesCommand({
      EndpointArn: endpointArn,
      Attributes: { Enabled: 'true', Token: deviceToken },
    }),
  );

  // Persist the mapping in DynamoDB.
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        userId,
        deviceToken,
        endpointArn,
        platform,
        updatedAt: new Date().toISOString(),
      },
    }),
  );

  console.log('Device registered:', endpointArn, 'for user:', userId);

  return json(200, { message: 'Device registered', endpointArn });
}

// ---------------------------------------------------------------------------
// POST /device/unregister
// Body: { deviceToken: string }
// Removes the SNS endpoint and deletes the DynamoDB record.
// ---------------------------------------------------------------------------

async function unregisterDevice(
  userId: string,
  event: Event,
): Promise<Result> {
  const body = parseBody(event);
  const deviceToken = body.deviceToken as string | undefined;

  if (!deviceToken) {
    return json(400, { message: 'deviceToken is required' });
  }

  // Look up the endpoint ARN so we can delete it from SNS.
  const record = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { userId, deviceToken },
    }),
  );

  if (record.Item?.endpointArn) {
    try {
      await sns.send(
        new DeleteEndpointCommand({ EndpointArn: record.Item.endpointArn }),
      );
    } catch (err) {
      console.warn('Failed to delete SNS endpoint (non-fatal):', err);
    }
  }

  // Remove from DynamoDB regardless.
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { userId, deviceToken },
    }),
  );

  console.log('Device unregistered for user:', userId);

  return json(200, { message: 'Device unregistered' });
}

// ---------------------------------------------------------------------------
// POST /notifications/send
// Body: { targetUserId: string, title: string, body: string, data?: object }
// Sends a push notification to all devices registered by the target user.
// ---------------------------------------------------------------------------

async function sendNotification(
  _senderId: string,
  event: Event,
): Promise<Result> {
  const body = parseBody(event);
  const targetUserId = body.targetUserId as string | undefined;
  const title = body.title as string | undefined;
  const message = body.body as string | undefined;
  const data = (body.data as Record<string, string> | undefined) ?? {};

  if (!targetUserId || !title || !message) {
    return json(400, {
      message: 'targetUserId, title, and body are required',
    });
  }

  // Fetch all device endpoints for the target user.
  const devices = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': targetUserId },
    }),
  );

  if (!devices.Items || devices.Items.length === 0) {
    return json(404, { message: 'No registered devices for target user' });
  }

  // Publish to each endpoint via SNS.
  const results = await Promise.allSettled(
    devices.Items.map(async (device) => {
      const payload = JSON.stringify({
        GCM: JSON.stringify({
          notification: { title, body: message },
          data,
        }),
      });

      await sns.send(
        new PublishCommand({
          TargetArn: device.endpointArn as string,
          Message: payload,
          MessageStructure: 'json',
        }),
      );
    }),
  );

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  console.log(
    `Notification to ${targetUserId}: sent=${sent}, failed=${failed}`,
  );

  return json(200, { sent, failed });
}
