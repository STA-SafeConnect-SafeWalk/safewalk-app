import { mockClient } from 'aws-sdk-client-mock';
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
import { SNSEvent } from 'aws-lambda';

// Set env vars before importing the module so the top-level constants are
// initialized with proper values.
process.env.DEVICE_TOKENS_TABLE = 'DeviceTokens';
process.env.FCM_PLATFORM_APP_ARN = 'arn:aws:sns:eu-central-1:123456789:app/GCM/test-app';

import { handler as _handler } from '../notification-handler/index';
const handler = _handler as (event: any) => Promise<any>;

const ddbMock = mockClient(DynamoDBDocumentClient);
const snsMock = mockClient(SNSClient);

const makeApiEvent = (path: string, method: string, userId = 'user-123', body?: unknown) =>
  ({
    rawPath: path,
    requestContext: {
      http: { method },
      authorizer: { jwt: { claims: { sub: userId } } },
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: {},
    isBase64Encoded: false,
  }) as any;

const makeSNSEvent = (message: unknown): SNSEvent => ({
  Records: [
    {
      EventSource: 'aws:sns',
      EventVersion: '1.0',
      EventSubscriptionArn: 'arn:aws:sns:eu-central-1:123456789:test',
      Sns: {
        Type: 'Notification',
        MessageId: 'msg-1',
        TopicArn: 'arn:aws:sns:eu-central-1:123456789:test',
        Subject: '',
        Message: JSON.stringify(message),
        Timestamp: new Date().toISOString(),
        SignatureVersion: '1',
        Signature: '',
        SigningCertUrl: '',
        UnsubscribeUrl: '',
        MessageAttributes: {},
      },
    },
  ],
});

describe('notification-handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    snsMock.reset();
  });

  // ---------------------------------------------------------------------------
  // POST /device/register
  // ---------------------------------------------------------------------------

  describe('POST /device/register', () => {
    it('returns 200 and endpointArn on success', async () => {
      snsMock
        .on(CreatePlatformEndpointCommand)
        .resolves({ EndpointArn: 'arn:aws:sns:eu-central-1:123456789:endpoint/GCM/test/abc' });
      snsMock.on(SetEndpointAttributesCommand).resolves({});
      ddbMock.on(PutCommand).resolves({});

      const res = await handler(makeApiEvent('/device/register', 'POST', 'user-123', { deviceToken: 'tok-abc', platform: 'android' }));
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.endpointArn).toContain('arn:aws:sns');
    });

    it('returns 400 when deviceToken is missing', async () => {
      const res = await handler(makeApiEvent('/device/register', 'POST', 'user-123', { platform: 'android' }));
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when platform is missing', async () => {
      const res = await handler(makeApiEvent('/device/register', 'POST', 'user-123', { deviceToken: 'tok-abc' }));
      expect(res.statusCode).toBe(400);
    });

    it('persists the token and endpointArn in DynamoDB', async () => {
      snsMock.on(CreatePlatformEndpointCommand).resolves({ EndpointArn: 'arn:endpoint-1' });
      snsMock.on(SetEndpointAttributesCommand).resolves({});
      ddbMock.on(PutCommand).resolves({});

      await handler(makeApiEvent('/device/register', 'POST', 'user-123', { deviceToken: 'tok-abc', platform: 'ios' }));

      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input.Item).toMatchObject({
        userId: 'user-123',
        deviceToken: 'tok-abc',
        endpointArn: 'arn:endpoint-1',
        platform: 'ios',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // POST /device/unregister
  // ---------------------------------------------------------------------------

  describe('POST /device/unregister', () => {
    it('returns 400 when deviceToken is missing', async () => {
      const res = await handler(makeApiEvent('/device/unregister', 'POST', 'user-123', {}));
      expect(res.statusCode).toBe(400);
    });

    it('deletes the SNS endpoint and DynamoDB record', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { userId: 'user-123', deviceToken: 'tok-abc', endpointArn: 'arn:endpoint-1' },
      });
      snsMock.on(DeleteEndpointCommand).resolves({});
      ddbMock.on(DeleteCommand).resolves({});

      const res = await handler(makeApiEvent('/device/unregister', 'POST', 'user-123', { deviceToken: 'tok-abc' }));
      expect(res.statusCode).toBe(200);
      expect(snsMock.commandCalls(DeleteEndpointCommand)).toHaveLength(1);
      expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(1);
    });

    it('still deletes the DynamoDB record when no endpointArn exists', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { userId: 'user-123', deviceToken: 'tok-no-arn' } });
      ddbMock.on(DeleteCommand).resolves({});

      const res = await handler(makeApiEvent('/device/unregister', 'POST', 'user-123', { deviceToken: 'tok-no-arn' }));
      expect(res.statusCode).toBe(200);
      expect(snsMock.commandCalls(DeleteEndpointCommand)).toHaveLength(0);
      expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(1);
    });

    it('still succeeds even when SNS DeleteEndpoint throws (non-fatal)', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { userId: 'user-123', deviceToken: 'tok-abc', endpointArn: 'arn:stale-endpoint' },
      });
      snsMock.on(DeleteEndpointCommand).rejects(new Error('Endpoint not found'));
      ddbMock.on(DeleteCommand).resolves({});

      const res = await handler(makeApiEvent('/device/unregister', 'POST', 'user-123', { deviceToken: 'tok-abc' }));
      expect(res.statusCode).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /notifications/send
  // ---------------------------------------------------------------------------

  describe('POST /notifications/send', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await handler(
        makeApiEvent('/notifications/send', 'POST', 'user-sender', { targetUserId: 'user-target' }),
      );
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when target user has no registered devices', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });
      const res = await handler(
        makeApiEvent('/notifications/send', 'POST', 'user-sender', {
          targetUserId: 'user-target',
          title: 'Hello',
          body: 'World',
        }),
      );
      expect(res.statusCode).toBe(404);
    });

    it('returns 200 with sent/failed counts', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          { userId: 'user-target', deviceToken: 'tok-1', endpointArn: 'arn:ep-1' },
          { userId: 'user-target', deviceToken: 'tok-2', endpointArn: 'arn:ep-2' },
        ],
      });
      snsMock.on(PublishCommand).resolves({ MessageId: 'msg-1' });

      const res = await handler(
        makeApiEvent('/notifications/send', 'POST', 'user-sender', {
          targetUserId: 'user-target',
          title: 'Alert',
          body: 'Check this out',
        }),
      );
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sent).toBe(2);
      expect(body.failed).toBe(0);
    });

    it('counts SNS publish failures correctly', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          { userId: 'user-target', endpointArn: 'arn:ep-good' },
          { userId: 'user-target', endpointArn: 'arn:ep-bad' },
        ],
      });
      snsMock
        .on(PublishCommand)
        .resolvesOnce({ MessageId: 'ok' })
        .rejectsOnce(new Error('EndpointDisabled'));

      const res = await handler(
        makeApiEvent('/notifications/send', 'POST', 'user-sender', {
          targetUserId: 'user-target',
          title: 'Alert',
          body: 'Msg',
        }),
      );
      const body = JSON.parse(res.body);
      expect(body.sent).toBe(1);
      expect(body.failed).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Unknown route
  // ---------------------------------------------------------------------------

  it('returns 404 for unknown routes', async () => {
    const res = await handler(makeApiEvent('/unknown/path', 'GET'));
    expect(res.statusCode).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // SNS event handler
  // ---------------------------------------------------------------------------

  describe('SNS event handler', () => {
    it('delivers push notification to the target user', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'user-target', endpointArn: 'arn:ep-1' }],
      });
      snsMock.on(PublishCommand).resolves({ MessageId: 'sns-msg-1' });

      await handler(makeSNSEvent({ targetUserId: 'user-target', title: 'SOS Alert', body: 'Your contact triggered SOS' }));

      expect(snsMock.commandCalls(PublishCommand)).toHaveLength(1);
    });

    it('handles targetUserIds array (one delivery per user)', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'u', endpointArn: 'arn:ep' }],
      });
      snsMock.on(PublishCommand).resolves({});

      await handler(makeSNSEvent({ targetUserIds: ['user-a', 'user-b'], title: 'Broadcast', body: 'Hello all' }));

      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(2);
    });

    it('skips delivery when user has no registered devices', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      await handler(makeSNSEvent({ targetUserId: 'ghost-user', title: 'Test', body: 'msg' }));

      expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
    });

    it('skips records with invalid JSON without throwing', async () => {
      const event: SNSEvent = {
        Records: [
          {
            EventSource: 'aws:sns',
            EventVersion: '1.0',
            EventSubscriptionArn: 'arn',
            Sns: {
              Type: 'Notification',
              MessageId: 'm',
              TopicArn: 'arn',
              Subject: '',
              Message: 'not-valid-json',
              Timestamp: '',
              SignatureVersion: '1',
              Signature: '',
              SigningCertUrl: '',
              UnsubscribeUrl: '',
              MessageAttributes: {},
            },
          },
        ],
      };
      await expect(handler(event)).resolves.toBeUndefined();
    });

    it('skips records missing title or body', async () => {
      await handler(makeSNSEvent({ targetUserId: 'user-a', title: 'Only title' }));
      expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
    });
  });
});
