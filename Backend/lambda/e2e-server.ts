import http from 'http';
import { createHmac } from 'crypto';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
  DeleteCommand,
  BatchGetCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SNSClient, PublishCommand, CreatePlatformEndpointCommand, DeleteEndpointCommand, SetEndpointAttributesCommand } from '@aws-sdk/client-sns';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  GlobalSignOutCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  NotAuthorizedException,
  UserNotFoundException,
  UsernameExistsException,
  CodeMismatchException,
} from '@aws-sdk/client-cognito-identity-provider';

// ---------------------------------------------------------------------------
// In-memory DB
// ---------------------------------------------------------------------------

type Item = Record<string, unknown>;

const TABLE_SCHEMAS: Record<string, { pk: string; sk?: string }> = {
  AppUsersTable:        { pk: 'safeWalkAppId' },
  SOSEventsTable:       { pk: 'sosId' },
  ReceivedSOSTable:     { pk: 'sosId', sk: 'targetUserId' },
  LiveLocationsTable:   { pk: 'safeWalkId' },
  DeviceTokensTable:    { pk: 'userId', sk: 'deviceToken' },
  TipsTable:            { pk: 'tipId' },
  HeatmapReportsTable:  { pk: 'geohash5', sk: 'sk' },
  HeatmapPublicDataTable: { pk: 'geohash5', sk: 'sk' },
};

class InMemoryDB {
  private tables = new Map<string, Item[]>();
  constructor() { for (const t of Object.keys(TABLE_SCHEMAS)) this.tables.set(t, []); }
  reset() { for (const k of this.tables.keys()) this.tables.set(k, []); }
  private tbl(t: string): Item[] { const r = this.tables.get(t); if (!r) throw new Error(`Unknown table: ${t}`); return r; }

  put(tableName: string, item: Item, conditionExpression?: string): void {
    const s = TABLE_SCHEMAS[tableName];
    if (!s) throw new Error(`Unknown table: ${tableName}`);
    const rows = this.tbl(tableName);
    const match = (i: Item) => s.sk
      ? i[s.pk] === item[s.pk] && i[s.sk] === item[s.sk]
      : i[s.pk] === item[s.pk];
    if (conditionExpression?.includes('attribute_not_exists')) {
      if (rows.find(match)) { const e = new Error('ConditionalCheckFailedException') as any; e.name = 'ConditionalCheckFailedException'; throw e; }
    }
    const idx = rows.findIndex(match);
    if (idx >= 0) rows[idx] = { ...item }; else rows.push({ ...item });
  }

  get(tableName: string, key: Record<string, unknown>): Item | undefined {
    return this.tbl(tableName).find(i => Object.entries(key).every(([k, v]) => i[k] === v));
  }

  delete(tableName: string, key: Record<string, unknown>): void {
    const rows = this.tbl(tableName);
    const idx = rows.findIndex(i => Object.entries(key).every(([k, v]) => i[k] === v));
    if (idx >= 0) rows.splice(idx, 1);
  }

