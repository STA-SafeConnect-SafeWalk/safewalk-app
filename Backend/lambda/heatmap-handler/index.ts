import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import * as https from 'https';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const REPORT_TTL_DAYS = 90;
const PUBLIC_DATA_TTL_HOURS = 24;
const MAX_REPORTS_PER_DAY = 50;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_RADIUS_KM = 10;
const DEFAULT_RADIUS_KM = 2;
const OVERPASS_MIRRORS = [
  { hostname: 'overpass-api.de', path: '/api/interpreter' },
  { hostname: 'lz4.overpass-api.de', path: '/api/interpreter' },
];

const REPORT_CATEGORIES = [
  'UNSAFE_AREA',
  'WELL_LIT',
  'POORLY_LIT',
  'HIGH_FOOT_TRAFFIC',
  'LOW_FOOT_TRAFFIC',
  'CRIME_INCIDENT',
] as const;

type ReportCategory = (typeof REPORT_CATEGORIES)[number];

// Positive = safer, negative = more dangerous
const REPORT_CATEGORY_WEIGHTS: Record<ReportCategory, number> = {
  WELL_LIT: 1,
  HIGH_FOOT_TRAFFIC: 1,
  POORLY_LIT: -1,
  LOW_FOOT_TRAFFIC: -1,
  UNSAFE_AREA: -2,
  CRIME_INCIDENT: -3,
};

const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  WELL_LIT: 'Gut beleuchtet',
  HIGH_FOOT_TRAFFIC: 'Hohe Personenfrequenz',
  POORLY_LIT: 'Schlecht beleuchtet',
  LOW_FOOT_TRAFFIC: 'Geringe Personenfrequenz',
  UNSAFE_AREA: 'Unsicherer Bereich',
  CRIME_INCIDENT: 'Kriminalitätsvorfall',
};

type PublicDataType =
  | 'STREET_LAMP'
  | 'LIT_WAY'
  | 'UNLIT_WAY'
  | 'POLICE_STATION'
  | 'HOSPITAL'
  | 'EMERGENCY_PHONE';

const PUBLIC_DATA_WEIGHTS: Record<PublicDataType, number> = {
  STREET_LAMP: 0.5,
  LIT_WAY: 0.3,
  UNLIT_WAY: -0.5,
  POLICE_STATION: 1,
  HOSPITAL: 0.5,
  EMERGENCY_PHONE: 0.5,
};

const PUBLIC_DATA_LABELS: Record<PublicDataType, string> = {
  STREET_LAMP: 'Strassenlaternen',
  LIT_WAY: 'Beleuchtete Wege',
  UNLIT_WAY: 'Unbeleuchtete Wege',
  POLICE_STATION: 'Polizeistationen',
  HOSPITAL: 'Krankenhäuser',
  EMERGENCY_PHONE: 'Notruftelefone',
};

const PUBLIC_DATA_ICON_KEYS: Record<PublicDataType, string> = {
  STREET_LAMP: 'street_lamp',
  LIT_WAY: 'lit_way',
  UNLIT_WAY: 'unlit_way',
  POLICE_STATION: 'police_station',
  HOSPITAL: 'hospital',
  EMERGENCY_PHONE: 'emergency_phone',
};

interface SubmitReportRequest {
  lat: number;
  lng: number;
  category: string;
  description?: string;
}

interface HeatmapCell {
  geohash: string;
  centerLat: number;
  centerLng: number;
  safetyScore: number | null;
  reportCounts: Partial<Record<ReportCategory, number>>;
  publicDataCounts: Partial<Record<PublicDataType, number>>;
  totalDataPoints: number;
}

interface PublicDataFetchResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: Record<string, any>[];
  osmStatus: 'success' | 'cached' | 'error';
  osmError?: string;
  osmPointsFetched: number;
}

const getEnv = (name: string): string | undefined => process.env[name];

const jsonResponse = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const missingEnvResponse = (name: string): APIGatewayProxyResultV2 => ({
  statusCode: 500,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ error: `Server configuration error: ${name} not set` }),
});

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

function isValidCategory(category: string): category is ReportCategory {
  return (REPORT_CATEGORIES as readonly string[]).includes(category);
}

