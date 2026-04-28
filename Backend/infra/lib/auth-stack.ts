import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly authHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'safewalk-user-pool', {
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

    this.userPoolClient = this.userPool.addClient('safewalk-app-client', {
      userPoolClientName: 'safewalk-app-client',
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
    });

    this.authHandler = new NodejsFunction(this, 'auth-handler', {
      functionName: 'auth-handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../lambda/auth-handler/index.ts'),
      projectRoot: path.join(__dirname, '../..'),
      environment: {
        APP_CLIENT_ID: this.userPoolClient.userPoolClientId,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    this.authHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:SignUp',
          'cognito-idp:ConfirmSignUp',
          'cognito-idp:InitiateAuth',
          'cognito-idp:GlobalSignOut',
          'cognito-idp:ForgotPassword',
          'cognito-idp:ConfirmForgotPassword',
        ],
        resources: [this.userPool.userPoolArn],
      }),
    );

    new cdk.CfnOutput(this, 'user-pool-id', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'user-pool-client-id', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool App Client ID',
    });
  }
}
