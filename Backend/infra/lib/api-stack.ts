import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayAuthorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigatewayIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  devPrefix?: string;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  authHandler: lambda.IFunction;
  userProfileHandler?: lambda.IFunction;
  platformRegistrationHandler?: lambda.IFunction;
  notificationHandler?: lambda.IFunction;
  sosHandler?: lambda.IFunction;
  heatmapHandler?: lambda.IFunction;
  liveLocationHandler?: lambda.IFunction;
  tipsHandler: lambda.IFunction;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      devPrefix,
      userPool,
      userPoolClient,
      authHandler,
      userProfileHandler,
      platformRegistrationHandler,
      notificationHandler,
      sosHandler,
      heatmapHandler,
      liveLocationHandler,
      tipsHandler,
    } = props;

    const prefix = devPrefix ? `${devPrefix}-` : '';

    const httpApi = new apigateway.HttpApi(this, 'safewalk-app-api', {
      apiName: `${prefix}safewalk-app-api`,
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

    /* Auth routes - always present */

    const authLambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration(
      'auth-integration',
      authHandler,
    );
    
    const tipsLambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration(
      'tips-integration',
      tipsHandler,
    );

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

    /* User profile routes */

    if (userProfileHandler && platformRegistrationHandler) {
      const userLambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration(
        'app-user-profile-integration',
        userProfileHandler,
      );

      const platformLambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration(
        'platform-registration-integration',
        platformRegistrationHandler,
      );

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
    }

    /* Push notification routes */

    if (notificationHandler) {
      const notificationLambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration(
        'notification-integration',
        notificationHandler,
      );

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
    }

    /* SOS routes */

    if (sosHandler) {
      const sosLambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration(
        'sos-integration',
        sosHandler,
      );

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
        path: '/sos/{sosId}/propagate',
        methods: [apigateway.HttpMethod.POST],
        integration: sosLambdaIntegration,
        authorizer: jwtAuthorizer,
      });

      httpApi.addRoutes({
        path: '/sos/received',
        methods: [apigateway.HttpMethod.GET],
        integration: sosLambdaIntegration,
        authorizer: jwtAuthorizer,
      });

      httpApi.addRoutes({
        path: '/webhook/sos',
        methods: [apigateway.HttpMethod.POST],
        integration: sosLambdaIntegration,
      });
    }

    /* Heatmap routes */

    if (heatmapHandler) {
      const heatmapLambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration(
        'heatmap-integration',
        heatmapHandler,
      );

      httpApi.addRoutes({
        path: '/heatmap',
        methods: [apigateway.HttpMethod.GET],
        integration: heatmapLambdaIntegration,
        authorizer: jwtAuthorizer,
      });

      httpApi.addRoutes({
        path: '/heatmap/metadata',
        methods: [apigateway.HttpMethod.GET],
        integration: heatmapLambdaIntegration,
        authorizer: jwtAuthorizer,
      });

      httpApi.addRoutes({
        path: '/heatmap/reports',
        methods: [apigateway.HttpMethod.POST],
        integration: heatmapLambdaIntegration,
        authorizer: jwtAuthorizer,
      });

      httpApi.addRoutes({
        path: '/heatmap/reports',
        methods: [apigateway.HttpMethod.GET],
        integration: heatmapLambdaIntegration,
        authorizer: jwtAuthorizer,
      });

      httpApi.addRoutes({
        path: '/heatmap/reports/{reportId}',
        methods: [apigateway.HttpMethod.DELETE],
        integration: heatmapLambdaIntegration,
        authorizer: jwtAuthorizer,
      });
    }

    /* Live location routes */

    if (liveLocationHandler) {
      const liveLocationLambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration(
        'live-location-integration',
        liveLocationHandler,
      );

      httpApi.addRoutes({
        path: '/location',
        methods: [apigateway.HttpMethod.PUT],
        integration: liveLocationLambdaIntegration,
        authorizer: jwtAuthorizer,
      });

      httpApi.addRoutes({
        path: '/location',
        methods: [apigateway.HttpMethod.DELETE],
        integration: liveLocationLambdaIntegration,
        authorizer: jwtAuthorizer,
      });

      httpApi.addRoutes({
        path: '/location/contacts',
        methods: [apigateway.HttpMethod.GET],
        integration: liveLocationLambdaIntegration,
        authorizer: jwtAuthorizer,
      });

      httpApi.addRoutes({
        path: '/location/contacts/{safeWalkId}',
        methods: [apigateway.HttpMethod.GET],
        integration: liveLocationLambdaIntegration,
        authorizer: jwtAuthorizer,
      });
    }

    httpApi.addRoutes({
      path: '/tips',
      methods: [apigateway.HttpMethod.GET],
      integration: tipsLambdaIntegration,
      authorizer: jwtAuthorizer,
    });

    new cdk.CfnOutput(this, 'api-url', {
      value: httpApi.apiEndpoint,
      description: 'HTTP API Gateway endpoint URL',
    });
  }
}
