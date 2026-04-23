import * as cdk from 'aws-cdk-lib/core';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export class HeatmapStack extends cdk.Stack {
  public readonly heatmapHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const heatmapReportsTable = new dynamodb.Table(this, 'heatmap-reports-table', {
      tableName: 'HeatmapReports',
      partitionKey: {
        name: 'geohash5',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    heatmapReportsTable.addGlobalSecondaryIndex({
      indexName: 'UserReportsIndex',
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

    heatmapReportsTable.addGlobalSecondaryIndex({
      indexName: 'ReportIdIndex',
      partitionKey: {
        name: 'reportId',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const heatmapPublicDataTable = new dynamodb.Table(this, 'heatmap-public-data-table', {
      tableName: 'HeatmapPublicDataCache',
      partitionKey: {
        name: 'geohash5',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    this.heatmapHandler = new NodejsFunction(this, 'heatmap-handler', {
      functionName: 'heatmap-handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lambda/heatmap-handler/index.ts'),
      projectRoot: path.join(__dirname, '../..'),
      environment: {
        HEATMAP_REPORTS_TABLE_NAME: heatmapReportsTable.tableName,
        HEATMAP_PUBLIC_DATA_TABLE_NAME: heatmapPublicDataTable.tableName,
      },
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    heatmapReportsTable.grantReadWriteData(this.heatmapHandler);
    heatmapPublicDataTable.grantReadWriteData(this.heatmapHandler);
  }
}
