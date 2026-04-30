import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

/* ---------- Types ---------- */

type ReportType =
  | 'UNLIT_WAY'
  | 'WELL_LIT_WAY'
  | 'UNSAFE_AREA'
  | 'HIGH_FOOT_TRAFFIC'
  | 'LOW_FOOT_TRAFFIC'
  | 'CRIME_INCIDENT';

const REPORT_TYPES: ReadonlySet<ReportType> = new Set<ReportType>([
  'UNLIT_WAY',
  'WELL_LIT_WAY',
  'UNSAFE_AREA',
  'HIGH_FOOT_TRAFFIC',
  'LOW_FOOT_TRAFFIC',
  'CRIME_INCIDENT',
]);

type PoiCategory =
  | 'HOSPITAL'
  | 'POLICE'
  | 'FIRE_STATION'
  | 'PHARMACY'
  | 'CLINIC'
  | 'EMERGENCY_PHONE'
  | 'STREET_LAMP'
  | 'UNLIT_WAY';

interface MapPoi {
  id: string;
  category: PoiCategory;
  lat: number;
  lng: number;
  name?: string;
  tags?: Record<string, string>;
}

interface MapReport {
  reportId: string;
  userId: string;
  type: ReportType;
  lat: number;
  lng: number;
  comment?: string;
  createdAt: string;
  expiresAt: number;
}

/* ---------- AWS clients ---------- */

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/* ---------- Constants / config ---------- */

const MAX_RADIUS_METERS = 5000;
const MIN_RADIUS_METERS = 50;
const REPORT_TTL_DAYS_DEFAULT = 30;
const REPORT_TTL_DAYS_BY_TYPE: Partial<Record<ReportType, number>> = {
  CRIME_INCIDENT: 14,
  HIGH_FOOT_TRAFFIC: 7,
  LOW_FOOT_TRAFFIC: 7,
};
const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24h
const OVERPASS_TIMEOUT_MS = 25_000;
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/* ---------- Helpers ---------- */

const jsonResponse = (
  statusCode: number,
  body: Record<string, unknown>,
): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const getAuthenticatedUserId = (
  event: APIGatewayProxyEventV2,
): string | undefined => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = event.requestContext as any;
  return ctx.authorizer?.jwt?.claims?.sub as string | undefined;
};

const parseFloatOrNull = (value: string | undefined): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const isValidLat = (lat: number): boolean => lat >= -90 && lat <= 90;
const isValidLng = (lng: number): boolean => lng >= -180 && lng <= 180;

/**
 * Approximate haversine distance in meters.
 */
export const haversineMeters = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
};

/**
 * Geohash-prefix-style cache key. We snap to a coarse grid so that nearby
 * requests hit the same cached Overpass response.
 *
 * Grid: 0.02° (~2.2km). We always cache a fixed-size square (radius 5km).
 */
const buildCacheKey = (lat: number, lng: number): string => {
  const cellLat = Math.floor(lat / 0.02) * 0.02;
  const cellLng = Math.floor(lng / 0.02) * 0.02;
  return `osm#${cellLat.toFixed(3)}#${cellLng.toFixed(3)}#r${MAX_RADIUS_METERS}`;
};

const getReportTtlSeconds = (type: ReportType): number => {
  const days = REPORT_TTL_DAYS_BY_TYPE[type] ?? REPORT_TTL_DAYS_DEFAULT;
  return days * 24 * 60 * 60;
};

/* ---------- Geo bucketing for reports ---------- */

/**
 * Coarse bucket (~1.1km lat / ~variable lng) used as the partition key for the
 * reports table. A query covers all buckets that intersect the search circle.
 */
const REPORT_BUCKET_DEG = 0.01;

const bucketKey = (lat: number, lng: number): string => {
  const blat = Math.floor(lat / REPORT_BUCKET_DEG);
  const blng = Math.floor(lng / REPORT_BUCKET_DEG);
  return `${blat}:${blng}`;
};

