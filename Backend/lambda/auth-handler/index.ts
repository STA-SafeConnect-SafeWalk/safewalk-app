import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  GlobalSignOutCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  AuthFlowType,
  NotAuthorizedException,
  UserNotFoundException,
  UsernameExistsException,
  CodeMismatchException,
  ExpiredCodeException,
  InvalidPasswordException,
  LimitExceededException,
  TooManyRequestsException,
} from '@aws-sdk/client-cognito-identity-provider';

const cognitoClient = new CognitoIdentityProviderClient({});

interface SignUpRequest {
  email: string;
  password: string;
  displayName?: string;
}

interface ConfirmRequest {
  email: string;
  confirmationCode: string;
}

interface SignInRequest {
  email: string;
  password: string;
}

interface RefreshRequest {
  refreshToken: string;
}

interface SignOutRequest {
  accessToken: string;
}

interface ForgotPasswordRequest {
  email: string;
}

interface ConfirmForgotPasswordRequest {
  email: string;
  confirmationCode: string;
  newPassword: string;
}

const getEnv = (name: string): string | undefined => process.env[name];

const missingEnvResponse = (name: string): APIGatewayProxyResultV2 => ({
  statusCode: 500,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ error: `Server configuration error: ${name} not set` }),
});

const jsonResponse = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function parseBody<T>(raw: string | undefined): { ok: true; body: T } | { ok: false; response: APIGatewayProxyResultV2 } {
  if (!raw) return { ok: false, response: jsonResponse(400, { error: 'Request body is required' }) };
  try {
    return { ok: true, body: JSON.parse(raw) as T };
  } catch {
    return { ok: false, response: jsonResponse(400, { error: 'Invalid JSON in request body' }) };
  }
}

/** Maps known Cognito errors to appropriate HTTP status codes. */
function cognitoErrorResponse(error: unknown): APIGatewayProxyResultV2 {
  if (error instanceof NotAuthorizedException) {
    return jsonResponse(401, { error: 'Incorrect email or password' });
  }
  if (error instanceof UserNotFoundException) {
    return jsonResponse(404, { error: 'User not found' });
  }
  if (error instanceof UsernameExistsException) {
    return jsonResponse(409, { error: 'An account with this email already exists' });
  }
  if (error instanceof CodeMismatchException) {
    return jsonResponse(400, { error: 'Invalid confirmation code' });
  }
  if (error instanceof ExpiredCodeException) {
    return jsonResponse(400, { error: 'Confirmation code has expired' });
  }
  if (error instanceof InvalidPasswordException) {
    return jsonResponse(400, { error: 'Password does not meet requirements' });
  }
  if (error instanceof LimitExceededException || error instanceof TooManyRequestsException) {
    return jsonResponse(429, { error: 'Too many requests, please try again later' });
  }
  console.error('Unhandled Cognito error:', error);
  return jsonResponse(500, {
    error: 'Authentication service error',
    details: error instanceof Error ? error.message : 'Unknown error',
  });
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const appClientId = getEnv('APP_CLIENT_ID');
  if (!appClientId) return missingEnvResponse('APP_CLIENT_ID');

  switch (event.routeKey) {
    case 'POST /auth/sign-up':
      return handleSignUp(event, appClientId);

    case 'POST /auth/confirm':
      return handleConfirm(event, appClientId);

    case 'POST /auth/sign-in':
      return handleSignIn(event, appClientId);

    case 'POST /auth/refresh':
      return handleRefresh(event, appClientId);

    case 'POST /auth/sign-out':
      return handleSignOut(event);

    case 'POST /auth/forgot-password':
      return handleForgotPassword(event, appClientId);

    case 'POST /auth/confirm-forgot-password':
      return handleConfirmForgotPassword(event, appClientId);

    default:
      return jsonResponse(404, { error: 'Route not found' });
  }
};

async function handleSignUp(
  event: APIGatewayProxyEventV2,
  appClientId: string,
): Promise<APIGatewayProxyResultV2> {
  const parsed = parseBody<SignUpRequest>(event.body);
  if (!parsed.ok) return parsed.response;
  const { email, password, displayName } = parsed.body;

  if (!email || typeof email !== 'string') {
    return jsonResponse(400, { error: 'email is required and must be a string' });
  }
  if (!password || typeof password !== 'string') {
    return jsonResponse(400, { error: 'password is required and must be a string' });
  }

  try {
    const result = await cognitoClient.send(
      new SignUpCommand({
        ClientId: appClientId,
        Username: email,
        Password: password,
        UserAttributes: [
          { Name: 'email', Value: email },
          ...(displayName ? [{ Name: 'name', Value: displayName }] : []),
        ],
      }),
    );

    console.log('User signed up:', result.UserSub);
    return jsonResponse(201, {
      message: 'Sign-up successful. Please check your email for a verification code.',
      userSub: result.UserSub,
      confirmed: result.UserConfirmed,
    });
  } catch (error) {
    return cognitoErrorResponse(error);
  }
}

async function handleConfirm(
  event: APIGatewayProxyEventV2,
  appClientId: string,
): Promise<APIGatewayProxyResultV2> {
  const parsed = parseBody<ConfirmRequest>(event.body);
  if (!parsed.ok) return parsed.response;
  const { email, confirmationCode } = parsed.body;

  if (!email || typeof email !== 'string') {
    return jsonResponse(400, { error: 'email is required and must be a string' });
  }
  if (!confirmationCode || typeof confirmationCode !== 'string') {
    return jsonResponse(400, { error: 'confirmationCode is required and must be a string' });
  }

  try {
    await cognitoClient.send(
      new ConfirmSignUpCommand({
        ClientId: appClientId,
        Username: email,
        ConfirmationCode: confirmationCode,
      }),
    );

    console.log('User confirmed:', email);
    return jsonResponse(200, { message: 'Email confirmed. You can now sign in.' });
  } catch (error) {
    return cognitoErrorResponse(error);
  }
}

