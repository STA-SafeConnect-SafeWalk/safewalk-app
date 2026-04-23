import * as cdk from 'aws-cdk-lib/core';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface LiveLocationStackProps extends cdk.StackProps {
  appUsersTable: dynamodb.Table;
}

export class LiveLocationStack extends cdk.Stack {
  public readonly liveLocationHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props: LiveLocationStackProps) {
    super(scope, id, props);

    const { appUsersTable } = props;

    const liveLocationsTable = new dynamodb.Table(this, 'live-locations-table', {
      tableName: 'LiveLocations',
      partitionKey: {
        name: 'safeWalkId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecovery: true,
    });

    this.liveLocationHandler = new NodejsFunction(this, 'live-location-handler', {
      functionName: 'live-location-handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lambda/live-location-handler/index.ts'),
      projectRoot: path.join(__dirname, '../..'),
      environment: {
        LIVE_LOCATIONS_TABLE_NAME: liveLocationsTable.tableName,
        APP_USERS_TABLE_NAME: appUsersTable.tableName,
        PLATFORM_DOMAIN: process.env.PLATFORM_DOMAIN || '',
        API_KEY: process.env.API_KEY || '',
        LOCATION_TTL_SECONDS: '120',
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    liveLocationsTable.grantReadWriteData(this.liveLocationHandler);
    appUsersTable.grantReadData(this.liveLocationHandler);
  }
}