function sanitizeDescription(desc: string): string {
  return desc.replace(/<[^>]*>/g, '').trim().substring(0, MAX_DESCRIPTION_LENGTH);
}

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function encodeGeohash(lat: number, lng: number, precision: number): string {
  let minLat = -90, maxLat = 90;
  let minLng = -180, maxLng = 180;
  let hash = '';
  let isLng = true;
  let bit = 0;
  let ch = 0;

  while (hash.length < precision) {
    if (isLng) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch |= 1 << (4 - bit);
        minLng = mid;
      } else {
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch |= 1 << (4 - bit);
        minLat = mid;
      } else {
        maxLat = mid;
      }
    }
    isLng = !isLng;
    bit++;
    if (bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

function decodeGeohash(hash: string): { lat: number; lng: number } {
  let minLat = -90, maxLat = 90;
  let minLng = -180, maxLng = 180;
  let isLng = true;

  for (const c of hash) {
    const idx = BASE32.indexOf(c);
    for (let bit = 4; bit >= 0; bit--) {
      if (isLng) {
        const mid = (minLng + maxLng) / 2;
        if (idx & (1 << bit)) {
          minLng = mid;
        } else {
          maxLng = mid;
        }
      } else {
        const mid = (minLat + maxLat) / 2;
        if (idx & (1 << bit)) {
          minLat = mid;
        } else {
          maxLat = mid;
        }
      }
      isLng = !isLng;
    }
  }
  return {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
  };
}

function geohashesInBoundingBox(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  precision: number,
): string[] {
  const hashes = new Set<string>();
  // Compute the approximate step size for the given precision
  const latStep = 180 / Math.pow(2, Math.ceil((precision * 5) / 2));
  const lngStep = 360 / Math.pow(2, Math.floor((precision * 5) / 2));

  for (let lat = minLat; lat <= maxLat; lat += latStep * 0.5) {
    for (let lng = minLng; lng <= maxLng; lng += lngStep * 0.5) {
      hashes.add(encodeGeohash(lat, lng, precision));
    }
  }
  hashes.add(encodeGeohash(minLat, minLng, precision));
  hashes.add(encodeGeohash(minLat, maxLng, precision));
  hashes.add(encodeGeohash(maxLat, minLng, precision));
  hashes.add(encodeGeohash(maxLat, maxLng, precision));

  return Array.from(hashes);
}

function boundingBoxFromCenter(
  lat: number,
  lng: number,
  radiusKm: number,
): { minLat: number; minLng: number; maxLat: number; maxLng: number } {
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - latDelta,
    minLng: lng - lngDelta,
    maxLat: lat + latDelta,
    maxLng: lng + lngDelta,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler = async (event: any): Promise<APIGatewayProxyResultV2> => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  return handleAPIGatewayEvent(event as APIGatewayProxyEventV2);
};

async function handleAPIGatewayEvent(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  if (event.routeKey === 'GET /heatmap/metadata') {
    return handleHeatmapMetadata(event);
  }

  const reportsTableName = getEnv('HEATMAP_REPORTS_TABLE_NAME');
  if (!reportsTableName) return missingEnvResponse('HEATMAP_REPORTS_TABLE_NAME');

  const publicDataTableName = getEnv('HEATMAP_PUBLIC_DATA_TABLE_NAME');
  if (!publicDataTableName) return missingEnvResponse('HEATMAP_PUBLIC_DATA_TABLE_NAME');

  switch (event.routeKey) {
    case 'POST /heatmap/reports':
      return handleSubmitReport(event, reportsTableName);
    case 'GET /heatmap/reports':
      return handleListOwnReports(event, reportsTableName);
    case 'DELETE /heatmap/reports/{reportId}':
      return handleDeleteReport(event, reportsTableName);
    case 'GET /heatmap':
      return handleQueryHeatmap(event, reportsTableName, publicDataTableName);
    default:
      return jsonResponse(404, { error: 'Route not found' });
  }
}

async function handleHeatmapMetadata(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  const publicDataLayers = (Object.keys(PUBLIC_DATA_WEIGHTS) as PublicDataType[]).map((key) => ({
    key,
    label: PUBLIC_DATA_LABELS[key],
    weight: PUBLIC_DATA_WEIGHTS[key],
    iconKey: PUBLIC_DATA_ICON_KEYS[key],
  }));

  const reportCategories = REPORT_CATEGORIES.map((key) => ({
    key,
    label: REPORT_CATEGORY_LABELS[key],
    weight: REPORT_CATEGORY_WEIGHTS[key],
  }));

  return jsonResponse(200, {
    success: true,
    data: {
      publicDataLayers,
      reportCategories,
      defaults: {
        radiusKm: DEFAULT_RADIUS_KM,
        maxRadiusKm: MAX_RADIUS_KM,
        maxReportsPerDay: MAX_REPORTS_PER_DAY,
        maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
        reportTtlDays: REPORT_TTL_DAYS,
        publicDataTtlHours: PUBLIC_DATA_TTL_HOURS,
      },
    },
  });
}

// /post/heatmap/reports — Submit a new report
async function handleSubmitReport(
  event: APIGatewayProxyEventV2,
  reportsTableName: string,
): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  let requestBody: SubmitReportRequest;
  try {
    if (!event.body) return jsonResponse(400, { error: 'Request body is required' });
    requestBody = JSON.parse(event.body) as SubmitReportRequest;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON in request body' });
  }

  // Validate coordinates
  if (
    typeof requestBody.lat !== 'number' ||
    typeof requestBody.lng !== 'number' ||
    requestBody.lat < -90 ||
    requestBody.lat > 90 ||
    requestBody.lng < -180 ||
    requestBody.lng > 180
  ) {
    return jsonResponse(400, {
      error: 'Valid lat (-90..90) and lng (-180..180) are required',
    });
  }

  // Validate category
  if (!requestBody.category || !isValidCategory(requestBody.category)) {
    return jsonResponse(400, {
      error: `Invalid category. Must be one of: ${REPORT_CATEGORIES.join(', ')}`,
    });
  }

  // Validate description
  if (requestBody.description !== undefined) {
    if (typeof requestBody.description !== 'string') {
      return jsonResponse(400, { error: 'Description must be a string' });
    }
    if (requestBody.description.length > MAX_DESCRIPTION_LENGTH) {
      return jsonResponse(400, {
        error: `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
      });
    }
  }

  // Rate limit: max 50 reports per day per user
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: reportsTableName,
        IndexName: 'UserReportsIndex',
        KeyConditionExpression: 'userId = :userId AND createdAt >= :todayStart',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':todayStart': todayStart.toISOString(),
        },
        Select: 'COUNT',
      }),
    );
    if ((result.Count ?? 0) >= MAX_REPORTS_PER_DAY) {
      return jsonResponse(429, {
        error: `Rate limit exceeded: maximum ${MAX_REPORTS_PER_DAY} reports per day`,
      });
    }
  } catch (error) {
    console.error('Error checking rate limit:', error);
    return jsonResponse(500, { error: 'Failed to check rate limit' });
  }

  const reportId = randomUUID();
  const geohash5 = encodeGeohash(requestBody.lat, requestBody.lng, 5);
  const geohash7 = encodeGeohash(requestBody.lat, requestBody.lng, 7);
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + REPORT_TTL_DAYS * 24 * 60 * 60;
  const description =
    requestBody.description !== undefined
      ? sanitizeDescription(requestBody.description)
      : undefined;

  try {
    await docClient.send(
      new PutCommand({
        TableName: reportsTableName,
        Item: {
          geohash5,
          sk: `report#${geohash7}#${reportId}`,
          reportId,
          userId,
          geohash7,
          lat: requestBody.lat,
          lng: requestBody.lng,
          category: requestBody.category,
          ...(description !== undefined && { description }),
          createdAt: now,
          updatedAt: now,
          ttl,
        },
      }),
    );
  } catch (error) {
    console.error('Error creating report:', error);
    return jsonResponse(500, { error: 'Failed to create report' });
  }

  console.log(`Report ${reportId} created by user ${userId} at ${geohash7}`);
  return jsonResponse(201, {
    success: true,
    data: {
      reportId,
      category: requestBody.category,
      lat: requestBody.lat,
      lng: requestBody.lng,
      ...(description !== undefined && { description }),
      createdAt: now,
    },
  });
}

