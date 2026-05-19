import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface AppConfigStackProps extends cdk.StackProps {
  mapboxAccessToken: string;
}

export class AppConfigStack extends cdk.Stack {
  public readonly appConfigHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props: AppConfigStackProps) {
    super(scope, id, props);

    this.appConfigHandler = new NodejsFunction(this, 'app-config-handler', {
      functionName: 'app-config-handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lambda/app-config-handler/index.ts'),
      projectRoot: path.join(__dirname, '../..'),
      environment: {
        MAPBOX_ACCESS_TOKEN: props.mapboxAccessToken,
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
  }
}

