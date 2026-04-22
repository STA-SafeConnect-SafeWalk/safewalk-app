import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

interface TipItem {
  tipId: string;
  icon: string;
  title: string;
  description: string;
  category: string;
  link?: string;
}

interface TipRecord {
  tipId?: unknown;
  icon?: unknown;
  title?: unknown;
  description?: unknown;
  category?: unknown;
  link?: unknown;
  isActive?: unknown;
}

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

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

const getDailyIndex = (size: number): number => {
  const now = new Date();
  const utcDayStamp = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const dayNumber = Math.floor(utcDayStamp / 86400000);
  return dayNumber % size;
};

const toTipItem = (record: TipRecord): TipItem | null => {
  if (typeof record.tipId !== 'string' || record.tipId.trim().length === 0) {
    return null;
  }
  if (typeof record.title !== 'string' || record.title.trim().length === 0) {
    return null;
  }

  return {
    tipId: record.tipId.trim(),
    icon: typeof record.icon === 'string' ? record.icon : 'tips_and_updates',
    title: record.title.trim(),
    description:
      typeof record.description === 'string' ? record.description.trim() : '',
    category: typeof record.category === 'string' && record.category.trim().length > 0
        ? record.category.trim()
        : 'Allgemein',
    link:
      typeof record.link === 'string' && record.link.trim().length > 0
          ? record.link.trim()
          : undefined,
  };
};

const isActiveRecord = (record: TipRecord): boolean => record.isActive !== false;

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (event.routeKey !== 'GET /tips') {
    return jsonResponse(404, { success: false, message: 'Route not found' });
  }

  const userId = getAuthenticatedUserId(event);
  if (!userId) {
    return jsonResponse(401, { success: false, message: 'Unauthorized' });
  }

  const tableName = process.env.TIPS_TABLE_NAME;
  if (!tableName) {
    return jsonResponse(500, {
      success: false,
      message: 'Server configuration error: TIPS_TABLE_NAME not set',
    });
  }

  try {
    const items: TipRecord[] = [];
    let lastEvaluatedKey: Record<string, any> | undefined;

    do {
      const response = await docClient.send(
        new ScanCommand({
          TableName: tableName,
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );
      items.push(...((response.Items as TipRecord[] | undefined) ?? []));
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    const activeTips = items
      .filter(isActiveRecord)
      .map(toTipItem)
      .filter((tip): tip is TipItem => tip != null)
      .sort((a, b) => a.tipId.localeCompare(b.tipId));

    if (activeTips.length === 0) {
      return jsonResponse(200, {
        success: true,
        data: {
          tipOfTheDay: null,
          tips: [] as TipItem[],
        },
      });
    }

    const dailyIndex = getDailyIndex(activeTips.length);
    const tipOfTheDay = activeTips[dailyIndex];
    const generalTips = activeTips.filter((tip) => tip.tipId !== tipOfTheDay.tipId);

    return jsonResponse(200, {
      success: true,
      data: {
        tipOfTheDay,
        tips: generalTips,
      },
    });
  } catch (error) {
    console.error('Failed to load tips', error);
    return jsonResponse(500, {
      success: false,
      message: 'Failed to load tips',
    });
  }
};
