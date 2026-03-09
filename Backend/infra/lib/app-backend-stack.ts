import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayAuthorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigatewayIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import * as path from 'path';
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
        PLATFORM_DOMAIN: process.env.PLATFORM_DOMAIN || 'https://example.com/api/register',
        VENDOR_ID: process.env.VENDOR_ID || 'default-vendor-id',
        API_KEY: process.env.API_KEY || 'default-api-key',
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
