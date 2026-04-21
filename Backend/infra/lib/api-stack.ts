import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayAuthorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigatewayIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  authHandler: lambda.IFunction;
  userProfileHandler: lambda.IFunction;
  platformRegistrationHandler: lambda.IFunction;
  notificationHandler: lambda.IFunction;
  sosHandler: lambda.IFunction;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      userPool,
      userPoolClient,
      authHandler,
      userProfileHandler,
      platformRegistrationHandler,
      notificationHandler,
      sosHandler,
    } = props;

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
      userProfileHandler,
    );

    const platformLambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration(
      'platform-registration-integration',
      platformRegistrationHandler,
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

    httpApi.addRoutes({
      path: '/webhook/sos',
      methods: [apigateway.HttpMethod.POST],
      integration: sosLambdaIntegration,
    });

    new cdk.CfnOutput(this, 'api-url', {
      value: httpApi.apiEndpoint,
      description: 'HTTP API Gateway endpoint URL',
    });
  }
}
