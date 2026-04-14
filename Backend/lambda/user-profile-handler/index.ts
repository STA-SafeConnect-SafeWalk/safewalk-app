import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import * as https from 'https';
import * as http from 'http';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

interface ConnectWithCodeRequest {
  sharingCode: string;
}

interface PlatformSharingCodePayload {
  safeWalkId: string;
}

/** Response from POST /sharing-codes on the platform --> valid for 24 hours. */
interface PlatformSharingCodeResponse {
  success: boolean;
  data: {
    sharingCode: string;
    safeWalkId: string;
    createdAt: string;
    expiresAt: string;
  };
}

interface PlatformTrustedContactPayload {
  requesterSafeWalkId: string;
  sharingCode: string;
}

interface PlatformTrustedContactResponse {
  success: boolean;
  data?: Record<string, unknown>;
}

interface PlatformContact {
  contactId: string;
  status: string;
  targetSafeWalkId: string;
  requesterSafeWalkId: string;
  platformId: string;
  locationSharing: boolean;
  sosSharing: boolean;
  direction: 'outgoing' | 'incoming';
  peerName?: string;
  webhookUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface PlatformListContactsResponse {
  success: boolean;
  data: {
    contacts: PlatformContact[];
  };
}

/** Frontend-facing contact shape matching the Flutter Contact model. */
interface FrontendContact {
  /** Representative contact ID (outgoing preferred, fallback incoming). Used for DELETE. */
  contactId: string;
  /** The user's own contact ID for PATCH. Null if user has not configured their own sharing entry. */
  outgoingContactId: string | null;
  /** Partner's SafeWalk platform ID. */
  safeWalkId: string;
  /** Display name of the contact. */
  displayName: string;
  /** True when the app user has configured their own sharing entry for this contact. */
  isOutgoing: boolean;
  /** Whether the user shares their location with this contact (outgoing). */
  locationSharing: boolean;
  /** Whether the user shares SOS alerts with this contact (outgoing). */
  sosSharing: boolean;
  /** Whether the contact shares their location back with the user (incoming). */
  sharesBackLocation: boolean;
  /** Whether the contact shares SOS alerts back with the user (incoming). */
  sharesBackSOS: boolean;
}

/**
 * Returns the partner's safeWalkId for a contact entry:
 * - outgoing: the user initiated the connection → partner is targetSafeWalkId
 * - incoming: the partner initiated the connection → partner is requesterSafeWalkId
 */
function getPartnerSafeWalkId(c: PlatformContact): string {
  return c.direction === 'outgoing' ? c.targetSafeWalkId : c.requesterSafeWalkId;
}

/**
 * Merges platform contact entries (outgoing / incoming) into a deduplicated
 * list of FrontendContacts grouped by partner safeWalkId.
 *
 * - incoming entry  → populates locationSharing / sosSharing (user's own sharing settings)
 * - outgoing entry  → populates sharesBackLocation / sharesBackSOS (contact's sharing to user)
 * - isOutgoing      → true when the user has their own sharing entry (platform-side "incoming")
 * - id              → the outgoing contactId is preferred; falls back to incoming
 */
function buildFrontendContacts(platformContacts: PlatformContact[]): FrontendContact[] {
  const byPartner = new Map<string, { outgoing?: PlatformContact; incoming?: PlatformContact }>();

  for (const c of platformContacts) {
    const partnerId = getPartnerSafeWalkId(c);
    const entry = byPartner.get(partnerId) ?? {};
    if (c.direction === 'outgoing') entry.outgoing = c;
    else entry.incoming = c;
    byPartner.set(partnerId, entry);
  }

  const contacts: FrontendContact[] = [];

  for (const { outgoing, incoming } of byPartner.values()) {
    const representative = outgoing ?? incoming!;
    contacts.push({
      contactId: representative.contactId,
      outgoingContactId: incoming?.contactId ?? null,
      safeWalkId: getPartnerSafeWalkId(representative),
      displayName: representative.peerName ?? 'Unbenannte Kontaktperson',
      isOutgoing: !!incoming,
      locationSharing: incoming?.locationSharing ?? false,
      sosSharing: incoming?.sosSharing ?? false,
      sharesBackLocation: outgoing?.locationSharing ?? false,
      sharesBackSOS: outgoing?.sosSharing ?? false,
    });
  }

  return contacts;
}

interface UpdateContactSettingsRequest {
  locationSharing: boolean;
  sosSharing: boolean;
}

interface PlatformUpdateContactPayload {
  safeWalkId: string;
  locationSharing: boolean;
  sosSharing: boolean;
}

interface PlatformUpdateContactResponse {
  success: boolean;
  data?: Record<string, unknown>;
}

interface PlatformDeleteContactPayload {
  safeWalkId: string;
}

interface PlatformDeleteContactResponse {
  success: boolean;
  data?: Record<string, unknown>;
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

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

/** Extracts the authenticated user's Cognito sub from the API Gateway JWT context. */
const getAuthenticatedUserId = (event: APIGatewayProxyEventV2): string | undefined => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = event.requestContext as any;
  return ctx.authorizer?.jwt?.claims?.sub as string | undefined;
};

const UNAUTHORIZED_RESPONSE: APIGatewayProxyResultV2 = {
  statusCode: 401,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ error: 'Unauthorized' }),
};

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const tableName = getEnv('TABLE_NAME');
  if (!tableName) return missingEnvResponse('TABLE_NAME');

  switch (event.routeKey) {
    case 'GET /me':
      return handleGetMe(event, tableName);

    case 'POST /register':
      return handleRegister(event, tableName);

    case 'GET /sharing-code':
      return handleGetSharingCode(event, tableName);

    case 'POST /sharing-code':
      return handleGenerateSharingCode(event, tableName);

    case 'POST /sharing-code/connect':
      return handleConnectWithCode(event, tableName);

    case 'GET /contacts':
      return handleListContacts(event, tableName);

    case 'PATCH /contacts/{contactId}':
      return handleUpdateContactSettings(event, tableName);

    case 'DELETE /contacts/{contactId}':
      return handleDeleteContact(event, tableName);

    default:
      return jsonResponse(404, { error: 'Route not found' });
  }
};

