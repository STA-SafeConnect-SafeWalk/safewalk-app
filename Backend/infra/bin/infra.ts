#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AuthStack } from '../lib/auth-stack';
import { UserStack } from '../lib/user-stack';
import { NotificationStack } from '../lib/notification-stack';
import { SosStack } from '../lib/sos-stack';
import { HeatmapStack } from '../lib/heatmap-stack';
import { TipsStack } from '../lib/tips-stack';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

const devPrefix = app.node.tryGetContext('devPrefix') as string | undefined;

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

if (!devPrefix) {
  const required = ['PLATFORM_DOMAIN', 'VENDOR_ID', 'API_KEY', 'WEBHOOK_SECRET'];
  for (const name of required) {
    if (!process.env[name]) {
      throw new Error(`Missing required env var: ${name}`);
    }
  }
}

const stackName = (name: string) => devPrefix ? `${devPrefix}-${name}` : name;

const authStack = new AuthStack(app, stackName('safewalk-app-auth-stack'), { env, devPrefix });
const userStack = new UserStack(app, stackName('safewalk-app-user-stack'), { env, devPrefix });
const notificationStack = new NotificationStack(app, 'safewalk-app-notification-stack', { env });
const sosStack = new SosStack(app, stackName('safewalk-app-sos-stack'), {
  env,
  devPrefix,
  appUsersTable: userStack.appUsersTable,
  pushNotificationTopic: notificationStack.pushNotificationTopic,
  deviceTokensTable: notificationStack.deviceTokensTable,
});
const heatmapStack = new HeatmapStack(app, stackName('safewalk-app-heatmap-stack'), { env, devPrefix });
const tipsStack = new TipsStack(app, 'safewalk-app-tips-stack', {
  env,
});
new ApiStack(app, stackName('safewalk-app-api-stack'), {
  env,
  devPrefix,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
  authHandler: authStack.authHandler,
  userProfileHandler: userStack.userProfileHandler,
  platformRegistrationHandler: userStack.platformRegistrationHandler,
  notificationHandler: notificationStack.notificationHandler,
  sosHandler: sosStack.sosHandler,
  heatmapHandler: heatmapStack.heatmapHandler,
  tipsHandler: tipsStack.tipsHandler,
});