// /heatmap/reports — List own reports
async function handleListOwnReports(
  event: APIGatewayProxyEventV2,
  reportsTableName: string,
): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: reportsTableName,
        IndexName: 'UserReportsIndex',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ScanIndexForward: false, // newest first
      }),
    );

    const reports = (result.Items ?? []).map((item) => ({
      reportId: item.reportId,
      category: item.category,
      lat: item.lat,
      lng: item.lng,
      description: item.description,
      geohash5: item.geohash5,
      createdAt: item.createdAt,
    }));

    return jsonResponse(200, { success: true, data: { reports } });
  } catch (error) {
    console.error('Error listing reports:', error);
    return jsonResponse(500, { error: 'Failed to list reports' });
  }
}

// /heatmap/reports/{reportId} — Delete own report

async function handleDeleteReport(
  event: APIGatewayProxyEventV2,
  reportsTableName: string,
): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  const reportId = event.pathParameters?.reportId;
  if (!reportId) return jsonResponse(400, { error: 'reportId path parameter is required' });

  // Look up report via ReportIdIndex
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: reportsTableName,
        IndexName: 'ReportIdIndex',
        KeyConditionExpression: 'reportId = :reportId',
        ExpressionAttributeValues: { ':reportId': reportId },
      }),
    );

    if (!result.Items || result.Items.length === 0) {
      return jsonResponse(404, { error: 'Report not found' });
    }

    const report = result.Items[0];
    if (report.userId !== userId) {
      return jsonResponse(403, { error: 'Not authorized to delete this report' });
    }

    await docClient.send(
      new DeleteCommand({
        TableName: reportsTableName,
        Key: { geohash5: report.geohash5, sk: report.sk },
      }),
    );

    console.log(`Report ${reportId} deleted by user ${userId}`);
    return jsonResponse(200, { success: true, data: { reportId, deleted: true } });
  } catch (error) {
    console.error('Error deleting report:', error);
    return jsonResponse(500, { error: 'Failed to delete report' });
  }
}