// ---------------------------------------------------------------------------
// Handler: GET /me  –  check if the user profile exists in DynamoDB
// ---------------------------------------------------------------------------

async function handleGetMe(
  event: APIGatewayProxyEventV2,
  tableName: string,
): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  try {
    const result = await docClient.send(
      new GetCommand({ TableName: tableName, Key: { safeWalkAppId: userId } }),
    );

    if (!result.Item) {
      return jsonResponse(404, { error: 'User profile not found' });
    }

    return jsonResponse(200, {
      userId,
      email: result.Item.email ?? null,
      displayName: result.Item.displayName ?? null,
      hasPlatformRegistration: !!result.Item.safeWalkId,
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return jsonResponse(500, {
      error: 'Failed to retrieve user profile',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function handleGetSharingCode(
  event: APIGatewayProxyEventV2,
  tableName: string,
): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  try {
    const result = await docClient.send(
      new GetCommand({ TableName: tableName, Key: { safeWalkAppId: userId } }),
    );

    if (!result.Item) {
      return jsonResponse(404, { error: 'User not found' });
    }

    const { sharingCode, sharingCodeExpiresAt } = result.Item;
    if (!sharingCode || !sharingCodeExpiresAt) {
      return jsonResponse(404, { error: 'No sharing code found for this user' });
    }

    return jsonResponse(200, { sharingCode, sharingCodeExpiresAt });
  } catch (error) {
    console.error('Error fetching sharing code:', error);
    return jsonResponse(500, {
      error: 'Failed to retrieve sharing code',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function handleGenerateSharingCode(
  event: APIGatewayProxyEventV2,
  tableName: string,
): Promise<APIGatewayProxyResultV2> {
  const platformBaseDomain = getEnv('PLATFORM_DOMAIN');
  if (!platformBaseDomain) return missingEnvResponse('PLATFORM_DOMAIN');

  const apiKey = getEnv('API_KEY');
  if (!apiKey) return missingEnvResponse('API_KEY');

  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  let safeWalkId: string;
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: tableName, Key: { safeWalkAppId: userId } }),
    );

    if (!result.Item?.safeWalkId) {
      return jsonResponse(400, { error: 'User has not been registered on the platform yet' });
    }
    safeWalkId = result.Item.safeWalkId as string;
  } catch (error) {
    console.error('Error retrieving user:', error);
    return jsonResponse(500, {
      error: 'Failed to retrieve user data',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  const sharingCodesUrl = `${platformBaseDomain}/sharing-codes`;
  const payload: PlatformSharingCodePayload = { safeWalkId };

  try {
    const platformResponse = await sendRequest<PlatformSharingCodeResponse>(
      sharingCodesUrl,
      'POST',
      apiKey,
      payload,
    );

    if (!platformResponse.success || !platformResponse.data?.sharingCode || !platformResponse.data?.expiresAt) {
      console.error('Invalid platform sharing code response:', platformResponse);
      return jsonResponse(502, {
        error: 'Invalid platform response',
        details: 'Sharing code response missing required fields',
      });
    }

    const { sharingCode, expiresAt: sharingCodeExpiresAt } = platformResponse.data;

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { safeWalkAppId: userId },
        UpdateExpression:
          'SET sharingCode = :sharingCode, sharingCodeExpiresAt = :sharingCodeExpiresAt, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':sharingCode': sharingCode,
          ':sharingCodeExpiresAt': sharingCodeExpiresAt,
          ':updatedAt': new Date().toISOString(),
        },
      }),
    );

    console.log('Sharing code generated and stored for user:', userId);
    return jsonResponse(200, { sharingCode, sharingCodeExpiresAt });
  } catch (error) {
    console.error('Error generating sharing code:', error);
    return jsonResponse(502, {
      error: 'Failed to generate sharing code',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function handleConnectWithCode(
  event: APIGatewayProxyEventV2,
  tableName: string,
): Promise<APIGatewayProxyResultV2> {
  const platformBaseDomain = getEnv('PLATFORM_DOMAIN');
  if (!platformBaseDomain) return missingEnvResponse('PLATFORM_DOMAIN');

  const apiKey = getEnv('API_KEY');
  if (!apiKey) return missingEnvResponse('API_KEY');

  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  let requestBody: ConnectWithCodeRequest;
  try {
    if (!event.body) return jsonResponse(400, { error: 'Request body is required' });
    requestBody = JSON.parse(event.body) as ConnectWithCodeRequest;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON in request body' });
  }

  if (!requestBody.sharingCode || typeof requestBody.sharingCode !== 'string') {
    return jsonResponse(400, { error: 'sharingCode is required and must be a string' });
  }

  let safeWalkId: string;
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: tableName, Key: { safeWalkAppId: userId } }),
    );

    if (!result.Item?.safeWalkId) {
      return jsonResponse(400, { error: 'User has not been registered on the platform yet' });
    }
    safeWalkId = result.Item.safeWalkId as string;
  } catch (error) {
    console.error('Error retrieving user:', error);
    return jsonResponse(500, {
      error: 'Failed to retrieve user data',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  const trustedContactsUrl = `${platformBaseDomain}/contacts`;
  const payload: PlatformTrustedContactPayload = {
    requesterSafeWalkId: safeWalkId,
    sharingCode: requestBody.sharingCode,
  };

  try {
    const platformResponse = await sendRequest<PlatformTrustedContactResponse>(
      trustedContactsUrl,
      'POST',
      apiKey,
      payload,
    );

    if (!platformResponse.success) {
      console.error('Platform rejected trusted contact registration:', platformResponse);
      return jsonResponse(502, { error: 'Platform rejected trusted contact registration' });
    }

    console.log('Successfully registered as trusted contact for user:', userId);
    return jsonResponse(200, { message: 'Successfully connected as trusted contact' });
  } catch (error) {
    console.error('Error registering as trusted contact:', error);
    return jsonResponse(502, {
      error: 'Failed to register as trusted contact',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function handleListContacts(
  event: APIGatewayProxyEventV2,
  tableName: string,
): Promise<APIGatewayProxyResultV2> {
  const platformBaseDomain = getEnv('PLATFORM_DOMAIN');
  if (!platformBaseDomain) return missingEnvResponse('PLATFORM_DOMAIN');

  const apiKey = getEnv('API_KEY');
  if (!apiKey) return missingEnvResponse('API_KEY');

  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  let safeWalkId: string;
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: tableName, Key: { safeWalkAppId: userId } }),
    );
    if (!result.Item?.safeWalkId) {
      return jsonResponse(400, { error: 'User has not been registered on the platform yet' });
    }
    safeWalkId = result.Item.safeWalkId as string;
  } catch (error) {
    console.error('Error retrieving user:', error);
    return jsonResponse(500, {
      error: 'Failed to retrieve user data',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  try {
    const contactsUrl = `${platformBaseDomain}/contacts/${encodeURIComponent(safeWalkId)}`;
    const platformResponse = await sendRequest<PlatformListContactsResponse>(
      contactsUrl,
      'GET',
      apiKey,
    );

    if (!platformResponse.success) {
      return jsonResponse(502, { error: 'Platform rejected contacts list request' });
    }

    const rawContacts = platformResponse.data.contacts;
    const contacts = buildFrontendContacts(rawContacts);
    return jsonResponse(200, { contacts });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    return jsonResponse(502, {
      error: 'Failed to fetch trusted contacts',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function handleUpdateContactSettings(
  event: APIGatewayProxyEventV2,
  tableName: string,
): Promise<APIGatewayProxyResultV2> {
  const platformBaseDomain = getEnv('PLATFORM_DOMAIN');
  if (!platformBaseDomain) return missingEnvResponse('PLATFORM_DOMAIN');

  const apiKey = getEnv('API_KEY');
  if (!apiKey) return missingEnvResponse('API_KEY');

  const contactId = event.pathParameters?.contactId;
  if (!contactId) return jsonResponse(400, { error: 'contactId path parameter is required' });

  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  let requestBody: UpdateContactSettingsRequest;
  try {
    if (!event.body) return jsonResponse(400, { error: 'Request body is required' });
    requestBody = JSON.parse(event.body) as UpdateContactSettingsRequest;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON in request body' });
  }

  if (typeof requestBody.locationSharing !== 'boolean') {
    return jsonResponse(400, { error: 'locationSharing is required and must be a boolean' });
  }
  if (typeof requestBody.sosSharing !== 'boolean') {
    return jsonResponse(400, { error: 'sosSharing is required and must be a boolean' });
  }

  let safeWalkId: string;
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: tableName, Key: { safeWalkAppId: userId } }),
    );
    if (!result.Item?.safeWalkId) {
      return jsonResponse(400, { error: 'User has not been registered on the platform yet' });
    }
    safeWalkId = result.Item.safeWalkId as string;
  } catch (error) {
    console.error('Error retrieving user:', error);
    return jsonResponse(500, {
      error: 'Failed to retrieve user data',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  const updateUrl = `${platformBaseDomain}/contacts/${encodeURIComponent(contactId)}`;
  const payload: PlatformUpdateContactPayload = {
    safeWalkId,
    locationSharing: requestBody.locationSharing,
    sosSharing: requestBody.sosSharing,
  };

  try {
    const platformResponse = await sendRequest<PlatformUpdateContactResponse>(
      updateUrl,
      'PATCH',
      apiKey,
      payload,
    );

    if (!platformResponse.success) {
      return jsonResponse(502, { error: 'Platform rejected contact settings update' });
    }

    console.log('Contact settings updated for contactId:', contactId, 'by user:', userId);
    return jsonResponse(200, { message: 'Contact settings updated successfully' });
  } catch (error) {
    console.error('Error updating contact settings:', error);
    return jsonResponse(502, {
      error: 'Failed to update contact settings',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function handleDeleteContact(
  event: APIGatewayProxyEventV2,
  tableName: string,
): Promise<APIGatewayProxyResultV2> {
  const platformBaseDomain = getEnv('PLATFORM_DOMAIN');
  if (!platformBaseDomain) return missingEnvResponse('PLATFORM_DOMAIN');

  const apiKey = getEnv('API_KEY');
  if (!apiKey) return missingEnvResponse('API_KEY');

  const contactId = event.pathParameters?.contactId;
  if (!contactId) return jsonResponse(400, { error: 'contactId path parameter is required' });

  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  let safeWalkId: string;
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: tableName, Key: { safeWalkAppId: userId } }),
    );
    if (!result.Item?.safeWalkId) {
      return jsonResponse(400, { error: 'User has not been registered on the platform yet' });
    }
    safeWalkId = result.Item.safeWalkId as string;
  } catch (error) {
    console.error('Error retrieving user:', error);
    return jsonResponse(500, {
      error: 'Failed to retrieve user data',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  const deleteUrl = `${platformBaseDomain}/contacts/${encodeURIComponent(contactId)}`;
  const payload: PlatformDeleteContactPayload = { safeWalkId };

  try {
    const platformResponse = await sendRequest<PlatformDeleteContactResponse>(
      deleteUrl,
      'DELETE',
      apiKey,
      payload,
    );

    if (!platformResponse.success) {
      return jsonResponse(502, { error: 'Platform rejected contact deletion' });
    }

    console.log('Trusted contact deleted, contactId:', contactId, 'by user:', userId);
    return jsonResponse(200, { message: 'Trusted contact removed successfully' });
  } catch (error) {
    console.error('Error deleting contact:', error);
    return jsonResponse(502, {
      error: 'Failed to delete trusted contact',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// ---------------------------------------------------------------------------
// Handler: POST /register  –  create the DynamoDB user profile after first
// sign-in AND automatically register the user on the SafeWalk platform so
// the caller never has to make a separate POST /register/platform request.
// ---------------------------------------------------------------------------

async function handleRegister(
  event: APIGatewayProxyEventV2,
  tableName: string,
): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  const platformBaseDomain = getEnv('PLATFORM_DOMAIN');
  if (!platformBaseDomain) return missingEnvResponse('PLATFORM_DOMAIN');

  const vendorId = getEnv('VENDOR_ID');
  if (!vendorId) return missingEnvResponse('VENDOR_ID');

  const apiKey = getEnv('API_KEY');
  if (!apiKey) return missingEnvResponse('API_KEY');

  // email and name are available in Cognito id token claims
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claims = (event.requestContext as any).authorizer?.jwt?.claims as Record<string, unknown> | undefined;
  const email = claims?.email as string | undefined;
  const nameFromClaims = claims?.name as string | undefined;

  // Optional display name: body takes precedence, JWT name claim is the fallback
  let displayName: string | undefined = nameFromClaims;
  if (event.body) {
    try {
      const body = JSON.parse(event.body) as { displayName?: string };
      if (typeof body.displayName === 'string') displayName = body.displayName;
    } catch {
      // body is optional – ignore parse errors
    }
  }

  // ── Step 1: create the DynamoDB user profile (idempotent) ─────────────────

  let isNewProfile = false;

  try {
    const existing = await docClient.send(
      new GetCommand({ TableName: tableName, Key: { safeWalkAppId: userId } }),
    );

    if (!existing.Item) {
      const now = new Date().toISOString();
      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            safeWalkAppId: userId,
            email: email ?? null,
            displayName: displayName ?? null,
            createdAt: now,
            updatedAt: now,
          },
          // Guard against a race condition between the read and the write
          ConditionExpression: 'attribute_not_exists(safeWalkAppId)',
        }),
      );
      isNewProfile = true;
      console.log('User profile created:', userId);
    } else {
      console.log('User profile already exists:', userId);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      // Race condition – profile was created concurrently, treat as existing
      console.log('Race condition: profile already exists for', userId);
    } else {
      console.error('Error creating user profile:', error);
      return jsonResponse(500, {
        error: 'Failed to create user profile',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // ── Step 2: automatic platform registration ────────────────────────────────
  //
  // Re-read the record so we have the latest state regardless of whether the
  // profile was just created or already existed.

  try {
    const userRecord = await docClient.send(
      new GetCommand({ TableName: tableName, Key: { safeWalkAppId: userId } }),
    );
    const item = userRecord.Item;

    // 2a. If the user already has a valid (non-expired) sharing code, return
    //     immediately – no platform call needed.
    if (item?.safeWalkId && item?.sharingCode && item?.sharingCodeExpiresAt) {
      const expiresAt = new Date(item.sharingCodeExpiresAt as string);
      if (expiresAt > new Date()) {
        console.log('User already has valid platform registration and sharing code');
        return jsonResponse(isNewProfile ? 201 : 200, {
          message: isNewProfile ? 'User profile created' : 'User profile already exists',
          userId,
          sharingCode: item.sharingCode,
          sharingCodeExpiresAt: item.sharingCodeExpiresAt,
        });
      }
      console.log('Existing sharing code has expired – renewing');
    }

    // 2b. Register on the platform if no safeWalkId yet.
    let safeWalkId: string;

    if (item?.safeWalkId) {
      safeWalkId = item.safeWalkId as string;
      console.log('Reusing existing safeWalkId:', safeWalkId);
    } else {
      const registrationResponse = await sendRequest<{
        success: boolean;
        data: { safeWalkId: string };
      }>(
        `${platformBaseDomain}/register`,
        'POST',
        apiKey,
        { platformUserId: userId, platformId: vendorId, ...(displayName ? { name: displayName } : {}) },
      );

      if (!registrationResponse.success || !registrationResponse.data?.safeWalkId) {
        console.error('Invalid platform registration response:', registrationResponse);
        // Profile is saved – return partial success so the caller can retry
        // via POST /register/platform later.
        return jsonResponse(isNewProfile ? 201 : 200, {
          message: isNewProfile ? 'User profile created' : 'User profile already exists',
          userId,
          platformRegistrationError:
            'Platform registration failed – please retry via POST /register/platform',
        });
      }

      safeWalkId = registrationResponse.data.safeWalkId;
      console.log('Platform registration successful, safeWalkId:', safeWalkId);
    }

    // 2c. Generate a fresh 24-hour sharing code.
    const sharingCodeResponse = await sendRequest<{
      success: boolean;
      data: { sharingCode: string; safeWalkId: string; expiresAt: string };
    }>(
      `${platformBaseDomain}/sharing-codes`,
      'POST',
      apiKey,
      { safeWalkId },
    );

    if (!sharingCodeResponse.success || !sharingCodeResponse.data?.sharingCode || !sharingCodeResponse.data?.expiresAt) {
      console.error('Invalid sharing code response:', sharingCodeResponse);
      return jsonResponse(isNewProfile ? 201 : 200, {
        message: isNewProfile ? 'User profile created' : 'User profile already exists',
        userId,
        platformRegistrationError:
          'Sharing code generation failed – please retry via POST /register/platform',
      });
    }

    const { sharingCode, expiresAt: sharingCodeExpiresAt } = sharingCodeResponse.data;

    // 2d. Persist safeWalkId + sharing code in DynamoDB.
    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { safeWalkAppId: userId },
        UpdateExpression:
          'SET safeWalkId = :safeWalkId, sharingCode = :sharingCode, sharingCodeExpiresAt = :sharingCodeExpiresAt, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':safeWalkId': safeWalkId,
          ':sharingCode': sharingCode,
          ':sharingCodeExpiresAt': sharingCodeExpiresAt,
          ':updatedAt': new Date().toISOString(),
        },
      }),
    );

    console.log('Platform registration data stored for user:', userId);
    return jsonResponse(isNewProfile ? 201 : 200, {
      message: isNewProfile ? 'User profile created' : 'User profile already exists',
      userId,
      sharingCode,
      sharingCodeExpiresAt,
    });
  } catch (error) {
    console.error('Error during platform registration step:', error);
    // The user profile was already saved – return partial success so the
    // client can retry platform registration separately if needed.
    return jsonResponse(isNewProfile ? 201 : 200, {
      message: isNewProfile ? 'User profile created' : 'User profile already exists',
      userId,
      platformRegistrationError:
        'Platform registration failed – please retry via POST /register/platform',
    });
  }
}

// ---------------------------------------------------------------------------
// HTTP helper – supports GET, POST, PATCH, DELETE to the platform
// ---------------------------------------------------------------------------

async function sendRequest<T>(url: string, method: HttpMethod, apiKey: string, payload?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const data = payload !== undefined ? JSON.stringify(payload) : undefined;
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    };
    if (data !== undefined) {
      headers['Content-Length'] = Buffer.byteLength(data);
    }

    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers,
    };

    console.log('Sending request to platform:', {
      hostname: options.hostname,
      port: options.port,
      path: options.path,
      method,
    });

    const req = httpModule.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        console.log('Platform response status:', res.statusCode);
        console.log('Platform response body:', responseData);
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(responseData) as T);
          } catch {
            reject(new Error(`Failed to parse platform response: ${responseData}`));
          }
        } else {
          reject(new Error(`Platform returned status ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.setTimeout(15000);
    if (data !== undefined) req.write(data);
    req.end();
  });
}
