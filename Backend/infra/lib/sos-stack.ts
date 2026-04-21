import * as cdk from 'aws-cdk-lib/core';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface SosStackProps extends cdk.StackProps {
  devPrefix?: string;
  appUsersTable: dynamodb.Table;
  pushNotificationTopic: sns.Topic;
}

export class SosStack extends cdk.Stack {
  public readonly sosHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props: SosStackProps) {
    super(scope, id, props);

    const { appUsersTable, pushNotificationTopic } = props;
    const prefix = props.devPrefix ? `${props.devPrefix}-` : '';

    const sosEventsTable = new dynamodb.Table(this, 'app-sos-events-table', {
      tableName: `${prefix}AppSOSEvents`,
      partitionKey: {
        name: 'sosId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    sosEventsTable.addGlobalSecondaryIndex({
      indexName: 'UserIndex',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const sosPropagationQueue = new sqs.Queue(this, 'sos-propagation-queue', {
      queueName: `${prefix}safewalk-sos-propagation-queue`,
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.hours(1),
      receiveMessageWaitTime: cdk.Duration.seconds(20),
    });

    this.sosHandler = new NodejsFunction(this, 'app-sos-handler', {
      functionName: `${prefix}app-sos-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lambda/sos-handler/index.ts'),
      projectRoot: path.join(__dirname, '../..'),
      environment: {
        SOS_TABLE_NAME: sosEventsTable.tableName,
        APP_USERS_TABLE_NAME: appUsersTable.tableName,
        QUEUE_URL: sosPropagationQueue.queueUrl,
        PLATFORM_DOMAIN: process.env.PLATFORM_DOMAIN || '',
        API_KEY: process.env.API_KEY || '',
        PROPAGATION_DELAY_SECONDS: '10',
        PUSH_NOTIFICATION_TOPIC_ARN: pushNotificationTopic.topicArn,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    sosEventsTable.grantReadWriteData(this.sosHandler);
    appUsersTable.grantReadData(this.sosHandler);
    sosPropagationQueue.grantSendMessages(this.sosHandler);
    pushNotificationTopic.grantPublish(this.sosHandler);

    this.sosHandler.addEventSource(
      new SqsEventSource(sosPropagationQueue, {
        batchSize: 1,
      }),
    );
  }
}
