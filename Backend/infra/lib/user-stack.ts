import * as cdk from 'aws-cdk-lib/core';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export class UserStack extends cdk.Stack {
  public readonly appUsersTable: dynamodb.Table;
  public readonly userProfileHandler: NodejsFunction;
  public readonly platformRegistrationHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.appUsersTable = new dynamodb.Table(this, 'app-users-table', {
      tableName: 'AppUsers',
      partitionKey: {
        name: 'safeWalkAppId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });

    this.appUsersTable.addGlobalSecondaryIndex({
      indexName: 'SharingCodeIndex',
      partitionKey: {
        name: 'sharingCode',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.userProfileHandler = new NodejsFunction(this, 'app-user-profile-handler', {
      functionName: 'app-user-profile-handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lambda/user-profile-handler/index.ts'),
      projectRoot: path.join(__dirname, '../..'),
      environment: {
        TABLE_NAME: this.appUsersTable.tableName,
        PLATFORM_DOMAIN: process.env.PLATFORM_DOMAIN || '',
        VENDOR_ID: process.env.VENDOR_ID || '',
        API_KEY: process.env.API_KEY || '',
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    this.appUsersTable.grantReadWriteData(this.userProfileHandler);

    this.platformRegistrationHandler = new NodejsFunction(this, 'platform-registration-handler', {
      functionName: 'platform-registration-handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lambda/platform-registration-handler/index.ts'),
      projectRoot: path.join(__dirname, '../..'),
      environment: {
        PLATFORM_DOMAIN: process.env.PLATFORM_DOMAIN!,
        VENDOR_ID: process.env.VENDOR_ID!,
        API_KEY: process.env.API_KEY!,
        TABLE_NAME: this.appUsersTable.tableName,
      },
      timeout: cdk.Duration.seconds(20),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    this.appUsersTable.grantReadWriteData(this.platformRegistrationHandler);

    new cdk.CfnOutput(this, 'table-name', {
      value: this.appUsersTable.tableName,
      description: 'DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'lambda-function-name', {
      value: this.userProfileHandler.functionName,
      description: 'App user profile handler Lambda function name',
    });
  }
}