  query(tableName: string, kce: string, eav: Record<string, unknown>, fe?: string, ean?: Record<string, string>, scanIndexForward?: boolean, limit?: number, select?: string, indexName?: string): { Items: Item[]; Count: number } {
    const rows = this.tbl(tableName);
    // Parse key condition
    const parseSimple = (expr: string, vals: Record<string, unknown>, names?: Record<string, string>) => {
      const parts: Array<{ field: string; op: string; value: unknown; value2?: unknown }> = [];
      for (const raw of expr.split(/\s+AND\s+/i)) {
        const p = raw.trim();
        const bw = p.match(/^([\w#]+)\s+begins_with\s*\(\s*([\w#]+)\s*,\s*(:\w+)\s*\)$/i) ??
                   p.match(/^begins_with\s*\(\s*([\w#]+)\s*,\s*(:\w+)\s*\)$/i);
        if (bw) {
          const field = names?.[bw[1]] ?? bw[1];
          parts.push({ field, op: 'begins_with', value: vals[bw[2] ?? bw[2]] });
          continue;
        }
        const between = p.match(/^([\w#]+)\s+BETWEEN\s+(:\w+)\s+AND\s+(:\w+)$/i);
        if (between) {
          const field = names?.[between[1]] ?? between[1];
          parts.push({ field, op: 'between', value: vals[between[2]], value2: vals[between[3]] });
          continue;
        }
        const ge = p.match(/^([\w#]+)\s*>=\s*(:\w+)$/);
        if (ge) { const field = names?.[ge[1]] ?? ge[1]; parts.push({ field, op: '>=', value: vals[ge[2]] }); continue; }
        const le = p.match(/^([\w#]+)\s*<=\s*(:\w+)$/);
        if (le) { const field = names?.[le[1]] ?? le[1]; parts.push({ field, op: '<=', value: vals[le[2]] }); continue; }
        const eq = p.match(/^([\w#]+)\s*=\s*(:\w+)$/);
        if (eq) { const field = names?.[eq[1]] ?? eq[1]; parts.push({ field, op: '=', value: vals[eq[2]] }); continue; }
      }
      return parts;
    };
    const applyParts = (item: Item, parts: ReturnType<typeof parseSimple>) => parts.every(({ field, op, value, value2 }) => {
      const v = item[field];
      if (op === '=') return v === value;
      if (op === '>=') return typeof v === 'string' ? (v as string) >= (value as string) : (v as number) >= (value as number);
      if (op === '<=') return typeof v === 'string' ? (v as string) <= (value as string) : (v as number) <= (value as number);
      if (op === 'begins_with') return typeof v === 'string' && v.startsWith(value as string);
      if (op === 'between') return typeof v === 'string' ? (v as string) >= (value as string) && (v as string) <= (value2 as string) : (v as number) >= (value as number) && (v as number) <= (value2 as number);
      return false;
    });
    const kcParts = parseSimple(kce, eav, ean);
    let filtered = rows.filter(i => applyParts(i, kcParts));
    if (fe) {
      // Handle IN expressions for filter expression
      const inMatch = fe.match(/^#(\w+)\s+IN\s+\(([^)]+)\)$/);
      if (inMatch) {
        const field = ean?.[`#${inMatch[1]}`] ?? inMatch[1];
        const vals2 = inMatch[2].split(',').map(s => eav[s.trim()]);
        filtered = filtered.filter(i => vals2.includes(i[field]));
      } else {
        // Handle AND conditions with nested filters
        const andParts = fe.split(/\s+AND\s+/i);
        filtered = filtered.filter(item => {
          return andParts.every(part => {
            const inM = part.trim().match(/^([\w#.]+)\s*=\s*(:\w+)$/);
            if (inM) {
              const fieldName = ean?.[inM[1]] ?? inM[1];
              // Support nested access like victim.platformUserId
              if (fieldName.includes('.')) {
                const [parent, child] = fieldName.split('.');
                return (item[parent] as any)?.[child] === eav[inM[2]];
              }
              return item[fieldName] === eav[inM[2]];
            }
            // Try parseSimple for remaining parts
            const feParts = parseSimple(part.trim(), eav, ean);
            return applyParts(item, feParts);
          });
        });
      }
    }
    if (select === 'COUNT') return { Items: [], Count: filtered.length };
    if (limit) filtered = filtered.slice(0, limit);
    return { Items: filtered, Count: filtered.length };
  }

  scan(tableName: string): Item[] { return [...this.tbl(tableName)]; }

  update(tableName: string, key: Record<string, unknown>, ue: string, eav: Record<string, unknown>, ean?: Record<string, string>, ce?: string): void {
    // Conditional check
    if (ce) {
      const item = this.tbl(tableName).find(i => Object.entries(key).every(([k, v]) => i[k] === v));
      if (ce.includes('#s = :pending') || ce.includes('#s = :active')) {
        const statusField = ean?.['#s'] ?? 'status';
        const expectedStatus = ce.includes(':pending') ? eav[':pending'] : eav[':active'];
        if (!item || item[statusField] !== expectedStatus) {
          const e = new Error('ConditionalCheckFailedException') as any;
          e.name = 'ConditionalCheckFailedException';
          throw e;
        }
      }
    }

    let item = this.tbl(tableName).find(i => Object.entries(key).every(([k, v]) => i[k] === v));
    if (!item) {
      // Upsert for update
      item = { ...key };
      this.tbl(tableName).push(item);
    }
    const setMatch = ue.match(/SET\s+(.+?)(?:\s+REMOVE|$)/is);
    if (setMatch) {
      for (const assignment of setMatch[1].split(',').map(s => s.trim())) {
        const [lhs, rhs] = assignment.split('=').map(s => s.trim());
        const field = ean?.[lhs] ?? lhs;
        item[field] = eav[rhs];
      }
    }
    const rmMatch = ue.match(/REMOVE\s+(.+)/i);
    if (rmMatch) {
      for (const f of rmMatch[1].split(',').map(s => s.trim())) {
        delete item[ean?.[f] ?? f];
      }
    }
  }

  batchGet(requestItems: Record<string, { Keys: Record<string, unknown>[] }>): Record<string, Item[]> {
    const result: Record<string, Item[]> = {};
    for (const [t, { Keys }] of Object.entries(requestItems)) {
      result[t] = Keys.map(k => this.get(t, k)).filter((i): i is Item => !!i);
    }
    return result;
  }

  batchWrite(requestItems: Record<string, Array<{ PutRequest?: { Item: Item }; DeleteRequest?: { Key: Record<string, unknown> } }>>): void {
    for (const [t, reqs] of Object.entries(requestItems)) {
      for (const req of reqs) {
        if (req.PutRequest) this.put(t, req.PutRequest.Item);
        if (req.DeleteRequest) this.delete(t, req.DeleteRequest.Key);
      }
    }
  }

  getAll(tableName: string): Item[] { return [...this.tbl(tableName)]; }
}

const db = new InMemoryDB();

// ---------------------------------------------------------------------------
// AWS SDK mocks (must be set up before any handler imports)
// ---------------------------------------------------------------------------

const ddbMock = mockClient(DynamoDBDocumentClient);
ddbMock.on(PutCommand).callsFake((input: any) => { db.put(input.TableName, input.Item, input.ConditionExpression); return {}; });
ddbMock.on(GetCommand).callsFake((input: any) => ({ Item: db.get(input.TableName, input.Key) }));
ddbMock.on(UpdateCommand).callsFake((input: any) => { db.update(input.TableName, input.Key, input.UpdateExpression, input.ExpressionAttributeValues, input.ExpressionAttributeNames, input.ConditionExpression); return {}; });
ddbMock.on(DeleteCommand).callsFake((input: any) => { db.delete(input.TableName, input.Key); return {}; });
ddbMock.on(QueryCommand).callsFake((input: any) => db.query(input.TableName, input.KeyConditionExpression, input.ExpressionAttributeValues ?? {}, input.FilterExpression, input.ExpressionAttributeNames, input.ScanIndexForward, input.Limit, input.Select, input.IndexName));
ddbMock.on(ScanCommand).callsFake((input: any) => { const items = db.scan(input.TableName); return { Items: items, Count: items.length }; });
ddbMock.on(BatchGetCommand).callsFake((input: any) => ({ Responses: db.batchGet(input.RequestItems) }));
ddbMock.on(BatchWriteCommand).callsFake((input: any) => { db.batchWrite(input.RequestItems); return { UnprocessedItems: {} }; });

// SQS mock — captures messages
const sqsMessages: Array<{ queueUrl: string; body: string }> = [];
const sqsMock = mockClient(SQSClient);
sqsMock.on(SendMessageCommand).callsFake((input: any) => {
  sqsMessages.push({ queueUrl: input.QueueUrl, body: input.MessageBody });
  return { MessageId: `msg-${Date.now()}` };
});

// SNS mock — captures publish calls
const snsPublishes: Array<{ targetArn?: string; message: string }> = [];
const snsMock = mockClient(SNSClient);
snsMock.on(PublishCommand).callsFake((input: any) => {
  snsPublishes.push({ targetArn: input.TargetArn, message: input.Message });
  return { MessageId: `sns-${Date.now()}` };
});
snsMock.on(CreatePlatformEndpointCommand).callsFake((input: any) => ({
  EndpointArn: `arn:aws:sns:us-east-1:123456789:endpoint/GCM/app/${input.Token}`,
}));
snsMock.on(SetEndpointAttributesCommand).resolves({});
snsMock.on(DeleteEndpointCommand).resolves({});

// Cognito mock — simple in-memory user store
interface CognitoUser { username: string; password: string; displayName?: string; confirmed: boolean; sub: string; }
const cognitoUsers = new Map<string, CognitoUser>();
const cognitoMock = mockClient(CognitoIdentityProviderClient);

cognitoMock.on(SignUpCommand).callsFake((input: any) => {
  if (cognitoUsers.has(input.Username)) {
    throw new UsernameExistsException({ message: 'An account with this email already exists', $metadata: {} });
  }
  const sub = `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const nameAttr = (input.UserAttributes ?? []).find((a: any) => a.Name === 'name');
  cognitoUsers.set(input.Username, { username: input.Username, password: input.Password, displayName: nameAttr?.Value, confirmed: false, sub });
  return { UserSub: sub, UserConfirmed: false };
});

cognitoMock.on(ConfirmSignUpCommand).callsFake((input: any) => {
  const user = cognitoUsers.get(input.Username);
  if (!user) throw new UserNotFoundException({ message: 'User not found', $metadata: {} });
  if (input.ConfirmationCode !== '123456') throw new CodeMismatchException({ message: 'Invalid confirmation code', $metadata: {} });
  user.confirmed = true;
  return {};
});

cognitoMock.on(InitiateAuthCommand).callsFake((input: any) => {
  if (input.AuthFlow === 'USER_PASSWORD_AUTH') {
    const user = cognitoUsers.get(input.AuthParameters?.USERNAME);
    if (!user) throw new UserNotFoundException({ message: 'User not found', $metadata: {} });
    if (user.password !== input.AuthParameters?.PASSWORD) throw new NotAuthorizedException({ message: 'Incorrect email or password', $metadata: {} });
    if (!user.confirmed) throw new NotAuthorizedException({ message: 'User is not confirmed', $metadata: {} });
    // Encode sub and email in a simple base64 "token" so handlers can extract it
    const claims = { sub: user.sub, email: user.username, name: user.displayName ?? '' };
    const claimsB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const fakeToken = `e2e.${claimsB64}.sig`;
    return {
      AuthenticationResult: { IdToken: fakeToken, AccessToken: `acc.${claimsB64}.sig`, RefreshToken: `ref.${user.sub}`, ExpiresIn: 3600 },
    };
  }
  if (input.AuthFlow === 'REFRESH_TOKEN_AUTH') {
    const sub = input.AuthParameters?.REFRESH_TOKEN?.replace('ref.', '');
    const user = [...cognitoUsers.values()].find(u => u.sub === sub);
    if (!user) throw new NotAuthorizedException({ message: 'Invalid refresh token', $metadata: {} });
    const claims = { sub: user.sub, email: user.username };
    const claimsB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return { AuthenticationResult: { IdToken: `e2e.${claimsB64}.sig`, AccessToken: `acc.${claimsB64}.sig`, ExpiresIn: 3600 } };
  }
  throw new Error('Unsupported auth flow');
});

cognitoMock.on(GlobalSignOutCommand).resolves({});
cognitoMock.on(ForgotPasswordCommand).resolves({});
cognitoMock.on(ConfirmForgotPasswordCommand).callsFake((input: any) => {
  const user = cognitoUsers.get(input.Username);
  if (!user) throw new UserNotFoundException({ message: 'User not found', $metadata: {} });
  if (input.ConfirmationCode !== '654321') throw new CodeMismatchException({ message: 'Invalid confirmation code', $metadata: {} });
  user.password = input.Password;
  return {};
});

// ---------------------------------------------------------------------------
// In-memory mock SafeConnect Platform server (HTTP on a dynamic port)
// ---------------------------------------------------------------------------

interface PlatformUser { safeWalkId: string; platformUserId: string; platformId: string; name?: string; }
interface PlatformContact { contactId: string; requesterSafeWalkId: string; targetSafeWalkId: string; sharingCode?: string; locationSharing: boolean; sosSharing: boolean; status: string; platformId: string; createdAt: string; updatedAt: string; }
interface PlatformSharingCode { safeWalkId: string; code: string; expiresAt: string; }

const platformUsers = new Map<string, PlatformUser>();
const platformContacts = new Map<string, PlatformContact>();
const platformSharingCodes = new Map<string, PlatformSharingCode>(); // code → entry
let platformApiKey = 'e2e-test-api-key';

function startPlatformServer(): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const auth = req.headers['x-api-key'];
      const url = req.url ?? '/';
      const method = req.method ?? 'GET';

      if (auth !== platformApiKey) {
        res.writeHead(401); res.end(JSON.stringify({ success: false, error: 'Unauthorized' })); return;
      }

      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        const json = (sc: number, data: unknown) => { res.writeHead(sc, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
        const parsed = body ? JSON.parse(body) : {};

        // POST /register
        if (method === 'POST' && url === '/register') {
          const safeWalkId = `sw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          platformUsers.set(safeWalkId, { safeWalkId, platformUserId: parsed.platformUserId, platformId: parsed.platformId, name: parsed.name });
          return json(200, { success: true, data: { safeWalkId } });
        }

        // POST /sharing-codes
        if (method === 'POST' && url === '/sharing-codes') {
          const { safeWalkId } = parsed;
          const code = `code-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          platformSharingCodes.set(code, { safeWalkId, code, expiresAt });
          return json(200, { success: true, data: { sharingCode: code, safeWalkId, createdAt: new Date().toISOString(), expiresAt } });
        }

        // POST /contacts  (connect via sharing code or connect-back)
        if (method === 'POST' && url === '/contacts') {
          const contactId = `cid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const now = new Date().toISOString();
          let requesterSafeWalkId: string;
          let targetSafeWalkId: string;

          if (parsed.sharingCode) {
            // Connect via sharing code
            const entry = platformSharingCodes.get(parsed.sharingCode);
            if (!entry) return json(404, { success: false, error: 'Sharing code not found or expired' });
            requesterSafeWalkId = parsed.requesterSafeWalkId;
            targetSafeWalkId = entry.safeWalkId;
          } else {
            requesterSafeWalkId = parsed.requesterSafeWalkId;
            targetSafeWalkId = parsed.targetSafeWalkId;
          }

          platformContacts.set(contactId, { contactId, requesterSafeWalkId, targetSafeWalkId, locationSharing: false, sosSharing: false, status: 'ACTIVE', platformId: 'e2e-platform', createdAt: now, updatedAt: now });
          return json(200, { success: true, data: { contactId } });
        }

        // GET /contacts/:safeWalkId
        const contactsGetMatch = url.match(/^\/contacts\/([^/]+)$/);
        if (method === 'GET' && contactsGetMatch) {
          const safeWalkId = decodeURIComponent(contactsGetMatch[1]);
          const contacts = [...platformContacts.values()]
            .filter(c => c.requesterSafeWalkId === safeWalkId || c.targetSafeWalkId === safeWalkId)
            .map(c => ({
              ...c,
              direction: c.requesterSafeWalkId === safeWalkId ? 'outgoing' : 'incoming',
              peerName: c.requesterSafeWalkId === safeWalkId
                ? platformUsers.get(c.targetSafeWalkId)?.name
                : platformUsers.get(c.requesterSafeWalkId)?.name,
            }));
          return json(200, { success: true, data: { contacts } });
        }

        // PATCH /contacts/:contactId
        const contactsPatchMatch = url.match(/^\/contacts\/([^/]+)$/);
        if (method === 'PATCH' && contactsPatchMatch) {
          const contactId = decodeURIComponent(contactsPatchMatch[1]);
          const contact = platformContacts.get(contactId);
          if (!contact) return json(404, { success: false, error: 'Contact not found' });
          if (parsed.locationSharing !== undefined) contact.locationSharing = parsed.locationSharing;
          if (parsed.sosSharing !== undefined) contact.sosSharing = parsed.sosSharing;
          contact.updatedAt = new Date().toISOString();
          return json(200, { success: true, data: contact });
        }

        // DELETE /contacts/:contactId
        const contactsDeleteMatch = url.match(/^\/contacts\/([^/]+)$/);
        if (method === 'DELETE' && contactsDeleteMatch) {
          const contactId = decodeURIComponent(contactsDeleteMatch[1]);
          platformContacts.delete(contactId);
          return json(200, { success: true });
        }

        // POST /sos — SOS creation (safeconnect platform side)
        if (method === 'POST' && url === '/sos') {
          const sosId = `psos-${Date.now()}`;
          const { safeWalkId } = parsed;
          const victim = platformUsers.get(safeWalkId);
          const contactsNotified = [...platformContacts.values()].filter(c => c.requesterSafeWalkId === safeWalkId || c.targetSafeWalkId === safeWalkId).length;
          return json(201, { success: true, data: { sosId, status: 'ACTIVE', contactsNotified, createdAt: new Date().toISOString(), victim } });
        }

        // PATCH /sos/:sosId
        const sosPatchMatch = url.match(/^\/sos\/([^/]+)$/);
        if (method === 'PATCH' && sosPatchMatch) {
          return json(200, { success: true, data: { sosId: sosPatchMatch[1], status: 'ACTIVE', contactsNotified: 0, latestGeoLocation: parsed.geoLocation, updatedAt: new Date().toISOString() } });
        }

        // DELETE /sos/:sosId
        const sosDeleteMatch = url.match(/^\/sos\/([^/]+)$/);
        if (method === 'DELETE' && sosDeleteMatch) {
          return json(200, { success: true, data: { sosId: sosDeleteMatch[1], status: 'CANCELLED' } });
        }

        json(404, { success: false, error: 'Not found' });
      });
    });

    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as any).port);
    });

    (globalThis as any).__E2E_PLATFORM_SERVER = server;
  });
}

// ---------------------------------------------------------------------------
// Helper: extract sub from e2e Bearer token
// ---------------------------------------------------------------------------

function extractSubFromToken(authHeader: string | undefined): string | undefined {
  if (!authHeader?.startsWith('Bearer e2e.')) return undefined;
  try {
    const b64 = authHeader.split('.')[1];
    return JSON.parse(Buffer.from(b64, 'base64url').toString()).sub;
  } catch { return undefined; }
}

// ---------------------------------------------------------------------------
// Environment + routing
// ---------------------------------------------------------------------------

async function main() {
  const platformPort = await startPlatformServer();
  const platformDomain = `http://127.0.0.1:${platformPort}`;

  process.env.APP_CLIENT_ID          = 'e2e-client-id';
  process.env.TABLE_NAME             = 'AppUsersTable';
  process.env.APP_USERS_TABLE_NAME   = 'AppUsersTable';
  process.env.SOS_TABLE_NAME         = 'SOSEventsTable';
  process.env.RECEIVED_SOS_TABLE_NAME = 'ReceivedSOSTable';
  process.env.LIVE_LOCATIONS_TABLE_NAME = 'LiveLocationsTable';
  process.env.DEVICE_TOKENS_TABLE    = 'DeviceTokensTable';
  process.env.TIPS_TABLE_NAME        = 'TipsTable';
  process.env.HEATMAP_REPORTS_TABLE_NAME = 'HeatmapReportsTable';
  process.env.HEATMAP_PUBLIC_DATA_TABLE_NAME = 'HeatmapPublicDataTable';
  process.env.PLATFORM_DOMAIN        = platformDomain;
  process.env.API_KEY                = platformApiKey;
  process.env.VENDOR_ID              = 'e2e-vendor';
  process.env.QUEUE_URL              = 'https://sqs.us-east-1.amazonaws.com/123456789/e2e-queue';
  process.env.PROPAGATION_DELAY_SECONDS = '0';
  process.env.LOCATION_TTL_SECONDS   = '300';
  process.env.FCM_PLATFORM_APP_ARN   = 'arn:aws:sns:us-east-1:123456789:app/GCM/e2e';
  process.env.WEBHOOK_SECRET         = 'e2e-webhook-secret';

  const { handler: authHandler }     = await import('./auth-handler/index');
  const { handler: profileHandler }  = await import('./user-profile-handler/index');
  const { handler: sosHandler }      = await import('./sos-handler/index');
  const { handler: locationHandler } = await import('./live-location-handler/index');
  const { handler: notifHandler }    = await import('./notification-handler/index');
  const { handler: tipsHandler }     = await import('./tips-handler/index');
  const { handler: heatmapHandler }  = await import('./heatmap-handler/index');

  // ---------------------------------------------------------------------------
  // Route table
  // ---------------------------------------------------------------------------

  type HandlerFn = (event: any) => Promise<any>;
  interface Route { handler: HandlerFn; routeKey: string; pathParams?: Record<string, string>; }

  function matchRoute(method: string, path: string, authSub: string | undefined): Route | null {
    let m: RegExpMatchArray | null;

    // Auth routes (public)
    if (method === 'POST' && path === '/auth/sign-up')   return { handler: authHandler, routeKey: 'POST /auth/sign-up' };
    if (method === 'POST' && path === '/auth/confirm')   return { handler: authHandler, routeKey: 'POST /auth/confirm' };
    if (method === 'POST' && path === '/auth/sign-in')   return { handler: authHandler, routeKey: 'POST /auth/sign-in' };
    if (method === 'POST' && path === '/auth/refresh')   return { handler: authHandler, routeKey: 'POST /auth/refresh' };
    if (method === 'POST' && path === '/auth/sign-out')  return { handler: authHandler, routeKey: 'POST /auth/sign-out' };
    if (method === 'POST' && path === '/auth/forgot-password')         return { handler: authHandler, routeKey: 'POST /auth/forgot-password' };
    if (method === 'POST' && path === '/auth/confirm-forgot-password') return { handler: authHandler, routeKey: 'POST /auth/confirm-forgot-password' };

    // Tips (public — no auth required by handler, but handler checks JWT)
    if (method === 'GET' && path === '/tips') return { handler: tipsHandler, routeKey: 'GET /tips' };

    // Protected routes — all require auth
    if (method === 'GET'  && path === '/me')                    return { handler: profileHandler,  routeKey: 'GET /me' };
    if (method === 'POST' && path === '/register')              return { handler: profileHandler,  routeKey: 'POST /register' };
    if (method === 'GET'  && path === '/sharing-code')          return { handler: profileHandler,  routeKey: 'GET /sharing-code' };
    if (method === 'POST' && path === '/sharing-code')          return { handler: profileHandler,  routeKey: 'POST /sharing-code' };
    if (method === 'POST' && path === '/sharing-code/connect')  return { handler: profileHandler,  routeKey: 'POST /sharing-code/connect' };
    if (method === 'POST' && path === '/contacts/connect-back') return { handler: profileHandler,  routeKey: 'POST /contacts/connect-back' };
    if (method === 'GET'  && path === '/contacts')              return { handler: profileHandler,  routeKey: 'GET /contacts' };
    m = path.match(/^\/contacts\/([^/]+)$/);
    if (m && method === 'PATCH')  return { handler: profileHandler, routeKey: 'PATCH /contacts/{contactId}', pathParams: { contactId: m[1] } };
    if (m && method === 'DELETE') return { handler: profileHandler, routeKey: 'DELETE /contacts/{contactId}', pathParams: { contactId: m[1] } };

    if (method === 'POST' && path === '/sos')             return { handler: sosHandler, routeKey: 'POST /sos' };
    m = path.match(/^\/sos\/([^/]+)\/propagate$/);
    if (m && method === 'POST')  return { handler: sosHandler, routeKey: 'POST /sos/{sosId}/propagate', pathParams: { sosId: m[1] } };
    m = path.match(/^\/sos\/([^/]+)$/);
    if (m && method === 'PATCH')  return { handler: sosHandler, routeKey: 'PATCH /sos/{sosId}', pathParams: { sosId: m[1] } };
    if (m && method === 'DELETE') return { handler: sosHandler, routeKey: 'DELETE /sos/{sosId}', pathParams: { sosId: m[1] } };
    if (method === 'GET'  && path === '/sos/received')    return { handler: sosHandler, routeKey: 'GET /sos/received' };
    if (method === 'POST' && path === '/webhook/sos')     return { handler: sosHandler, routeKey: 'POST /webhook/sos' };

    if (method === 'PUT'    && path === '/location')             return { handler: locationHandler, routeKey: 'PUT /location' };
    if (method === 'DELETE' && path === '/location')             return { handler: locationHandler, routeKey: 'DELETE /location' };
    if (method === 'GET'    && path === '/location/contacts')    return { handler: locationHandler, routeKey: 'GET /location/contacts' };
    m = path.match(/^\/location\/contacts\/([^/]+)$/);
    if (m && method === 'GET') return { handler: locationHandler, routeKey: 'GET /location/contacts/{safeWalkId}', pathParams: { safeWalkId: m[1] } };

    if (method === 'POST' && path === '/device/register')     return { handler: notifHandler as HandlerFn, routeKey: 'POST /device/register' };
    if (method === 'POST' && path === '/device/unregister')   return { handler: notifHandler as HandlerFn, routeKey: 'POST /device/unregister' };
    if (method === 'POST' && path === '/notifications/send')  return { handler: notifHandler as HandlerFn, routeKey: 'POST /notifications/send' };

    if (method === 'POST'   && path === '/heatmap/reports')  return { handler: heatmapHandler, routeKey: 'POST /heatmap/reports' };
    if (method === 'GET'    && path === '/heatmap/reports')  return { handler: heatmapHandler, routeKey: 'GET /heatmap/reports' };
    m = path.match(/^\/heatmap\/reports\/([^/]+)$/);
    if (m && method === 'DELETE') return { handler: heatmapHandler, routeKey: 'DELETE /heatmap/reports/{reportId}', pathParams: { reportId: m[1] } };
    if (method === 'GET'    && path.startsWith('/heatmap')) return { handler: heatmapHandler, routeKey: 'GET /heatmap' };

    return null;
  }

  // ---------------------------------------------------------------------------
  // HTTP server
  // ---------------------------------------------------------------------------

  const server = http.createServer(async (req, res) => {
    let rawBody = '';
    req.on('data', c => rawBody += c);
    req.on('end', async () => {
      const method = req.method ?? 'GET';
      const rawUrl = req.url ?? '/';
      const [pathPart, queryPart] = rawUrl.split('?');

      // Control endpoints
      if (method === 'POST' && pathPart === '/__reset') {
        db.reset(); sqsMessages.length = 0; snsPublishes.length = 0;
        cognitoUsers.clear(); platformUsers.clear(); platformContacts.clear(); platformSharingCodes.clear();
        res.writeHead(200); res.end('{}'); return;
      }
      if (method === 'GET' && pathPart === '/__sqs') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(sqsMessages)); return;
      }
      if (method === 'GET' && pathPart === '/__sns') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(snsPublishes)); return;
      }
      if (method === 'GET' && pathPart === '/__platform/users') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([...platformUsers.values()])); return;
      }
      if (method === 'POST' && pathPart === '/__platform/seed-tip') {
        const tip = JSON.parse(rawBody);
        db.put('TipsTable', tip);
        res.writeHead(200); res.end('{}'); return;
      }
      if (method === 'POST' && pathPart === '/__platform/seed-user') {
        // Seed an AppUsers record and a Cognito user for testing without full registration
        const { sub, email, password, displayName, safeWalkId } = JSON.parse(rawBody);
        cognitoUsers.set(email, { username: email, password, displayName, confirmed: true, sub });
        if (safeWalkId) {
          const now = new Date().toISOString();
          db.put('AppUsersTable', { safeWalkAppId: sub, email, displayName: displayName ?? null, safeWalkId, createdAt: now, updatedAt: now });
          platformUsers.set(safeWalkId, { safeWalkId, platformUserId: sub, platformId: 'e2e-vendor', name: displayName });
        }
        res.writeHead(200); res.end('{}'); return;
      }

      const authHeader = req.headers.authorization as string | undefined;
      const sub = extractSubFromToken(authHeader);

      const route = matchRoute(method, pathPart, sub);
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' })); return;
      }

      // Parse query string params
      const queryStringParameters: Record<string, string> = {};
      if (queryPart) {
        for (const [k, v] of new URLSearchParams(queryPart).entries()) {
          queryStringParameters[k] = v;
        }
      }

      // Build AGW v2 event
      const event: any = {
        version: '2.0',
        routeKey: route.routeKey,
        rawPath: pathPart,
        rawQueryString: queryPart ?? '',
        headers: { ...req.headers, authorization: authHeader },
        body: rawBody || undefined,
        pathParameters: route.pathParams && Object.keys(route.pathParams).length > 0 ? route.pathParams : undefined,
        queryStringParameters: Object.keys(queryStringParameters).length > 0 ? queryStringParameters : undefined,
        requestContext: {
          http: { method, path: pathPart, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'e2e' },
          authorizer: sub ? { jwt: { claims: { sub, email: [...cognitoUsers.values()].find(u => u.sub === sub)?.username ?? '' } } } : {},
        },
      };

      // notification-handler uses APIGatewayProxyEventV2WithJWTAuthorizer — patch the shape
      if (route.routeKey.includes('/device/') || route.routeKey.includes('/notifications/')) {
        event.requestContext.authorizer = { jwt: { claims: { sub: sub ?? '' } } };
      }

      try {
        const result = await route.handler(event);
        const status = result?.statusCode ?? 200;
        res.writeHead(status, { 'Content-Type': 'application/json', ...(result?.headers ?? {}) });
        res.end(typeof result?.body === 'string' ? result.body : JSON.stringify(result?.body ?? {}));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'InternalError', message: err.message }));
      }
    });
  });

  server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as any).port;
    (globalThis as any).__E2E_SERVER = server;
    process.stdout.write(`SERVER_READY:${port}\n`);
  });
}

main().catch(err => { console.error('E2E server startup failed:', err); process.exit(1); });
