#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AuthStack } from '../lib/auth-stack';
import { UserStack } from '../lib/user-stack';
import { NotificationStack } from '../lib/notification-stack';
import { SosStack } from '../lib/sos-stack';
import { HeatmapStack } from '../lib/heatmap-stack';
import { TipsStack } from '../lib/tips-stack';
import { LiveLocationStack } from '../lib/live-location-stack';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const required = ['PLATFORM_DOMAIN', 'VENDOR_ID', 'API_KEY', 'WEBHOOK_SECRET'];
for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Missing required env var: ${name}`);
  }
}

const authStack = new AuthStack(app, 'safewalk-app-auth-stack', { env });
const userStack = new UserStack(app, 'safewalk-app-user-stack', {
  env,
  userPoolId: authStack.userPool.userPoolId,
  userPoolArn: authStack.userPool.userPoolArn,
});
const notificationStack = new NotificationStack(app, 'safewalk-app-notification-stack', { env });
const sosStack = new SosStack(app, 'safewalk-app-sos-stack', {
  env,
  appUsersTable: userStack.appUsersTable,
  pushNotificationTopic: notificationStack.pushNotificationTopic,
  deviceTokensTable: notificationStack.deviceTokensTable,
});
const heatmapStack = new HeatmapStack(app, 'safewalk-app-heatmap-stack', { env });
const liveLocationStack = new LiveLocationStack(app, 'safewalk-app-live-location-stack', {
  env,
  appUsersTable: userStack.appUsersTable,
});
const tipsStack = new TipsStack(app, 'safewalk-app-tips-stack', { env });
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
  liveLocationHandler: liveLocationStack.liveLocationHandler,
  tipsHandler: tipsStack.tipsHandler,
});
