#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AuthStack } from '../lib/auth-stack';
import { UserStack } from '../lib/user-stack';
import { NotificationStack } from '../lib/notification-stack';
import { SosStack } from '../lib/sos-stack';
import { HeatmapStack } from '../lib/heatmap-stack';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

const devPrefix = app.node.tryGetContext('devPrefix') as string | undefined;

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

if (devPrefix) {
  // Lightweight dev environment – only Auth + Heatmap stacks.
  // No production env vars required.
  // Deploy with: cdk deploy --all -c devPrefix=<your-name>
  // Tear down with: cdk destroy --all -c devPrefix=<your-name>
  const authStack = new AuthStack(app, `${devPrefix}-safewalk-app-auth-stack`, { env, devPrefix });
  const heatmapStack = new HeatmapStack(app, `${devPrefix}-safewalk-app-heatmap-stack`, { env, devPrefix });
  new ApiStack(app, `${devPrefix}-safewalk-app-api-stack`, {
    env,
    devPrefix,
    userPool: authStack.userPool,
    userPoolClient: authStack.userPoolClient,
    authHandler: authStack.authHandler,
    heatmapHandler: heatmapStack.heatmapHandler,
  });
} else {
  // Full production deployment – all env vars are required.
  const required = ['PLATFORM_DOMAIN', 'VENDOR_ID', 'API_KEY'];
  for (const name of required) {
    if (!process.env[name]) {
      throw new Error(`Missing required env var: ${name}`);
    }
  }

  const authStack = new AuthStack(app, 'safewalk-app-auth-stack', { env });
  const userStack = new UserStack(app, 'safewalk-app-user-stack', { env });
  const notificationStack = new NotificationStack(app, 'safewalk-app-notification-stack', { env });
  const sosStack = new SosStack(app, 'safewalk-app-sos-stack', {
    env,
    appUsersTable: userStack.appUsersTable,
    pushNotificationTopic: notificationStack.pushNotificationTopic,
  });
  const heatmapStack = new HeatmapStack(app, 'safewalk-app-heatmap-stack', { env });
  new ApiStack(app, 'safewalk-app-api-stack', {
    env,
    userPool: authStack.userPool,
    userPoolClient: authStack.userPoolClient,
    authHandler: authStack.authHandler,
    userProfileHandler: userStack.userProfileHandler,
    platformRegistrationHandler: userStack.platformRegistrationHandler,
    notificationHandler: notificationStack.notificationHandler,
    sosHandler: sosStack.sosHandler,
    heatmapHandler: heatmapStack.heatmapHandler,
  });
}