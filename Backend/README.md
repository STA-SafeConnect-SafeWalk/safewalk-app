# SafeWalk Backend API – Dokumentation

Vollständige API-Referenz für Frontend-Entwickler. Beschreibt alle Endpunkte, Authentifizierung und erwartete Request-/Response-Formate.

---

## Inhaltsverzeichnis

1. [Architektur-Überblick](#architektur-überblick)
2. [Base URL](#base-url)
3. [Authentifizierung (JWT)](#authentifizierung-jwt)
4. [Endpunkt-Übersicht](#endpunkt-übersicht)
5. [Auth-Endpunkte (öffentlich)](#auth-endpunkte-öffentlich)
   - [POST /auth/sign-up](#post-authsign-up)
   - [POST /auth/confirm](#post-authconfirm)
   - [POST /auth/sign-in](#post-authsign-in)
   - [POST /auth/refresh](#post-authrefresh)
   - [POST /auth/sign-out](#post-authsign-out)
   - [POST /auth/forgot-password](#post-authforgot-password)
   - [POST /auth/confirm-forgot-password](#post-authconfirm-forgot-password)
6. [Geschützte Endpunkte (JWT erforderlich)](#geschützte-endpunkte-jwt-erforderlich)
   - [GET /me](#get-me)
   - [POST /register](#post-register)
   - [POST /register/platform](#post-registerplatform)
   - [GET /sharing-code](#get-sharing-code)
   - [POST /sharing-code](#post-sharing-code)
   - [POST /sharing-code/connect](#post-sharing-codeconnect)
   - [GET /contacts](#get-contacts)
   - [PATCH /contacts/{contactId}](#patch-contactscontactid)
   - [DELETE /contacts/{contactId}](#delete-contactscontactid)
7. [Fehler-Responses](#fehler-responses)
8. [Beispiel-Flow (Komplett)](#beispiel-flow-komplett)

---

## Architektur-Überblick

| Komponente | Beschreibung |
|---|---|
| **API Gateway (HTTP API)** | Zentraler Einstiegspunkt für alle Requests. Validiert JWTs bei geschützten Routen. |
| **Cognito User Pool** | Benutzerverwaltung und Token-Ausgabe (Sign-up, Sign-in, Passwort-Reset). |
| **Auth Handler Lambda** | Verarbeitet alle `/auth/*`-Endpunkte (Sign-up, Sign-in, etc.). |
| **User Profile Handler Lambda** | Verarbeitet Benutzerprofil, Sharing Codes und Kontakte. |
| **Platform Registration Handler Lambda** | Registriert Benutzer bei der externen SafeWalk-Plattform. |
| **DynamoDB (AppUsers)** | Speichert Benutzerprofile, `safeWalkId` und Sharing Codes. |

---

## Base URL

```
https://<api-id>.execute-api.<region>.amazonaws.com
```

Die tatsächliche URL wird beim CDK-Deployment als CloudFormation-Output `api-url` ausgegeben.

Alle Requests benötigen den Header:
```
Content-Type: application/json
```

---

## Authentifizierung (JWT)

Die API verwendet **AWS Cognito** zur Authentifizierung. Cognito gibt nach erfolgreichem Login drei Tokens aus:

| Token | Zweck | Gültigkeit |
|---|---|---|
| `idToken` | **Wird für API-Requests verwendet.** Enthält Benutzer-Claims (`sub`, `email`, etc.). | ~1 Stunde |
| `accessToken` | Wird für `sign-out` benötigt. | ~1 Stunde |
| `refreshToken` | Wird verwendet, um neue `idToken`/`accessToken`-Paare zu erhalten. | 30 Tage |

### Geschützte Endpunkte aufrufen

Für alle geschützten Endpunkte muss der **`idToken`** (nicht der `accessToken`) im `Authorization`-Header mitgesendet werden:

```
Authorization: Bearer <idToken>
```

> **Wichtig:** Der API Gateway JWT-Authorizer validiert den `aud`-Claim des Tokens. Cognito setzt diesen Claim nur im **ID Token** (auf die App Client ID). Der Access Token hat keinen `aud`-Claim und wird daher vom Authorizer **abgelehnt**. Verwende immer den `idToken` für geschützte API-Calls.

### Token-Lifecycle

```
1. POST /auth/sign-up        → Konto erstellen
2. POST /auth/confirm        → E-Mail bestätigen
3. POST /auth/sign-in        → Tokens erhalten (idToken, accessToken, refreshToken)
4. Geschützte Calls           → Authorization: Bearer <idToken>
5. POST /auth/refresh         → Neue Tokens holen (wenn idToken abgelaufen)
6. POST /auth/sign-out        → Alle Tokens invalidieren
```

### Benutzeridentifikation

Der JWT-Authorizer extrahiert automatisch die `sub`-Claim (Cognito User ID) aus dem `idToken`. Diese wird serverseitig als `userId` genutzt. **Der Client muss keine `userId` mitsenden** – sie wird immer aus dem Token gelesen.

### Passwort-Anforderungen

| Anforderung | Wert |
|---|---|
| Mindestlänge | 8 Zeichen |
| Großbuchstaben | Erforderlich |
| Kleinbuchstaben | Erforderlich |
| Ziffern | Erforderlich |
| Sonderzeichen | Nicht erforderlich |

---

## Endpunkt-Übersicht

### Öffentliche Endpunkte (kein Token nötig)

| Methode | Pfad | Beschreibung |
|---|---|---|
| `POST` | `/auth/sign-up` | Neues Konto erstellen |
| `POST` | `/auth/confirm` | E-Mail-Adresse bestätigen |
| `POST` | `/auth/sign-in` | Anmelden und Tokens erhalten |
| `POST` | `/auth/refresh` | Tokens erneuern |
| `POST` | `/auth/sign-out` | Abmelden (alle Tokens invalidieren) |
| `POST` | `/auth/forgot-password` | Passwort-Reset-Code anfordern |
| `POST` | `/auth/confirm-forgot-password` | Neues Passwort mit Reset-Code setzen |

### Geschützte Endpunkte (idToken im Authorization-Header)

| Methode | Pfad | Beschreibung |
|---|---|---|
| `GET` | `/me` | Eigenes Benutzerprofil abrufen (prüft ob Profil existiert) |
| `POST` | `/register` | Benutzerprofil anlegen **und** automatisch auf der Plattform registrieren (einmalig nach erstem Login) |
| `POST` | `/register/platform` | Benutzer manuell bei SafeWalk-Plattform registrieren (Legacy) |
| `GET` | `/sharing-code` | Aktuellen Sharing Code abrufen |
| `POST` | `/sharing-code` | Neuen Sharing Code generieren |
| `POST` | `/sharing-code/connect` | Mit Sharing Code eines Freundes verbinden |
| `GET` | `/contacts` | Alle vertrauenswürdigen Kontakte auflisten |
| `PATCH` | `/contacts/{contactId}` | Sharing-Einstellungen eines Kontakts ändern |
| `DELETE` | `/contacts/{contactId}` | Vertrauenswürdigen Kontakt entfernen |

---

## Auth-Endpunkte (öffentlich)

Diese Endpunkte erfordern **kein** `Authorization`-Header.

---

### POST /auth/sign-up

Erstellt ein neues Benutzerkonto. Cognito sendet automatisch einen Bestätigungscode per E-Mail.

**Request Body**

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `email` | `string` | ✅ | E-Mail-Adresse (wird als Username verwendet) |
| `password` | `string` | ✅ | Passwort (siehe Passwort-Anforderungen) |
| `displayName` | `string` | ✅ | Anzeigename des Benutzers |

```json
{
  "email": "max@example.com",
  "password": "MeinPasswort123",
  "displayName": "Max Mustermann"
}
```

**Response 201 – Erfolgreich**

```json
{
  "message": "Sign-up successful. Please check your email for a verification code.",
  "userSub": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "confirmed": false
}
```

**Mögliche Fehler**

| Status | Bedingung |
|---|---|
| `400` | Felder fehlen oder sind ungültig |
| `400` | Passwort erfüllt Anforderungen nicht |
| `409` | E-Mail-Adresse bereits registriert |
| `429` | Zu viele Anfragen |

---

### POST /auth/confirm

Bestätigt die E-Mail-Adresse mit dem per E-Mail zugesandten Bestätigungscode.

**Request Body**

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `email` | `string` | ✅ | E-Mail-Adresse des Kontos |
| `confirmationCode` | `string` | ✅ | 6-stelliger Code aus der Bestätigungs-E-Mail |

```json
{
  "email": "max@example.com",
  "confirmationCode": "123456"
}
```

**Response 200 – Erfolgreich**

```json
{
  "message": "Email confirmed. You can now sign in."
}
```

**Mögliche Fehler**

| Status | Bedingung |
|---|---|
| `400` | Felder fehlen oder sind ungültig |
| `400` | Ungültiger Bestätigungscode |
| `400` | Bestätigungscode abgelaufen |
| `404` | Benutzer nicht gefunden |
| `429` | Zu viele Anfragen |

---

### POST /auth/sign-in

Meldet den Benutzer an und gibt die JWT-Tokens zurück.

**Request Body**

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `email` | `string` | ✅ | E-Mail-Adresse |
| `password` | `string` | ✅ | Passwort |

```json
{
  "email": "max@example.com",
  "password": "MeinPasswort123"
}
```

**Response 200 – Erfolgreich**

```json
{
  "idToken": "eyJraWQiOi...",
  "accessToken": "eyJraWQiOi...",
  "refreshToken": "eyJjdHki...",
  "expiresIn": 3600
}
```

| Feld | Beschreibung |
|---|---|
| `idToken` | **Für alle geschützten API-Calls verwenden** (`Authorization: Bearer <idToken>`) |
| `accessToken` | Wird für `POST /auth/sign-out` benötigt |
| `refreshToken` | Wird für `POST /auth/refresh` benötigt, um neue Tokens zu erhalten |
| `expiresIn` | Gültigkeitsdauer des `idToken`/`accessToken` in Sekunden (3600 = 1 Stunde) |

**Mögliche Fehler**

| Status | Bedingung |
|---|---|
| `400` | Felder fehlen oder sind ungültig |
| `401` | E-Mail oder Passwort falsch |
| `404` | Benutzer nicht gefunden |
| `429` | Zu viele Anfragen |

---

### POST /auth/refresh

Erneuert das `idToken` und das `accessToken` mithilfe des `refreshToken`. Verwende diesen Endpunkt, wenn der `idToken` abgelaufen ist (nach ca. 1 Stunde).

**Request Body**

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `refreshToken` | `string` | ✅ | Der beim Login erhaltene Refresh Token |

```json
{
  "email": "user@example.com",
  "password": "MyPassword",
  "refreshToken": "eyJjdHki..."
}
```

**Response 200 – Erfolgreich**

```json
{
  "idToken": "eyJraWQiOi...",
  "accessToken": "eyJraWQiOi...",
  "expiresIn": 3600
}
```

> **Hinweis:** Ein neuer `refreshToken` wird bei diesem Call **nicht** zurückgegeben. Der bestehende `refreshToken` bleibt gültig.

**Mögliche Fehler**

| Status | Bedingung |
|---|---|
| `400` | `refreshToken` fehlt |
| `401` | Refresh Token ungültig oder abgelaufen |
| `429` | Zu viele Anfragen |

---

### POST /auth/sign-out

Meldet den Benutzer ab und invalidiert **alle** aktiven Tokens (globaler Sign-Out).

**Request Body**

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `accessToken` | `string` | ✅ | Der beim Login erhaltene Access Token |

```json
{
  "accessToken": "eyJraWQiOi..."
}
```

**Response 200 – Erfolgreich**

```json
{
  "message": "Signed out successfully"
}
```

**Mögliche Fehler**

| Status | Bedingung |
|---|---|
| `400` | `accessToken` fehlt |
| `401` | Access Token ungültig |
| `429` | Zu viele Anfragen |

---

### POST /auth/forgot-password

Löst den Passwort-Reset-Flow aus. Cognito sendet einen Reset-Code per E-Mail.

**Request Body**

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `email` | `string` | ✅ | E-Mail-Adresse des Kontos |

```json
{
  "email": "max@example.com"
}
```

**Response 200 – Immer (aus Sicherheitsgründen)**

```json
{
  "message": "If an account with that email exists, a reset code has been sent."
}
```

> **Hinweis:** Dieser Endpunkt gibt **immer** Status `200` zurück, auch wenn die E-Mail-Adresse nicht existiert. Dies verhindert Account-Enumeration (Angreifer können nicht herausfinden, welche E-Mail-Adressen registriert sind).

**Mögliche Fehler**

| Status | Bedingung |
|---|---|
| `400` | `email` fehlt |
| `429` | Zu viele Anfragen |

---

### POST /auth/confirm-forgot-password

Setzt das Passwort mit dem per E-Mail erhaltenen Reset-Code zurück.

**Request Body**

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `email` | `string` | ✅ | E-Mail-Adresse des Kontos |
| `confirmationCode` | `string` | ✅ | Reset-Code aus der E-Mail |
| `newPassword` | `string` | ✅ | Neues Passwort (siehe Passwort-Anforderungen) |

```json
{
  "email": "max@example.com",
  "confirmationCode": "654321",
  "newPassword": "NeuesPasswort456"
}
```

**Response 200 – Erfolgreich**

```json
{
  "message": "Password reset successfully. You can now sign in."
}
```

**Mögliche Fehler**

| Status | Bedingung |
|---|---|
| `400` | Felder fehlen oder sind ungültig |
| `400` | Ungültiger oder abgelaufener Reset-Code |
| `400` | Neues Passwort erfüllt Anforderungen nicht |
| `404` | Benutzer nicht gefunden |
| `429` | Zu viele Anfragen |

---

## Geschützte Endpunkte (JWT erforderlich)

Alle folgenden Endpunkte erfordern einen gültigen `idToken` im Header:

```
Authorization: Bearer <idToken>
```

Die Benutzeridentität (`userId`) wird automatisch aus dem `sub`-Claim des Tokens gelesen. **Es muss keine `userId` im Body oder als Query-Parameter mitgesendet werden.**

---

### GET /me

Gibt das eigene Benutzerprofil zurück. Dient primär dazu zu prüfen, ob ein gültiges Profil in DynamoDB existiert, ohne es neu anzulegen.

> **Wichtig für den Login-Flow:** Das Frontend ruft `GET /me` bei jedem normalen Login und bei der Session-Wiederherstellung auf. Gibt der Endpunkt `404` zurück, existiert kein Profil mehr (z. B. weil der Benutzer administrativ gelöscht wurde). In diesem Fall wird der Benutzer automatisch ausgeloggt und erhält eine entsprechende Fehlermeldung.

**Request**

Kein Body oder Query-Parameter nötig – der Benutzer wird über den JWT-Token identifiziert.

```
GET /me
Authorization: Bearer <idToken>
```

**Response 200 – Erfolgreich**

```json
{
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "email": "max@example.com",
  "displayName": "Max Mustermann",
  "hasPlatformRegistration": true
}
```

| Feld | Typ | Beschreibung |
|---|---|---|
| `userId` | `string` | Cognito `sub` des Benutzers |
| `email` | `string` | E-Mail-Adresse des Benutzers |
| `displayName` | `string?` | Anzeigename (kann `null` sein) |
| `hasPlatformRegistration` | `boolean` | Ob der Benutzer bereits auf der SafeWalk-Plattform registriert ist |

**Mögliche Fehler**

| Status | Bedingung |
|---|---|
| `401` | Kein oder ungültiger Token |
| `404` | Kein Benutzerprofil gefunden (Profil wurde gelöscht) |
| `500` | Interner Serverfehler |

---

### POST /register

Erstellt das Benutzerprofil in DynamoDB **und** registriert den Benutzer automatisch auf der SafeWalk-Plattform. **Muss einmalig nach dem allerersten Login aufgerufen werden.**

Die E-Mail-Adresse wird automatisch aus dem `email`-Claim des ID Tokens gelesen. Ein separater Aufruf von `POST /register/platform` ist danach **nicht mehr nötig**.

**Request Body** (optional)

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `displayName` | `string` | ❌ | Anzeigename des Benutzers |

```json
{
  "displayName": "Max Mustermann"
}
```

Oder leerer Body / kein Body:
```json
{}
```

**Response 201 – Profil und Plattform-Registrierung erfolgreich**

```json
{
  "message": "User profile created",
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "sharingCode": "ABCDEF",
  "sharingCodeExpiresAt": "2026-03-10T12:00:00.000Z"
}
```

**Response 201 – Profil erstellt, Plattform-Registrierung fehlgeschlagen**

Das Profil wird trotzdem angelegt. Die Plattform-Registrierung kann später über `POST /register/platform` nachgeholt werden.

```json
{
  "message": "User profile created",
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "platformRegistrationError": "Could not reach SafeWalk platform"
}
```

**Response 200 – Profil existiert bereits**

```json
{
  "message": "User profile already exists",
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Mögliche Fehler**

| Status | Bedingung |
|---|---|
| `401` | Kein oder ungültiger Token |
| `500` | Interner Serverfehler |

---

### POST /register/platform

> **Hinweis:** Seit der Überarbeitung von `POST /register` wird die Plattform-Registrierung **automatisch** beim ersten Aufruf von `POST /register` durchgeführt. Dieser Endpunkt wird daher nur noch benötigt, wenn die automatische Registrierung innerhalb von `POST /register` fehlgeschlagen ist (erkennbar am Feld `platformRegistrationError` in der Response).

Registriert den Benutzer bei der externen SafeWalk-Plattform. Dabei wird eine `safeWalkId` zugewiesen und ein erster Sharing Code generiert.

Falls der Benutzer bereits registriert ist und einen gültigen (nicht abgelaufenen) Sharing Code hat, wird dieser direkt zurückgegeben, ohne einen neuen zu generieren.

Falls der Sharing Code abgelaufen ist, wird ein neuer generiert.

**Request Body**

Kein Body erforderlich. Die Benutzeridentität wird aus dem JWT-Token gelesen.

**Response 200 – Neue Registrierung**

```json
{
  "message": "Platform registration successful",
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "sharingCode": "ABCDEF",
  "sharingCodeExpiresAt": "2026-03-10T12:00:00.000Z"
}
```

**Response 200 – Bereits registriert (gültiger Code vorhanden)**

```json
{
  "message": "User already registered",
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "sharingCode": "ABCDEF",
  "sharingCodeExpiresAt": "2026-03-10T12:00:00.000Z"
}
```

**Response 200 – Code erneuert (alter Code abgelaufen)**

```json
{
  "message": "Sharing code refreshed",
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "sharingCode": "GHIJKL",
  "sharingCodeExpiresAt": "2026-03-10T12:00:00.000Z"
}
```

**Mögliche Fehler**

| Status | Bedingung |
|---|---|
| `401` | Kein oder ungültiger Token |
| `502` | Plattform nicht erreichbar oder ungültige Antwort |

**Voraussetzung:** `POST /register` muss vorher aufgerufen worden sein.

---

### GET /sharing-code

Gibt den aktuell gespeicherten Sharing Code und dessen Ablaufzeitpunkt zurück.

**Request**

Keine Query-Parameter oder Body nötig – der Benutzer wird über den JWT-Token identifiziert.

```
GET /sharing-code
Authorization: Bearer <idToken>
```

**Response 200 – Erfolgreich**

```json
{
  "sharingCode": "ABCDEF",
  "sharingCodeExpiresAt": "2026-03-10T12:00:00.000Z"
}
```

**Mögliche Fehler**

| Status | Bedingung |
|---|---|
| `401` | Kein oder ungültiger Token |
| `404` | Benutzer nicht gefunden oder noch kein Sharing Code vorhanden |
| `500` | Interner Serverfehler |

**Voraussetzung:** `POST /register` muss vorher aufgerufen worden sein (der erste Sharing Code wird dabei automatisch generiert).

---

### POST /sharing-code

Generiert einen neuen Sharing Code über die SafeWalk-Plattform. Der neue Code ersetzt den bisherigen und ist 24 Stunden gültig.

**Request**

Kein Body erforderlich – der Benutzer wird über den JWT-Token identifiziert.

```
POST /sharing-code
Authorization: Bearer <idToken>
```

**Response 200 – Erfolgreich**

```json
{
  "sharingCode": "XYZABC",
  "sharingCodeExpiresAt": "2026-03-10T12:00:00.000Z"
}
```

**Mögliche Fehler**

| Status | Bedingung |
|---|---|
| `400` | Benutzer ist noch nicht auf der Plattform registriert |
| `401` | Kein oder ungültiger Token |
| `502` | Plattform nicht erreichbar oder ungültige Antwort |

**Voraussetzung:** `POST /register` muss vorher aufgerufen worden sein.

---

### POST /sharing-code/connect

Verbindet den Benutzer mit einem Freund über dessen Sharing Code. Der Benutzer wird als vertrauenswürdiger Kontakt des Freundes registriert.

**Request Body**

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `sharingCode` | `string` | ✅ | Sharing Code des Freundes |

```json
{
  "sharingCode": "XYZABC"
}
```

**Response 200 – Erfolgreich**

```json
{
  "message": "Successfully connected as trusted contact"
}
```

**Mögliche Fehler**

| Status | Bedingung |
|---|---|
| `400` | `sharingCode` fehlt oder ist kein String |
| `400` | Benutzer ist noch nicht auf der Plattform registriert |
| `401` | Kein oder ungültiger Token |
| `502` | Plattform hat die Verknüpfung abgelehnt (z. B. ungültiger/abgelaufener Code) |

**Voraussetzung:** Beide Benutzer (der Anfragende und der Freund) müssen via `POST /register` registriert sein. Der Freund muss einen gültigen Sharing Code haben.

---

### GET /contacts

Gibt alle vertrauenswürdigen Kontakte des Benutzers zurück, inklusive der Sharing-Einstellungen.

**Request**

Keine Query-Parameter oder Body nötig – der Benutzer wird über den JWT-Token identifiziert.

```
GET /contacts
Authorization: Bearer <idToken>
```

**Response 200 – Erfolgreich**

```json
{
  "contacts": [
    {
      "contactId": "c1d2e3f4-5678-90ab-cdef-1234567890ab",
      "outgoingContactId": "c1d2e3f4-5678-90ab-cdef-1234567890ab",
      "safeWalkId": "friend-safewalk-id",
      "displayName": "Jane Doe",
      "isOutgoing": true,
      "locationSharing": true,
      "sosSharing": true,
      "sharesBackLocation": true,
      "sharesBackSOS": false
    },
    {
      "contactId": "a9b8c7d6-5432-10fe-dcba-0987654321fe",
      "outgoingContactId": null,
      "safeWalkId": "other-friend-id",
      "displayName": "John Smith",
      "isOutgoing": false,
      "locationSharing": false,
      "sosSharing": false,
      "sharesBackLocation": false,
      "sharesBackSOS": true
    }
  ]
}
```

| Feld | Typ | Beschreibung |
|---|---|---|
| `contactId` | `string` | Repräsentative ID des Kontakts (für DELETE verwenden) |
| `outgoingContactId` | `string?` | ID des eigenen Sharing-Eintrags (für PATCH verwenden). `null` wenn nur eingehend. |
| `safeWalkId` | `string` | SafeWalk-Plattform-ID des Kontakts |
| `displayName` | `string?` | Anzeigename des Kontakts (kann `null` sein) |
| `isOutgoing` | `boolean` | `true` wenn der Benutzer einen ausgehenden Sharing-Eintrag mit diesem Kontakt hat |
| `locationSharing` | `boolean` | Ob der Benutzer seinen Standort mit diesem Kontakt teilt (ausgehend) |
| `sosSharing` | `boolean` | Ob der Benutzer SOS-Alerts mit diesem Kontakt teilt (ausgehend) |
| `sharesBackLocation` | `boolean` | Ob der Kontakt seinen Standort mit dem Benutzer teilt (eingehend) |
| `sharesBackSOS` | `boolean` | Ob der Kontakt SOS-Alerts mit dem Benutzer teilt (eingehend) |

> **Hinweis:** Die Toggles im Frontend (Standort/SOS teilen) steuern `locationSharing` und `sosSharing` (ausgehend). Für `PATCH /contacts/{contactId}` muss die `outgoingContactId` verwendet werden, nicht die `contactId`. Toggles werden nur angezeigt, wenn `isOutgoing` `true` ist.

**Mögliche Fehler**

| Status | Bedingung |
|---|---|
| `400` | Benutzer ist noch nicht auf der Plattform registriert |
| `401` | Kein oder ungültiger Token |
| `502` | Plattform nicht erreichbar |

**Voraussetzung:** `POST /register` muss vorher aufgerufen worden sein.

---

### PATCH /contacts/{contactId}

Aktualisiert die Sharing-Einstellungen (Standort und/oder SOS) für einen bestimmten vertrauenswürdigen Kontakt. Die Einstellungen sind unabhängig von der Kontaktbeziehung selbst – ein Kontakt kann existieren, ohne dass Sharing aktiviert ist.

> **Wichtig:** Für den `contactId`-Path-Parameter muss die `outgoingContactId` aus `GET /contacts` verwendet werden (nicht die `contactId`). `outgoingContactId` identifiziert den eigenen Sharing-Eintrag des Benutzers.

**Path-Parameter**

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `contactId` | `string` | ✅ | Die `outgoingContactId` aus `GET /contacts` |

**Request Body**

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `locationSharing` | `boolean` | ✅ | Standort-Sharing aktivieren/deaktivieren |
| `sosSharing` | `boolean` | ✅ | SOS-Sharing aktivieren/deaktivieren |

```
PATCH /contacts/c1d2e3f4-5678-90ab-cdef-1234567890ab
Authorization: Bearer <idToken>
```

```json
{
  "locationSharing": true,
  "sosSharing": false
}
```

**Response 200 – Erfolgreich**

```json
{
  "message": "Contact settings updated successfully"
}
```

**Mögliche Fehler**

| Status | Bedingung |
|---|---|
| `400` | `contactId` fehlt im Pfad |
| `400` | `locationSharing` oder `sosSharing` fehlt oder ist kein Boolean |
| `400` | Benutzer ist noch nicht auf der Plattform registriert |
| `401` | Kein oder ungültiger Token |
| `502` | Plattform hat das Update abgelehnt |

---

### DELETE /contacts/{contactId}

Entfernt einen vertrauenswürdigen Kontakt. Die Löschung wird an die SafeWalk-Plattform weitergeleitet.

**Path-Parameter**

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `contactId` | `string` | ✅ | Die `contactId` aus `GET /contacts` |

**Request**

```
DELETE /contacts/c1d2e3f4-5678-90ab-cdef-1234567890ab
Authorization: Bearer <idToken>
```

Kein Body erforderlich.

**Response 200 – Erfolgreich**

```json
{
  "message": "Trusted contact removed successfully"
}
```

**Mögliche Fehler**

| Status | Bedingung |
|---|---|
| `400` | `contactId` fehlt im Pfad |
| `400` | Benutzer ist noch nicht auf der Plattform registriert |
| `401` | Kein oder ungültiger Token |
| `502` | Plattform hat die Löschung abgelehnt |

---

## Fehler-Responses

Alle Fehler folgen dem gleichen Format:

```json
{
  "error": "Beschreibung des Fehlers",
  "details": "Optionale technische Details (nur bei 5xx-Fehlern)"
}
```

### Allgemeine Fehler-Codes

| Status | Bedeutung |
|---|---|
| `400` | Ungültige Anfrage (fehlende/falsche Parameter) |
| `401` | Nicht authentifiziert (Token fehlt, ungültig oder abgelaufen) |
| `404` | Ressource nicht gefunden (Benutzer, Route, Sharing Code) |
| `409` | Konflikt (z. B. E-Mail bereits registriert) |
| `429` | Rate Limit erreicht (zu viele Anfragen) |
| `500` | Interner Serverfehler |
| `502` | Plattform-Fehler (externe SafeWalk-Plattform nicht erreichbar oder hat Fehler zurückgegeben) |

---

## Beispiel-Flow (Komplett)

Ein typischer Ablauf von der Registrierung bis zur Kontaktverwaltung:

```bash
BASE_URL="https://<api-id>.execute-api.<region>.amazonaws.com"

# 1. Konto erstellen
curl -X POST "$BASE_URL/auth/sign-up" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "max@example.com",
    "password": "MeinPasswort123",
    "displayName": "Max Mustermann"
  }'

# 2. E-Mail bestätigen (Code aus E-Mail)
curl -X POST "$BASE_URL/auth/confirm" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "max@example.com",
    "confirmationCode": "123456"
  }'

# 3. Anmelden → Tokens erhalten
curl -X POST "$BASE_URL/auth/sign-in" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "max@example.com",
    "password": "MeinPasswort123"
  }'
# → Speichere idToken, accessToken, refreshToken

# 4. Benutzerprofil anlegen + automatisch auf Plattform registrieren (einmalig nach erstem Login)
curl -X POST "$BASE_URL/register" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <idToken>" \
  -d '{ "displayName": "Max Mustermann" }'
# → Response enthält direkt sharingCode und sharingCodeExpiresAt
# → POST /register/platform ist nicht mehr nötig

# 4b. [Optional] Profil-Existenz prüfen (bei normalem Login / Session-Restore)
curl "$BASE_URL/me" \
  -H "Authorization: Bearer <idToken>"
# → 200: Profil existiert, Login erlaubt
# → 404: Profil wurde gelöscht, Benutzer wird ausgeloggt

# 5. Aktuellen Sharing Code abrufen
curl "$BASE_URL/sharing-code" \
  -H "Authorization: Bearer <idToken>"

# 6. Neuen Sharing Code generieren
curl -X POST "$BASE_URL/sharing-code" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <idToken>"

# 7. Über Sharing Code eines Freundes verbinden
curl -X POST "$BASE_URL/sharing-code/connect" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <idToken>" \
  -d '{ "sharingCode": "XYZABC" }'

# 8. Kontakte auflisten
curl "$BASE_URL/contacts" \
  -H "Authorization: Bearer <idToken>"

# 9. Sharing-Einstellungen eines Kontakts ändern
curl -X PATCH "$BASE_URL/contacts/<contactId>" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <idToken>" \
  -d '{ "locationSharing": true, "sosSharing": false }'

# 10. Kontakt entfernen
curl -X DELETE "$BASE_URL/contacts/<contactId>" \
  -H "Authorization: Bearer <idToken>"

# 11. Token erneuern (wenn idToken abgelaufen)
curl -X POST "$BASE_URL/auth/refresh" \
  -H "Content-Type: application/json" \
  -d '{ "refreshToken": "<refreshToken>" }'

# 12. Abmelden
curl -X POST "$BASE_URL/auth/sign-out" \
  -H "Content-Type: application/json" \
  -d '{ "accessToken": "<accessToken>" }'
```
