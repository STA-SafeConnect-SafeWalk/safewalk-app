# SafeWalk Backend (CDK)

Infrastructure for the SafeWalk app built with AWS CDK (TypeScript). The stack provisions:

- **HTTP API Gateway** (`safewalk-app-api`) with CORS enabled (GET, POST, PATCH, DELETE)
- **Two Lambda functions** – user profile / sharing-code / contacts handler and platform registration handler (Node.js 24)
- **DynamoDB table** `AppUsers` (partition key `safeWalkAppId`, GSI `SharingCodeIndex` on `sharingCode`)

---

## Required environment variables

Set these before running `cdk synth` / `cdk deploy` (see `.env_template`):

| Variable | Description |
| --- | --- |
| `PLATFORM_DOMAIN` | Base URL of the upstream SafeWalk platform API (e.g. `https://example.com/api`) |
| `VENDOR_ID` | Platform vendor / partner identifier |
| `API_KEY` | API key for authenticating with the platform (`x-api-key` header) |
| `WEBHOOK_SECRET` | Webhook secret for authenticating receiving requests |

> **Do not commit `.env`** – keep secrets in CI/CD variables or a secrets manager.

---

## API endpoints

All routes are served by an HTTP API Gateway. Requests and responses use `Content-Type: application/json`.

### Platform registration

| Method | Path | Description |
| --- | --- | --- |
| POST | `/register/platform` | Register a user on the external SafeWalk platform and obtain a sharing code (valid 24 h). If the user already has a valid code, it is returned immediately. |

**Request body**

```json
{ "userId": "string" }
```

**Response (200)**

```json
{
  "message": "Platform registration successful",
  "userId": "…",
  "sharingCode": "…",
  "sharingCodeExpiresAt": "…"
}
```

### Sharing codes

| Method | Path | Description |
| --- | --- | --- |
| GET | `/sharing-code?userId=<id>` | Retrieve the current sharing code stored in DynamoDB. Returns 404 if none exists or the user is unknown. |
| POST | `/sharing-code` | Generate or refresh a sharing code for an already-registered user via the platform API. |
| POST | `/sharing-code/connect` | Register the calling user as a trusted contact of another user using their sharing code. |

**POST `/sharing-code` request body**

```json
{ "userId": "string" }
```

**POST `/sharing-code/connect` request body**

```json
{ "userId": "string", "sharingCode": "string" }
```

### Trusted contacts

| Method | Path | Description |
| --- | --- | --- |
| GET | `/contacts?userId=<id>` | List all trusted contacts for a user. |
| PATCH | `/contacts/{contactId}` | Update sharing settings (`locationSharing`, `sosSharing`) for a specific contact. |
| DELETE | `/contacts/{contactId}?userId=<id>` | Remove a trusted contact. |

**PATCH `/contacts/{contactId}` request body**

```json
{
  "userId": "string",
  "locationSharing": true,
  "sosSharing": true
}
```

---

## Behavior notes

- Sharing codes are issued by the platform and stored in DynamoDB with an expiry (24 h).
- `POST /sharing-code` requires the user to be platform-registered first (a `safeWalkId` must exist in the table).
- `POST /sharing-code/connect` forwards the code to the platform `/contacts` endpoint.
- All platform calls use a 15 s timeout; non-2xx responses are surfaced as **502** to the client.

---

## Quick usage (cURL examples)

```sh
# Set your API Gateway URL
export API_URL="https://<api-id>.execute-api.<region>.amazonaws.com"

# Register on the platform & get a sharing code
curl -X POST "$API_URL/register/platform" \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo-user"}'

# Generate / refresh a sharing code
curl -X POST "$API_URL/sharing-code" \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo-user"}'

# Fetch the stored sharing code
curl "$API_URL/sharing-code?userId=demo-user"

# Connect as a trusted contact
curl -X POST "$API_URL/sharing-code/connect" \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo-user","sharingCode":"ABCDE12345"}'

# List trusted contacts
curl "$API_URL/contacts?userId=demo-user"

# Update contact sharing settings
curl -X PATCH "$API_URL/contacts/some-contact-id" \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo-user","locationSharing":true,"sosSharing":false}'

# Remove a trusted contact
curl -X DELETE "$API_URL/contacts/some-contact-id?userId=demo-user"
```

---

## Local development

```sh
npm install          # Install dependencies
npx cdk synth        # Synthesize CloudFormation template
npx cdk diff         # Compare deployed stack with local changes
npx cdk deploy       # Deploy to your default AWS account/region
npm test             # Run Jest unit tests
```

## Operational advice

- DynamoDB uses **PAY_PER_REQUEST** billing and has Point-in-Time Recovery enabled. Removal policy is `DESTROY` (appropriate for dev/staging — switch to `RETAIN` for production).
- Lambda log retention is set to **one week**; adjust in `lib/app-backend-stack.ts` if longer retention is needed.
- CORS is currently open to all origins (`*`). Restrict `allowOrigins` for production deployments.