const bucketsForArea = (
  lat: number,
  lng: number,
  radiusMeters: number,
): string[] => {
  // Convert radius to degrees roughly.
  const dLat = radiusMeters / 111_320;
  const dLng = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180) || 1);

  const minLat = Math.floor((lat - dLat) / REPORT_BUCKET_DEG);
  const maxLat = Math.floor((lat + dLat) / REPORT_BUCKET_DEG);
  const minLng = Math.floor((lng - dLng) / REPORT_BUCKET_DEG);
  const maxLng = Math.floor((lng + dLng) / REPORT_BUCKET_DEG);

  const keys: string[] = [];
  for (let blat = minLat; blat <= maxLat; blat++) {
    for (let blng = minLng; blng <= maxLng; blng++) {
      keys.push(`${blat}:${blng}`);
    }
  }
  return keys;
};

/* ---------- Overpass API ---------- */

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

const buildOverpassQuery = (
  lat: number,
  lng: number,
  radius: number,
): string => {
  // Single union query covering all categories of interest.
  // out center keeps centroids of ways/relations cheap and still accurate enough
  // for map display.
  const around = `(around:${radius},${lat},${lng})`;
  return `
[out:json][timeout:25];
(
  node["amenity"="hospital"]${around};
  way["amenity"="hospital"]${around};
  node["amenity"="clinic"]${around};
  way["amenity"="clinic"]${around};
  node["amenity"="police"]${around};
  way["amenity"="police"]${around};
  node["amenity"="fire_station"]${around};
  way["amenity"="fire_station"]${around};
  node["amenity"="pharmacy"]${around};
  way["amenity"="pharmacy"]${around};
  node["emergency"="phone"]${around};
  node["highway"="street_lamp"]${around};
  way["highway"]["lit"="no"]${around};
);
out center tags;
`.trim();
};

const fetchOverpass = async (
  query: string,
): Promise<OverpassResponse> => {
  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'safewalk-app/1.0 (+https://safewalk.app)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        lastError = new Error(`Overpass ${endpoint} HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as OverpassResponse;
      return json;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('All Overpass endpoints failed');
};

const classifyElement = (el: OverpassElement): PoiCategory | null => {
  const t = el.tags ?? {};
  if (t.amenity === 'hospital') return 'HOSPITAL';
  if (t.amenity === 'clinic') return 'CLINIC';
  if (t.amenity === 'police') return 'POLICE';
  if (t.amenity === 'fire_station') return 'FIRE_STATION';
  if (t.amenity === 'pharmacy') return 'PHARMACY';
  if (t.emergency === 'phone') return 'EMERGENCY_PHONE';
  if (t.highway === 'street_lamp') return 'STREET_LAMP';
  if (t.highway && t.lit === 'no') return 'UNLIT_WAY';
  return null;
};

const overpassToPois = (resp: OverpassResponse): MapPoi[] => {
  const pois: MapPoi[] = [];
  for (const el of resp.elements ?? []) {
    const category = classifyElement(el);
    if (!category) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    pois.push({
      id: `${el.type}/${el.id}`,
      category,
      lat,
      lng: lon,
      name: el.tags?.name,
      tags: el.tags,
    });
  }
  return pois;
};

/* ---------- Cache ---------- */

interface CachedOsm {
  cacheKey: string;
  pois: MapPoi[];
  cachedAt: string;
  expiresAt: number;
}

const getCachedPois = async (
  cacheTable: string,
  cacheKey: string,
): Promise<MapPoi[] | null> => {
  try {
    const res = await docClient.send(
      new GetCommand({
        TableName: cacheTable,
        Key: { cacheKey },
      }),
    );
    if (!res.Item) return null;
    const item = res.Item as CachedOsm;
    if (item.expiresAt && item.expiresAt * 1000 < Date.now()) return null;
    return Array.isArray(item.pois) ? item.pois : null;
  } catch (err) {
    console.warn('Cache lookup failed', err);
    return null;
  }
};

const writeCachedPois = async (
  cacheTable: string,
  cacheKey: string,
  pois: MapPoi[],
): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);
  try {
    await docClient.send(
      new PutCommand({
        TableName: cacheTable,
        Item: {
          cacheKey,
          pois,
          cachedAt: new Date().toISOString(),
          expiresAt: now + CACHE_TTL_SECONDS,
        },
      }),
    );
  } catch (err) {
    console.warn('Cache write failed', err);
  }
};

