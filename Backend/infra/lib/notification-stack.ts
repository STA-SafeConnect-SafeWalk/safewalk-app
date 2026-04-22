import * as cdk from 'aws-cdk-lib/core';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';
import * as fs from 'fs';

export interface NotificationStackProps extends cdk.StackProps {
  devPrefix?: string;
}

export class NotificationStack extends cdk.Stack {
  public readonly pushNotificationTopic: sns.Topic;
  public readonly notificationHandler: NodejsFunction;
  public readonly deviceTokensTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: NotificationStackProps) {
    super(scope, id, props);

    const prefix = props?.devPrefix ? `${props.devPrefix}-` : '';

    const deviceTokensTable = new dynamodb.Table(this, 'device-tokens-table', {
      tableName: `${prefix}DeviceTokens`,
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'deviceToken',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    let fcmPlatformAppArn = '';

    const fcmKeyPath = path.join(__dirname, '../fcm-service-account.json');
    if (!fs.existsSync(fcmKeyPath)) {
      throw new Error(
        `FCM service account key not found at ${fcmKeyPath}.`,
      );
    }

    {
      const fcmServiceAccountJson = fs.readFileSync(fcmKeyPath, 'utf-8');

      const snsPlatformAppHandler = new NodejsFunction(this, 'sns-platform-app-resource', {
        functionName: `${prefix}sns-platform-app-resource`,
        runtime: lambda.Runtime.NODEJS_24_X,
        handler: 'index.handler',
        entry: path.join(__dirname, '../../lambda/sns-platform-app-resource/index.ts'),
        projectRoot: path.join(__dirname, '../..'),
        timeout: cdk.Duration.seconds(30),
        memorySize: 128,
        logRetention: logs.RetentionDays.ONE_WEEK,
      });

      snsPlatformAppHandler.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            'sns:CreatePlatformApplication',
            'sns:DeletePlatformApplication',
            'sns:SetPlatformApplicationAttributes',
            'sns:GetPlatformApplicationAttributes',
          ],
          resources: ['*'],
        }),
      );

      const snsPlatformAppProvider = new cr.Provider(this, 'sns-platform-app-provider', {
        onEventHandler: snsPlatformAppHandler,
        logRetention: logs.RetentionDays.ONE_WEEK,
      });

      const snsPlatformApp = new cdk.CustomResource(this, 'fcm-platform-app', {
        serviceToken: snsPlatformAppProvider.serviceToken,
        properties: {
          Name: `${prefix}safewalk-fcm`,
          Platform: 'GCM',
          PlatformCredential: fcmServiceAccountJson,
        },
      });

      fcmPlatformAppArn = snsPlatformApp.getAttString('PlatformApplicationArn');
    }

    this.pushNotificationTopic = new sns.Topic(this, 'push-notification-topic', {
      topicName: `${prefix}safewalk-push-notifications`,
      displayName: 'SafeWalk Internal Push Notifications',
    });

    this.notificationHandler = new NodejsFunction(this, 'notification-handler', {
      functionName: `${prefix}notification-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lambda/notification-handler/index.ts'),
      projectRoot: path.join(__dirname, '../..'),
      environment: {
        DEVICE_TOKENS_TABLE: deviceTokensTable.tableName,
        FCM_PLATFORM_APP_ARN: fcmPlatformAppArn,
      },
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    deviceTokensTable.grantReadWriteData(this.notificationHandler);

    this.notificationHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'sns:CreatePlatformEndpoint',
          'sns:DeleteEndpoint',
          'sns:Publish',
          'sns:GetEndpointAttributes',
          'sns:SetEndpointAttributes',
        ],
        resources: ['*'],
      }),
    );

    this.pushNotificationTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(this.notificationHandler),
    );
  }
}