async function handleSignIn(
  event: APIGatewayProxyEventV2,
  appClientId: string,
): Promise<APIGatewayProxyResultV2> {
  const parsed = parseBody<SignInRequest>(event.body);
  if (!parsed.ok) return parsed.response;
  const { email, password } = parsed.body;

  if (!email || typeof email !== 'string') {
    return jsonResponse(400, { error: 'email is required and must be a string' });
  }
  if (!password || typeof password !== 'string') {
    return jsonResponse(400, { error: 'password is required and must be a string' });
  }

  try {
    const result = await cognitoClient.send(
      new InitiateAuthCommand({
        AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
        ClientId: appClientId,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
        },
      }),
    );

    if (!result.AuthenticationResult) {
      return jsonResponse(401, { error: 'Authentication failed' });
    }

    console.log('User signed in:', email);
    return jsonResponse(200, {
      idToken: result.AuthenticationResult.IdToken,
      accessToken: result.AuthenticationResult.AccessToken,
      refreshToken: result.AuthenticationResult.RefreshToken,
      expiresIn: result.AuthenticationResult.ExpiresIn,
    });
  } catch (error) {
    return cognitoErrorResponse(error);
  }
}

async function handleRefresh(
  event: APIGatewayProxyEventV2,
  appClientId: string,
): Promise<APIGatewayProxyResultV2> {
  const parsed = parseBody<RefreshRequest>(event.body);
  if (!parsed.ok) return parsed.response;
  const { refreshToken } = parsed.body;

  if (!refreshToken || typeof refreshToken !== 'string') {
    return jsonResponse(400, { error: 'refreshToken is required and must be a string' });
  }

  try {
    const result = await cognitoClient.send(
      new InitiateAuthCommand({
        AuthFlow: AuthFlowType.REFRESH_TOKEN_AUTH,
        ClientId: appClientId,
        AuthParameters: {
          REFRESH_TOKEN: refreshToken,
        },
      }),
    );

    if (!result.AuthenticationResult) {
      return jsonResponse(401, { error: 'Token refresh failed' });
    }

    return jsonResponse(200, {
      idToken: result.AuthenticationResult.IdToken,
      accessToken: result.AuthenticationResult.AccessToken,
      expiresIn: result.AuthenticationResult.ExpiresIn,
    });
  } catch (error) {
    return cognitoErrorResponse(error);
  }
}

async function handleSignOut(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const parsed = parseBody<SignOutRequest>(event.body);
  if (!parsed.ok) return parsed.response;
  const { accessToken } = parsed.body;

  if (!accessToken || typeof accessToken !== 'string') {
    return jsonResponse(400, { error: 'accessToken is required and must be a string' });
  }

  try {
    await cognitoClient.send(new GlobalSignOutCommand({ AccessToken: accessToken }));
    console.log('User signed out');
    return jsonResponse(200, { message: 'Signed out successfully' });
  } catch (error) {
    return cognitoErrorResponse(error);
  }
}

async function handleForgotPassword(
  event: APIGatewayProxyEventV2,
  appClientId: string,
): Promise<APIGatewayProxyResultV2> {
  const parsed = parseBody<ForgotPasswordRequest>(event.body);
  if (!parsed.ok) return parsed.response;
  const { email } = parsed.body;

  if (!email || typeof email !== 'string') {
    return jsonResponse(400, { error: 'email is required and must be a string' });
  }

  try {
    await cognitoClient.send(
      new ForgotPasswordCommand({
        ClientId: appClientId,
        Username: email,
      }),
    );

    // Always return 200 to prevent account enumeration
    return jsonResponse(200, {
      message: 'If an account with that email exists, a reset code has been sent.',
    });
  } catch (error) {
    if (error instanceof UserNotFoundException || error instanceof NotAuthorizedException) {
      // Return 200 to avoid account enumeration
      return jsonResponse(200, {
        message: 'If an account with that email exists, a reset code has been sent.',
      });
    }
    return cognitoErrorResponse(error);
  }
}

async function handleConfirmForgotPassword(
  event: APIGatewayProxyEventV2,
  appClientId: string,
): Promise<APIGatewayProxyResultV2> {
  const parsed = parseBody<ConfirmForgotPasswordRequest>(event.body);
  if (!parsed.ok) return parsed.response;
  const { email, confirmationCode, newPassword } = parsed.body;

  if (!email || typeof email !== 'string') {
    return jsonResponse(400, { error: 'email is required and must be a string' });
  }
  if (!confirmationCode || typeof confirmationCode !== 'string') {
    return jsonResponse(400, { error: 'confirmationCode is required and must be a string' });
  }
  if (!newPassword || typeof newPassword !== 'string') {
    return jsonResponse(400, { error: 'newPassword is required and must be a string' });
  }

  try {
    await cognitoClient.send(
      new ConfirmForgotPasswordCommand({
        ClientId: appClientId,
        Username: email,
        ConfirmationCode: confirmationCode,
        Password: newPassword,
      }),
    );

    console.log('Password reset confirmed for:', email);
    return jsonResponse(200, { message: 'Password reset successfully. You can now sign in.' });
  } catch (error) {
    return cognitoErrorResponse(error);
  }
}
