import * as cdk from 'aws-cdk-lib/core';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export class MapDataStack extends cdk.Stack {
  public readonly mapDataHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /**
     * User-generated reports keyed by a coarse geo bucket so that area
     * queries can be served by a single Query per bucket. Reports
     * auto-expire via the `expiresAt` TTL attribute.
     */
    const mapReportsTable = new dynamodb.Table(this, 'map-reports-table', {
      tableName: 'MapReports',
      partitionKey: {
        name: 'bucket',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'reportId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecovery: true,
    });

    /**
     * Cache for Overpass / OSM responses keyed by a snapped grid cell.
     * Drastically reduces the number of outbound calls to public APIs and
     * keeps the user-facing endpoint within the latency budget.
     */
    const mapDataCacheTable = new dynamodb.Table(this, 'map-data-cache-table', {
      tableName: 'MapDataCache',
      partitionKey: {
        name: 'cacheKey',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'expiresAt',
    });

    this.mapDataHandler = new NodejsFunction(this, 'map-data-handler', {
      functionName: 'map-data-handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lambda/map-data-handler/index.ts'),
      projectRoot: path.join(__dirname, '../..'),
      environment: {
        MAP_REPORTS_TABLE_NAME: mapReportsTable.tableName,
        MAP_CACHE_TABLE_NAME: mapDataCacheTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    mapReportsTable.grantReadWriteData(this.mapDataHandler);
    mapDataCacheTable.grantReadWriteData(this.mapDataHandler);
  }
}