// /heatmap — Query heatmap data for an area

async function handleQueryHeatmap(
  event: APIGatewayProxyEventV2,
  reportsTableName: string,
  publicDataTableName: string,
): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) return UNAUTHORIZED_RESPONSE;

  const latStr = event.queryStringParameters?.lat;
  const lngStr = event.queryStringParameters?.lng;
  const radiusStr = event.queryStringParameters?.radiusKm;

  if (!latStr || !lngStr) {
    return jsonResponse(400, { error: 'lat and lng query parameters are required' });
  }

  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);

  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return jsonResponse(400, {
      error: 'Valid lat (-90..90) and lng (-180..180) are required',
    });
  }

  let radiusKm = DEFAULT_RADIUS_KM;
  if (radiusStr) {
    radiusKm = parseFloat(radiusStr);
    if (isNaN(radiusKm) || radiusKm <= 0 || radiusKm > MAX_RADIUS_KM) {
      return jsonResponse(400, {
        error: `radiusKm must be between 0 and ${MAX_RADIUS_KM}`,
      });
    }
  }

  const bbox = boundingBoxFromCenter(lat, lng, radiusKm);

  // Get unique geohash5 cells covering the bbox
  const geohash5Cells = geohashesInBoundingBox(bbox.minLat, bbox.minLng, bbox.maxLat, bbox.maxLng, 5);

  // Query user reports and public data in parallel for each geohash5 cell
  const [reportsByCell, publicDataResult] = await Promise.all([
    fetchAllReports(reportsTableName, geohash5Cells),
    fetchAllPublicData(publicDataTableName, geohash5Cells, bbox),
  ]);

  // Aggregate by geohash7 cell
  const cellMap = new Map<string, {
    reportCounts: Record<string, number>;
    publicDataCounts: Record<string, number>;
  }>();

  // Process user reports
  for (const report of reportsByCell) {
    const gh7 = report.geohash7 as string;
    if (!cellMap.has(gh7)) {
      cellMap.set(gh7, { reportCounts: {}, publicDataCounts: {} });
    }
    const cell = cellMap.get(gh7)!;
    const category = report.category as string;
    cell.reportCounts[category] = (cell.reportCounts[category] ?? 0) + 1;
  }

  // Process public data
  for (const item of publicDataResult.items) {
    const gh7 = item.geohash7 as string;
    if (!cellMap.has(gh7)) {
      cellMap.set(gh7, { reportCounts: {}, publicDataCounts: {} });
    }
    const cell = cellMap.get(gh7)!;
    const dataType = item.dataType as string;
    cell.publicDataCounts[dataType] = (cell.publicDataCounts[dataType] ?? 0) + 1;
  }

  // Compute safety scores
  const cells: HeatmapCell[] = [];
  for (const [geohash, data] of cellMap.entries()) {
    const center = decodeGeohash(geohash);

    // Filter to actual bounding box
    if (
      center.lat < bbox.minLat ||
      center.lat > bbox.maxLat ||
      center.lng < bbox.minLng ||
      center.lng > bbox.maxLng
    ) {
      continue;
    }

    const safetyScore = computeSafetyScore(
      data.reportCounts as Partial<Record<ReportCategory, number>>,
      data.publicDataCounts as Partial<Record<PublicDataType, number>>,
    );

    const totalDataPoints =
      Object.values(data.reportCounts).reduce((a, b) => a + b, 0) +
      Object.values(data.publicDataCounts).reduce((a, b) => a + b, 0);

    cells.push({
      geohash,
      centerLat: center.lat,
      centerLng: center.lng,
      safetyScore,
      reportCounts: data.reportCounts as Partial<Record<ReportCategory, number>>,
      publicDataCounts: data.publicDataCounts as Partial<Record<PublicDataType, number>>,
      totalDataPoints,
    });
  }

  const reports = reportsByCell
    .filter((item) => {
      const rLat = item.lat as number;
      const rLng = item.lng as number;
      return rLat >= bbox.minLat && rLat <= bbox.maxLat && rLng >= bbox.minLng && rLng <= bbox.maxLng;
    })
    .map((item) => ({
      reportId: item.reportId,
      category: item.category,
      lat: item.lat,
      lng: item.lng,
      description: item.description ?? null,
      createdAt: item.createdAt,
    }));

  return jsonResponse(200, {
    success: true,
    data: {
      cells,
      reports,
      boundingBox: bbox,
      radiusKm,
      geohash5CellsQueried: geohash5Cells.length,
      userReportsFound: reportsByCell.length,
      publicData: {
        status: publicDataResult.osmStatus,
        pointsFetched: publicDataResult.osmPointsFetched,
        cachedItemsFound: publicDataResult.items.length,
        ...(publicDataResult.osmError && { error: publicDataResult.osmError }),
      },
      queriedAt: new Date().toISOString(),
    },
  });
}

