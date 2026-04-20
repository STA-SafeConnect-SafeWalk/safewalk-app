import { createHmac, timingSafeEqual } from 'crypto';

const TIMESTAMP_TOLERANCE_SECONDS = 300;

export interface WebhookGeoLocation {
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp: string;
}

export interface WebhookTarget {
  safeWalkId: string;
  platformId: string;
  platformUserId: string;
}

export interface SafeWalkWebhookPayload {
  type: 'SOS_CREATED' | 'SOS_LOCATION_UPDATE' | 'SOS_CANCELLED';
  sosId: string;
  timestamp: string;
  victim: {
    safeWalkId: string;
    platformId: string;
    platformUserId: string;
    displayName: string;
  };
  targets: WebhookTarget[];
  geoLocation?: WebhookGeoLocation;
}

export type WebhookVerificationResult =
  | { valid: true; payload: SafeWalkWebhookPayload }
  | { valid: false; error: string };

function verifyTimestamp(timestamp: string): boolean {
  const time = new Date(timestamp).getTime();
  if (isNaN(time)) return false;
  return Math.abs(Date.now() - time) / 1000 <= TIMESTAMP_TOLERANCE_SECONDS;
}

function verifySignature(rawBody: string, signature: string, timestamp: string, secret: string): boolean {
  const equalsIndex = signature.indexOf('=');
  if (equalsIndex === -1) return false;
  const prefix = signature.slice(0, equalsIndex);
  const receivedHex = signature.slice(equalsIndex + 1);
  if (prefix !== 'sha256' || !receivedHex) return false;

  const expectedHex = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  const expected = Buffer.from(expectedHex, 'hex');
  const received = Buffer.from(receivedHex, 'hex');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/**
 * Verifies an incoming SafeConnect SOS webhook request.
 *
 * @param rawBody   The raw (unparsed) request body string. Must not be
 *                  re-serialised — any whitespace change breaks the signature.
 * @param headers   The request headers (case-insensitive lookup is applied).
 * @param webhookSecret  The shared secret associated with this platform,
 *                       obtained from your platform configuration.
 */
export function verifySafeConnectWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  webhookSecret: string,
): WebhookVerificationResult {
  const header = (name: string): string | undefined => {
    const value = headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };

  const signature = header('x-safewalk-signature');
  const timestamp = header('x-safewalk-timestamp');
  const eventType = header('x-safewalk-event');

  if (!signature || !timestamp || !eventType) {
    return { valid: false, error: 'Missing required webhook headers' };
  }

  if (!verifyTimestamp(timestamp)) {
    return { valid: false, error: 'Webhook timestamp outside acceptable window' };
  }

  if (!verifySignature(rawBody, signature, timestamp, webhookSecret)) {
    return { valid: false, error: 'Invalid webhook signature' };
  }

  let payload: SafeWalkWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as SafeWalkWebhookPayload;
  } catch {
    return { valid: false, error: 'Invalid JSON payload' };
  }

  if (!payload.type || !payload.sosId || !payload.timestamp || !payload.victim) {
    return { valid: false, error: 'Malformed webhook payload: missing required fields' };
  }

  if (payload.type !== eventType) {
    return { valid: false, error: 'Webhook event type header does not match payload' };
  }

  return { valid: true, payload };
}
