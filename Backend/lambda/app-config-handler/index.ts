import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const jsonResponse = (
  statusCode: number,
  body: Record<string, unknown>,
): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  },
  body: JSON.stringify(body),
});

const getAuthenticatedUserId = (
  event: APIGatewayProxyEventV2,
): string | undefined => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = event.requestContext as any;
  return ctx.authorizer?.jwt?.claims?.sub as string | undefined;
};

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (event.routeKey !== 'GET /app-config') {
    return jsonResponse(404, { success: false, message: 'Route nicht gefunden' });
  }

  const userId = getAuthenticatedUserId(event);
  if (!userId) {
    return jsonResponse(401, { success: false, message: 'Nicht autorisiert' });
  }

  const mapboxAccessToken = process.env.MAPBOX_ACCESS_TOKEN;
  if (!mapboxAccessToken || mapboxAccessToken.trim().length === 0) {
    return jsonResponse(500, {
      success: false,
      message: 'Serverkonfigurationsfehler: MAPBOX_ACCESS_TOKEN ist nicht gesetzt',
    });
  }

  return jsonResponse(200, {
    success: true,
    data: {
      mapboxAccessToken,
    },
  });
};