// ---------------------------------------------------------------------------
// Data Fetching
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllReports(tableName: string, geohash5Cells: string[]): Promise<any[]> {
  const results = await Promise.allSettled(
    geohash5Cells.map((gh5) =>
      docClient.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'geohash5 = :gh5 AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: {
            ':gh5': gh5,
            ':prefix': 'report#',
          },
        }),
      ),
    ),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allItems: any[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allItems.push(...(result.value.Items ?? []));
    } else {
      console.error('Error fetching reports:', result.reason);
    }
  }
  return allItems;
}

async function fetchAllPublicData(
  tableName: string,
  geohash5Cells: string[],
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number },
): Promise<PublicDataFetchResult> {
  const freshCells: string[] = [];
  const staleCells: string[] = [];

  await Promise.allSettled(
    geohash5Cells.map(async (gh5) => {
      try {
        const metaResult = await docClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'geohash5 = :gh5 AND sk = :meta',
            ExpressionAttributeValues: {
              ':gh5': gh5,
              ':meta': '_meta#osm',
            },
          }),
        );

        const meta = metaResult.Items?.[0];
        if (meta?.lastFetched) {
          const lastFetched = new Date(meta.lastFetched as string).getTime();
          const ageHours = (Date.now() - lastFetched) / (1000 * 60 * 60);
          if (ageHours < PUBLIC_DATA_TTL_HOURS) {
            freshCells.push(gh5);
            return;
          }
        }
        staleCells.push(gh5);
      } catch {
        staleCells.push(gh5);
      }
    }),
  );

  let osmStatus: 'success' | 'cached' | 'error' = staleCells.length === 0 ? 'cached' : 'error';
  let osmError: string | undefined;
  let osmPointsFetched = 0;

  if (staleCells.length > 0) {
    try {
      const osmData = await fetchOSMDataWithRetry(bbox);
      osmPointsFetched = osmData.length;
      await cacheOSMData(tableName, osmData, staleCells);
      osmStatus = 'success';
      console.log(`OSM fetch successful: ${osmData.length} points for ${staleCells.length} stale cells`);
    } catch (error) {
      osmError = error instanceof Error ? error.message : String(error);
      console.error('Error fetching OSM data after retries:', osmError);
    }
  }

  // Read all cached data for all cells
  const results = await Promise.allSettled(
    geohash5Cells.map((gh5) =>
      docClient.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'geohash5 = :gh5 AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: {
            ':gh5': gh5,
            ':prefix': 'source#',
          },
        }),
      ),
    ),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allItems: any[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allItems.push(...(result.value.Items ?? []));
    }
  }
  return { items: allItems, osmStatus, osmError, osmPointsFetched };
}

