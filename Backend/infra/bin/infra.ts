#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AuthStack } from '../lib/auth-stack';
import { UserStack } from '../lib/user-stack';
import { NotificationStack } from '../lib/notification-stack';
import { SosStack } from '../lib/sos-stack';
import { ApiStack } from '../lib/api-stack';

const required = ['PLATFORM_DOMAIN', 'VENDOR_ID', 'API_KEY', 'WEBHOOK_SECRET'];

for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Missing required env var: ${name}`);
  }
}

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const authStack = new AuthStack(app, 'safewalk-app-auth-stack', { env });

const userStack = new UserStack(app, 'safewalk-app-user-stack', { env });

const notificationStack = new NotificationStack(app, 'safewalk-app-notification-stack', { env });

const sosStack = new SosStack(app, 'safewalk-app-sos-stack', {
  env,
  appUsersTable: userStack.appUsersTable,
  pushNotificationTopic: notificationStack.pushNotificationTopic,
});

new ApiStack(app, 'safewalk-app-api-stack', {
  env,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
  authHandler: authStack.authHandler,
  userProfileHandler: userStack.userProfileHandler,
  platformRegistrationHandler: userStack.platformRegistrationHandler,
  notificationHandler: notificationStack.notificationHandler,
  sosHandler: sosStack.sosHandler,
});