/* ---------- Reports persistence ---------- */

const loadReportsForArea = async (
  reportsTable: string,
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<MapReport[]> => {
  const buckets = bucketsForArea(lat, lng, radiusMeters);
  const nowSec = Math.floor(Date.now() / 1000);
  const results: MapReport[] = [];

  // Query each bucket. Buckets are coarse (~1.1km), so even a 5km radius
  // touches at most ~80 buckets. Run in parallel for speed.
  await Promise.all(
    buckets.map(async (bucket) => {
      const res = await docClient.send(
        new QueryCommand({
          TableName: reportsTable,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': 'bucket' },
          ExpressionAttributeValues: { ':pk': bucket },
        }),
      );
      for (const raw of res.Items ?? []) {
        const report = raw as MapReport;
        if (
          typeof report.lat !== 'number' ||
          typeof report.lng !== 'number' ||
          typeof report.expiresAt !== 'number'
        ) {
          continue;
        }
        if (report.expiresAt <= nowSec) continue; // TTL grace
        if (haversineMeters(lat, lng, report.lat, report.lng) <= radiusMeters) {
          results.push(report);
        }
      }
    }),
  );
  return results;
};

/* ---------- Route handlers ---------- */

const handleGetMapData = async (
  event: APIGatewayProxyEventV2,
  reportsTable: string,
  cacheTable: string,
): Promise<APIGatewayProxyResultV2> => {
  const qs = event.queryStringParameters ?? {};
  const lat = parseFloatOrNull(qs.lat);
  const lng = parseFloatOrNull(qs.lng);
  const radius = parseFloatOrNull(qs.radius);

  if (lat === null || lng === null || radius === null) {
    return jsonResponse(400, {
      success: false,
      message: 'lat, lng and radius query parameters are required',
    });
  }
  if (!isValidLat(lat) || !isValidLng(lng)) {
    return jsonResponse(400, {
      success: false,
      message: 'lat/lng out of range',
    });
  }
  if (radius < MIN_RADIUS_METERS || radius > MAX_RADIUS_METERS) {
    return jsonResponse(400, {
      success: false,
      message: `radius must be between ${MIN_RADIUS_METERS} and ${MAX_RADIUS_METERS} meters`,
    });
  }

  // POIs come from cache when fresh; otherwise we hit Overpass and refresh.
  const cacheKey = buildCacheKey(lat, lng);
  let pois = await getCachedPois(cacheTable, cacheKey);
  let cacheStatus: 'HIT' | 'MISS' | 'BYPASS' = 'HIT';

  if (!pois) {
    cacheStatus = 'MISS';
    try {
      const query = buildOverpassQuery(lat, lng, MAX_RADIUS_METERS);
      const overpass = await fetchOverpass(query);
      pois = overpassToPois(overpass);
      // Write-through cache. Failures are non-fatal.
      await writeCachedPois(cacheTable, cacheKey, pois);
    } catch (err) {
      console.error('Overpass fetch failed', err);
      // Last-resort: serve stale or empty results so the user still gets a map.
      cacheStatus = 'BYPASS';
      pois = [];
    }
  }

  const filteredPois = pois.filter(
    (p) => haversineMeters(lat, lng, p.lat, p.lng) <= radius,
  );

  let reports: MapReport[] = [];
  try {
    reports = await loadReportsForArea(reportsTable, lat, lng, radius);
  } catch (err) {
    console.error('Failed to load user reports', err);
  }

  return jsonResponse(200, {
    success: true,
    data: {
      query: { lat, lng, radius },
      cache: cacheStatus,
      pois: filteredPois,
      reports: reports.map((r) => ({
        reportId: r.reportId,
        type: r.type,
        lat: r.lat,
        lng: r.lng,
        comment: r.comment,
        createdAt: r.createdAt,
      })),
    },
  });
};

const handleCreateReport = async (
  event: APIGatewayProxyEventV2,
  userId: string,
  reportsTable: string,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return jsonResponse(400, { success: false, message: 'Request body required' });
  }
  let parsed: Partial<MapReport> & { type?: string };
  try {
    parsed = JSON.parse(event.body);
  } catch {
    return jsonResponse(400, { success: false, message: 'Invalid JSON body' });
  }

  const lat = typeof parsed.lat === 'number' ? parsed.lat : null;
  const lng = typeof parsed.lng === 'number' ? parsed.lng : null;
  const type = typeof parsed.type === 'string' ? parsed.type : '';
  const comment =
    typeof parsed.comment === 'string' && parsed.comment.trim().length > 0
      ? parsed.comment.trim().slice(0, 500)
      : undefined;

  if (lat === null || lng === null || !isValidLat(lat) || !isValidLng(lng)) {
    return jsonResponse(400, { success: false, message: 'Valid lat/lng required' });
  }
  if (!REPORT_TYPES.has(type as ReportType)) {
    return jsonResponse(400, {
      success: false,
      message: `type must be one of: ${[...REPORT_TYPES].join(', ')}`,
    });
  }

  const reportType = type as ReportType;
  const reportId = randomUUID();
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + getReportTtlSeconds(reportType);

  const item = {
    bucket: bucketKey(lat, lng),
    reportId,
    userId,
    type: reportType,
    lat,
    lng,
    comment,
    createdAt: new Date(nowSec * 1000).toISOString(),
    expiresAt,
  };

  await docClient.send(
    new PutCommand({
      TableName: reportsTable,
      Item: item,
    }),
  );

  return jsonResponse(201, {
    success: true,
    data: {
      reportId,
      type: reportType,
      lat,
      lng,
      comment,
      createdAt: item.createdAt,
      expiresAt,
    },
  });
};

