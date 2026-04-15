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

async function registerDevice(userId: string, event: Event): Promise<Result> {
  const body = parseBody(event);
  const deviceToken = body.deviceToken as string | undefined;
  const platform = body.platform as string | undefined;

  if (!deviceToken || !platform) {
    return json(400, { message: 'deviceToken and platform are required' });
  }

  if (!FCM_PLATFORM_APP_ARN) {
    return json(503, { message: 'FCM Platform Application ARN is not configured' });
  }

  const endpointResponse = await sns.send(
    new CreatePlatformEndpointCommand({
      PlatformApplicationArn: FCM_PLATFORM_APP_ARN,
      Token: deviceToken,
      CustomUserData: userId,
    }),
  );

  const endpointArn = endpointResponse.EndpointArn!;

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

async function unregisterDevice(
  userId: string,
  event: Event,
): Promise<Result> {
  const body = parseBody(event);
  const deviceToken = body.deviceToken as string | undefined;

  if (!deviceToken) {
    return json(400, { message: 'deviceToken is required' });
  }

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

  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { userId, deviceToken },
    }),
  );

  return json(200, { message: 'Device unregistered' });
}

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
