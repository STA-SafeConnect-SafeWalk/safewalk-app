# User Profile Handler Lambda

Lambda function for sharing code management and trusted contacts. Handles six routes:

| Route | Description |
|---|---|
| `GET /sharing-code` | Returns the current sharing code and its expiry timestamp |
| `POST /sharing-code` | Generates a new sharing code via the platform and stores it |
| `POST /sharing-code/connect` | Adds a friend as a trusted contact using their sharing code |
| `GET /contacts` | Lists all trusted contacts with their sharing settings |
| `PATCH /contacts/{contactId}` | Updates location/SOS sharing settings for a contact |
| `DELETE /contacts/{contactId}` | Removes a trusted contact via the platform |

## Environment Variables

- `TABLE_NAME`: DynamoDB table name (`AppUsers`)
- `PLATFORM_DOMAIN`: Base URL of the SafeWalk platform (e.g. `https://platform.example.com`)
- `VENDOR_ID`: Vendor identification ID for the platform
- `API_KEY`: API key sent as `x-api-key` header to the platform

## Endpoints

### GET /sharing-code

Returns the stored sharing code for a user.

**Query Parameters**
- `userId` (required) – the user's SafeWalk app ID

**Response 200**
```json
{
  "sharingCode": "ABCDEF",
  "sharingCodeExpiresAt": "2026-03-06T12:00:00.000Z"
}
```

**Response 404** – user not found or no sharing code exists yet.

---

### POST /sharing-code

Calls the platform's `/sharing-codes` endpoint to generate a new code, stores it in DynamoDB, and returns it.

**Request Body**
```json
{ "userId": "user123" }
```

**Response 200**
```json
{
  "sharingCode": "ABCDEF",
  "sharingCodeExpiresAt": "2026-03-06T12:00:00.000Z"
}
```

**Prerequisites** – the user must have been registered on the platform first (`POST /register/platform`).

---

### POST /sharing-code/connect

Sends the user's `safeWalkId` and a friend's sharing code to the platform's `/trusted-contacts` endpoint to register the user as a trusted contact.

**Request Body**
```json
{
  "userId": "user123",
  "sharingCode": "XYZABC"
}
```

**Response 200**
```json
{
  "message": "Successfully connected as trusted contact"
}
```

---

### GET /contacts

Fetches all trusted contacts for a user from the platform. Each contact includes whether SOS and location sharing are enabled.

**Query Parameters**
- `userId` (required) – the user's SafeWalk app ID

**Response 200**
```json
{
  "contacts": [
    {
      "contactId": "contact-uuid",
      "safeWalkId": "friend-safewalk-id",
      "displayName": "Jane Doe",
      "locationSharing": true,
      "sosSharing": true
    }
  ]
}
```

---

### PATCH /contacts/{contactId}

Updates the location sharing and/or SOS sharing settings for a specific trusted contact. These settings are independent of the contact relationship itself — a contact can exist without any sharing enabled.

**Path Parameters**
- `contactId` (required) – the platform contact ID to update

**Request Body**
```json
{
  "userId": "user123",
  "locationSharing": true,
  "sosSharing": false
}
```

**Response 200**
```json
{
  "message": "Contact settings updated successfully"
}
```

---

### DELETE /contacts/{contactId}

Removes a trusted contact. Forwards the deletion request to the platform.

**Path Parameters**
- `contactId` (required) – the platform contact ID to remove

**Query Parameters**
- `userId` (required) – the user's SafeWalk app ID

**Response 200**
```json
{
  "message": "Trusted contact removed successfully"
}
```

## Example Usage

```bash
# Get current sharing code
curl "https://your-api-gateway-url/sharing-code?userId=user123"

# Generate a new sharing code
curl -X POST https://your-api-gateway-url/sharing-code \
  -H "Content-Type: application/json" \
  -d '{ "userId": "user123" }'

# Connect using a friend's sharing code
curl -X POST https://your-api-gateway-url/sharing-code/connect \
  -H "Content-Type: application/json" \
  -d '{ "userId": "user123", "sharingCode": "XYZABC" }'

# List all trusted contacts
curl "https://your-api-gateway-url/contacts?userId=user123"

# Update sharing settings for a contact
curl -X PATCH https://your-api-gateway-url/contacts/contact-uuid \
  -H "Content-Type: application/json" \
  -d '{ "userId": "user123", "locationSharing": true, "sosSharing": false }'

# Remove a trusted contact
curl -X DELETE "https://your-api-gateway-url/contacts/contact-uuid?userId=user123"
```