const handleDeleteReport = async (
  event: APIGatewayProxyEventV2,
  userId: string,
  reportsTable: string,
): Promise<APIGatewayProxyResultV2> => {
  const reportId = event.pathParameters?.reportId;
  const lat = parseFloatOrNull(event.queryStringParameters?.lat);
  const lng = parseFloatOrNull(event.queryStringParameters?.lng);
  if (!reportId) {
    return jsonResponse(400, { success: false, message: 'reportId is required' });
  }
  if (lat === null || lng === null) {
    return jsonResponse(400, {
      success: false,
      message: 'lat and lng query parameters required to locate the report',
    });
  }
  const bucket = bucketKey(lat, lng);

  const existing = await docClient.send(
    new GetCommand({
      TableName: reportsTable,
      Key: { bucket, reportId },
    }),
  );
  if (!existing.Item) {
    return jsonResponse(404, { success: false, message: 'Report not found' });
  }
  if ((existing.Item as MapReport).userId !== userId) {
    return jsonResponse(403, { success: false, message: 'Forbidden' });
  }

  await docClient.send(
    new DeleteCommand({
      TableName: reportsTable,
      Key: { bucket, reportId },
    }),
  );
  return jsonResponse(204, {});
};

/* ---------- Lambda entry point ---------- */

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const reportsTable = process.env.MAP_REPORTS_TABLE_NAME;
  const cacheTable = process.env.MAP_CACHE_TABLE_NAME;
  if (!reportsTable || !cacheTable) {
    return jsonResponse(500, {
      success: false,
      message:
        'Server configuration error: MAP_REPORTS_TABLE_NAME / MAP_CACHE_TABLE_NAME not set',
    });
  }

  const route = event.routeKey;

  if (route === 'GET /map-data') {
    const userId = getAuthenticatedUserId(event);
    if (!userId) {
      return jsonResponse(401, { success: false, message: 'Unauthorized' });
    }
    return handleGetMapData(event, reportsTable, cacheTable);
  }

  if (route === 'POST /map-data/reports') {
    const userId = getAuthenticatedUserId(event);
    if (!userId) {
      return jsonResponse(401, { success: false, message: 'Unauthorized' });
    }
    return handleCreateReport(event, userId, reportsTable);
  }

  if (route === 'DELETE /map-data/reports/{reportId}') {
    const userId = getAuthenticatedUserId(event);
    if (!userId) {
      return jsonResponse(401, { success: false, message: 'Unauthorized' });
    }
    return handleDeleteReport(event, userId, reportsTable);
  }

  return jsonResponse(404, { success: false, message: 'Route not found' });
};
