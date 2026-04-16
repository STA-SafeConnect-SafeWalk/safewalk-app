import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayAuthorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigatewayIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import * as path from 'path';
import * as fs from 'fs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

export class AppBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const required = ['PLATFORM_DOMAIN', 'VENDOR_ID', 'API_KEY'];

    for (const name of required) {
      if (!process.env[name]) {
        throw new Error(`Missing required env var: ${name}`);
      }
    }

    const appUsersTable = new dynamodb.Table(this, 'app-users-table', {
      tableName: 'AppUsers',
      partitionKey: {
        name: 'safeWalkAppId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });

    appUsersTable.addGlobalSecondaryIndex({
      indexName: 'SharingCodeIndex',
      partitionKey: {
        name: 'sharingCode',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const deviceTokensTable = new dynamodb.Table(this, 'device-tokens-table', {
      tableName: 'DeviceTokens',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'deviceToken',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const fcmKeyPath = path.join(__dirname, '../fcm-service-account.json');
    const hasFcmKey = fs.existsSync(fcmKeyPath);
    let fcmPlatformAppArn = '';

    if (hasFcmKey) {
      const fcmServiceAccountJson = fs.readFileSync(fcmKeyPath, 'utf-8');

      const snsPlatformAppHandler = new NodejsFunction(this, 'sns-platform-app-resource', {
        functionName: 'sns-platform-app-resource',
        runtime: lambda.Runtime.NODEJS_24_X,
        handler: 'index.handler',
        entry: path.join(__dirname, '../../lambda/sns-platform-app-resource/index.ts'),
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
          Name: 'safewalk-fcm',
          Platform: 'GCM',
          PlatformCredential: fcmServiceAccountJson,
        },
      });

      fcmPlatformAppArn = snsPlatformApp.getAttString('PlatformApplicationArn');
    }

    const userPool = new cognito.UserPool(this, 'safewalk-user-pool', {
      userPoolName: 'safewalk-user-pool',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userPoolClient = userPool.addClient('safewalk-app-client', {
      userPoolClientName: 'safewalk-app-client',
      authFlows: {
        userPassword: true, 
        userSrp: true, 
      },
      generateSecret: false, 
    });

    /* Lambda Function for User Profile Management */

    const userProfileHandler = new NodejsFunction(this, 'app-user-profile-handler', {
      functionName: 'app-user-profile-handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lambda/user-profile-handler/index.ts'),
      environment: {
        TABLE_NAME: appUsersTable.tableName,
        PLATFORM_DOMAIN: process.env.PLATFORM_DOMAIN || '',
        VENDOR_ID: process.env.VENDOR_ID || '',
        API_KEY: process.env.API_KEY || '',
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    appUsersTable.grantReadWriteData(userProfileHandler);



    /******** PLATFORM ********/

    const platformRegistrationHandler = new NodejsFunction(this, 'platform-registration-handler', {
      functionName: 'platform-registration-handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lambda/platform-registration-handler/index.ts'),
      environment: {
        PLATFORM_DOMAIN: process.env.PLATFORM_DOMAIN!,
        VENDOR_ID: process.env.VENDOR_ID!,
        API_KEY: process.env.API_KEY!,
        TABLE_NAME: appUsersTable.tableName,
      },
      timeout: cdk.Duration.seconds(20),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    appUsersTable.grantReadWriteData(platformRegistrationHandler);

    const authHandler = new NodejsFunction(this, 'auth-handler', {
      functionName: 'auth-handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lambda/auth-handler/index.ts'),
      environment: {
        APP_CLIENT_ID: userPoolClient.userPoolClientId,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    authHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:SignUp',
          'cognito-idp:ConfirmSignUp',
          'cognito-idp:InitiateAuth',
          'cognito-idp:GlobalSignOut',
          'cognito-idp:ForgotPassword',
          'cognito-idp:ConfirmForgotPassword',
        ],
        resources: [userPool.userPoolArn],
      }),
    );

    const notificationHandler = new NodejsFunction(this, 'notification-handler', {
      functionName: 'notification-handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lambda/notification-handler/index.ts'),
      environment: {
        DEVICE_TOKENS_TABLE: deviceTokensTable.tableName,
        FCM_PLATFORM_APP_ARN: fcmPlatformAppArn,
      },
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    deviceTokensTable.grantReadWriteData(notificationHandler);

    notificationHandler.addToRolePolicy(
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

    /******** SOS ********/

    const sosEventsTable = new dynamodb.Table(this, 'app-sos-events-table', {
      tableName: 'AppSOSEvents',
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
      queueName: 'safewalk-sos-propagation-queue',
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.hours(1),
    });

    const sosHandler = new NodejsFunction(this, 'app-sos-handler', {
      functionName: 'app-sos-handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lambda/sos-handler/index.ts'),
      environment: {
        SOS_TABLE_NAME: sosEventsTable.tableName,
        APP_USERS_TABLE_NAME: appUsersTable.tableName,
        QUEUE_URL: sosPropagationQueue.queueUrl,
        PLATFORM_DOMAIN: process.env.PLATFORM_DOMAIN || '',
        API_KEY: process.env.API_KEY || '',
        PROPAGATION_DELAY_SECONDS: '10',
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    sosEventsTable.grantReadWriteData(sosHandler);
    appUsersTable.grantReadData(sosHandler);
    sosPropagationQueue.grantSendMessages(sosHandler);

    sosHandler.addEventSource(
      new SqsEventSource(sosPropagationQueue, {
        batchSize: 1,
      }),
    );

    /******** API GATEWAY ********/

    const httpApi = new apigateway.HttpApi(this, 'safewalk-app-api', {
      apiName: 'safewalk-app-api',
      description: 'SafeWalk App API',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          apigateway.CorsHttpMethod.GET,
          apigateway.CorsHttpMethod.POST,
          apigateway.CorsHttpMethod.PATCH,
          apigateway.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const jwtAuthorizer = new apigatewayAuthorizers.HttpJwtAuthorizer(
      'cognito-jwt-authorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      {
        jwtAudience: [userPoolClient.userPoolClientId],
      },
    );

    /* Lambda Integrations */

    const authLambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration(
      'auth-integration',
      authHandler,
    );

    const userLambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration(
      'app-user-profile-integration',
      userProfileHandler
    );

    const platformLambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration(
      'platform-registration-integration',
      platformRegistrationHandler
    );

    const notificationLambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration(
      'notification-integration',
      notificationHandler,
    );

    const sosLambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration(
      'sos-integration',
      sosHandler,
    );

    /* API Routes – public (no authorizer) */

    httpApi.addRoutes({
      path: '/auth/sign-up',
      methods: [apigateway.HttpMethod.POST],
      integration: authLambdaIntegration,
    });

    httpApi.addRoutes({
      path: '/auth/confirm',
      methods: [apigateway.HttpMethod.POST],
      integration: authLambdaIntegration,
    });

    httpApi.addRoutes({
      path: '/auth/sign-in',
      methods: [apigateway.HttpMethod.POST],
      integration: authLambdaIntegration,
    });

    httpApi.addRoutes({
      path: '/auth/refresh',
      methods: [apigateway.HttpMethod.POST],
      integration: authLambdaIntegration,
    });

    httpApi.addRoutes({
      path: '/auth/sign-out',
      methods: [apigateway.HttpMethod.POST],
      integration: authLambdaIntegration,
    });

    httpApi.addRoutes({
      path: '/auth/forgot-password',
      methods: [apigateway.HttpMethod.POST],
      integration: authLambdaIntegration,
    });

    httpApi.addRoutes({
      path: '/auth/confirm-forgot-password',
      methods: [apigateway.HttpMethod.POST],
      integration: authLambdaIntegration,
    });

    /* API Routes – protected (JWT authorizer required) */

    httpApi.addRoutes({
      path: '/me',
      methods: [apigateway.HttpMethod.GET],
      integration: userLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/register',
      methods: [apigateway.HttpMethod.POST],
      integration: userLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/register/platform',
      methods: [apigateway.HttpMethod.POST],
      integration: platformLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/sharing-code',
      methods: [apigateway.HttpMethod.GET],
      integration: userLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/sharing-code',
      methods: [apigateway.HttpMethod.POST],
      integration: userLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/sharing-code/connect',
      methods: [apigateway.HttpMethod.POST],
      integration: userLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/contacts/connect-back',
      methods: [apigateway.HttpMethod.POST],
      integration: userLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    /* Trusted Contacts Routes */

    httpApi.addRoutes({
      path: '/contacts',
      methods: [apigateway.HttpMethod.GET],
      integration: userLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/contacts/{contactId}',
      methods: [apigateway.HttpMethod.PATCH],
      integration: userLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/contacts/{contactId}',
      methods: [apigateway.HttpMethod.DELETE],
      integration: userLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    /* Push Notification Routes */

    httpApi.addRoutes({
      path: '/device/register',
      methods: [apigateway.HttpMethod.POST],
      integration: notificationLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/device/unregister',
      methods: [apigateway.HttpMethod.POST],
      integration: notificationLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/notifications/send',
      methods: [apigateway.HttpMethod.POST],
      integration: notificationLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    /* SOS Routes */

    httpApi.addRoutes({
      path: '/sos',
      methods: [apigateway.HttpMethod.POST],
      integration: sosLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/sos/{sosId}',
      methods: [apigateway.HttpMethod.PATCH],
      integration: sosLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/sos/{sosId}',
      methods: [apigateway.HttpMethod.DELETE],
      integration: sosLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    new cdk.CfnOutput(this, 'api-url', {
      value: httpApi.apiEndpoint,
      description: 'HTTP API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'user-pool-id', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'user-pool-client-id', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool App Client ID',
    });

    new cdk.CfnOutput(this, 'table-name', {
      value: appUsersTable.tableName,
      description: 'DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'lambda-function-name', {
      value: userProfileHandler.functionName,
      description: 'App user profile handler Lambda function name',
    });
  }
}