// ---------------------------------------------------------------------------
// OpenStreetMap Overpass API Integration
// ---------------------------------------------------------------------------

interface OSMDataPoint {
  type: PublicDataType;
  lat: number;
  lng: number;
  osmId: string;
}

async function fetchOSMData(bbox: {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}): Promise<OSMDataPoint[]> {
  const bboxStr = `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}`;

  // Split into separate lightweight queries to avoid timeouts in dense areas
  const queries = [
    `[out:json][timeout:25];node["highway"="street_lamp"](${bboxStr});out;`,
    `[out:json][timeout:25];(way["lit"="yes"](${bboxStr});way["lit"="no"](${bboxStr}););out center;`,
    `[out:json][timeout:25];(node["amenity"="police"](${bboxStr});node["amenity"="hospital"](${bboxStr});node["emergency"="phone"](${bboxStr}););out;`,
  ];

  const results = await Promise.allSettled(
    queries.map((q) => overpassRequest(q)),
  );

  const dataPoints: OSMDataPoint[] = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') {
      console.warn('Overpass sub-query failed:', result.reason);
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any;
    try {
      parsed = JSON.parse(result.value);
    } catch {
      console.error('Failed to parse Overpass response');
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const element of parsed.elements ?? []) {
      const lat = element.lat ?? element.center?.lat;
      const lng = element.lon ?? element.center?.lon;
      if (lat === undefined || lng === undefined) continue;

      const osmId = `${element.type}${element.id}`;
      const type = classifyOSMElement(element);
      if (type) {
        dataPoints.push({ type, lat, lng, osmId });
      }
    }
  }

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  if (succeeded === 0) {
    throw new Error('All Overpass sub-queries failed');
  }

  console.log(`Fetched ${dataPoints.length} OSM data points (${succeeded}/${queries.length} queries succeeded) for bbox ${bboxStr}`);
  return dataPoints;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyOSMElement(element: any): PublicDataType | null {
  const tags = element.tags ?? {};

  if (tags.highway === 'street_lamp') return 'STREET_LAMP';
  if (tags.amenity === 'police') return 'POLICE_STATION';
  if (tags.amenity === 'hospital') return 'HOSPITAL';
  if (tags.emergency === 'phone') return 'EMERGENCY_PHONE';
  if (tags.lit === 'yes') return 'LIT_WAY';
  if (tags.lit === 'no') return 'UNLIT_WAY';

  return null;
}

const MAX_OVERPASS_RETRIES = 3;
const RETRY_DELAY_MS = [500, 1500, 3000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOSMDataWithRetry(
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number },
): Promise<OSMDataPoint[]> {
  let lastError: Error | undefined;
  for (const mirror of OVERPASS_MIRRORS) {
    currentMirror = mirror;
    for (let attempt = 0; attempt < MAX_OVERPASS_RETRIES; attempt++) {
      try {
        console.log(`Trying Overpass mirror: ${mirror.hostname} (attempt ${attempt + 1}/${MAX_OVERPASS_RETRIES})`);
        return await fetchOSMData(bbox);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`Mirror ${mirror.hostname} attempt ${attempt + 1} failed: ${lastError.message}`);
        if (attempt < MAX_OVERPASS_RETRIES - 1) {
          await sleep(RETRY_DELAY_MS[attempt]);
        }
      }
    }
  }
  throw lastError;
}

let currentMirror = OVERPASS_MIRRORS[0];

function overpassRequest(query: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const postData = `data=${encodeURIComponent(query)}`;
    const mirror = currentMirror;

    const options: https.RequestOptions = {
      hostname: mirror.hostname,
      port: 443,
      path: mirror.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'SafeWalk/1.0',
      },
    };

    console.log(`Sending Overpass request to ${mirror.hostname}`);

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      res.on('end', () => {
        console.log(`Overpass ${mirror.hostname} response status:`, res.statusCode);
        if (res.statusCode === 429 || res.statusCode === 504) {
          reject(new Error(`Overpass API rate limited or timed out (${res.statusCode})`));
        } else if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(responseData);
        } else {
          reject(new Error(`Overpass API returned status ${res.statusCode}: ${responseData.substring(0, 500)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Overpass API request timed out (${mirror.hostname})`));
    });
    req.setTimeout(25000);
    req.write(postData);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Public Data Caching
// ---------------------------------------------------------------------------

async function cacheOSMData(
  tableName: string,
  dataPoints: OSMDataPoint[],
  geohash5Cells: string[],
): Promise<void> {
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + PUBLIC_DATA_TTL_HOURS * 60 * 60;

  // Group data points by geohash5
  const grouped = new Map<string, OSMDataPoint[]>();
  for (const point of dataPoints) {
    const gh5 = encodeGeohash(point.lat, point.lng, 5);
    if (!geohash5Cells.includes(gh5)) continue;
    if (!grouped.has(gh5)) grouped.set(gh5, []);
    grouped.get(gh5)!.push(point);
  }

  // Write data points and cache metadata in batches of 25 (DynamoDB limit)
  for (const gh5 of geohash5Cells) {
    const points = grouped.get(gh5) ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: Array<{ PutRequest: { Item: Record<string, any> } }> = points.map((p) => ({
      PutRequest: {
        Item: {
          geohash5: gh5,
          sk: `source#${p.type}#${p.osmId}`,
          dataType: p.type,
          lat: p.lat,
          lng: p.lng,
          osmId: p.osmId,
          geohash7: encodeGeohash(p.lat, p.lng, 7),
          cachedAt: now,
          ttl,
        },
      },
    }));

    // Add cache metadata item
    items.push({
      PutRequest: {
        Item: {
          geohash5: gh5,
          sk: '_meta#osm',
          lastFetched: now,
          pointCount: points.length,
          ttl: ttl + 3600, // metadata lives slightly longer than data
        },
      },
    });

    // BatchWrite in chunks of 25
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      try {
        await docClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [tableName]: batch,
            },
          }),
        );
      } catch (error) {
        console.error(`Error caching OSM data for ${gh5}:`, error);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Safety Score Computation
// ---------------------------------------------------------------------------

function computeSafetyScore(
  reportCounts: Partial<Record<ReportCategory, number>>,
  publicDataCounts: Partial<Record<PublicDataType, number>>,
): number | null {
  let weightedSum = 0;
  let totalItems = 0;

  for (const [category, count] of Object.entries(reportCounts)) {
    const weight = REPORT_CATEGORY_WEIGHTS[category as ReportCategory];
    if (weight !== undefined) {
      weightedSum += weight * count;
      totalItems += count;
    }
  }

  for (const [dataType, count] of Object.entries(publicDataCounts)) {
    const weight = PUBLIC_DATA_WEIGHTS[dataType as PublicDataType];
    if (weight !== undefined) {
      weightedSum += weight * count;
      totalItems += count;
    }
  }

  if (totalItems === 0) return null;

  // Average score per item, clamped to [-5, +5], mapped to [0, 100]
  const avgScore = weightedSum / totalItems;
  const clamped = Math.max(-5, Math.min(5, avgScore));
  return Math.round(((clamped + 5) / 10) * 100);
}

// Exported for testing
export {
  encodeGeohash,
  decodeGeohash,
  geohashesInBoundingBox,
  boundingBoxFromCenter,
  computeSafetyScore,
  isValidCategory,
  sanitizeDescription,
  REPORT_CATEGORIES,
  OVERPASS_MIRRORS,
};
export type { ReportCategory, PublicDataType, HeatmapCell, OSMDataPoint };
