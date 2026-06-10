# Rocket.Chat OAuth Proxy

A Node.js server that implements the Rocket.Chat OAuth proxy service.

## What is the OAuth Proxy?

OAuth providers (GitHub, Google, GitLab, …) redirect the browser to a `redirect_uri` after the user approves login. That URI must be **pre-registered** with the provider and match exactly.

This creates two practical problems:

1. **Private/dynamic URLs can't be registered** — providers won't accept `http://localhost:3000`, a private IP, or a customer-specific subdomain as a valid redirect URI.
2. **Every Rocket.Chat instance would need its own OAuth app** — not feasible when you have many instances or your URL changes.

The proxy solves both by providing **one stable public URL** that you register once. The real destination is encoded inside the OAuth `state` parameter (which providers don't validate), and the proxy redirects the browser there — so Rocket.Chat only needs to be reachable by the user's browser, not by the OAuth provider.

```
OAuth Provider (GitHub)
        │
        │  302 → https://your-proxy.example.com/oauth_redirect?code=…
        ▼
Proxy  (public internet — registered as redirect_uri with the provider)
        │
        │  302 → http://your-rocket.chat/_oauth/github?code=…
        ▼
Browser  ──────────────────────────────────────▶  Rocket.Chat (must be reachable by the browser)
```

## How it works

The real Rocket.Chat callback URL is smuggled inside the OAuth `state` parameter, encoded as:

```
<rocketchat_redirect_uri>!<original_state>
```

The proxy splits on the first `!` to recover both parts and constructs the final redirect back to the instance.

### Request flow

```
Browser (popup)           Proxy (this server)         OAuth Provider (GitHub…)
  │                              │                              │
  │── open popup ──────────────▶ GET /redirect/<loginUrl>      │
  │                              │── countdown page ──────────▶│
  │                              │                              │
  │◀──── user approves on GitHub, popup gets callback ─────────│
  │                              GET /oauth_redirect            │
  │                              │  ?code=…&state=<rcUrl>!…    │
  │◀── countdown page, then popup redirects to Rocket.Chat ─────┘
  │       http://localhost:3000/_oauth/github?code=…
  │
  (popup closes, login complete)
```

### Endpoint details

| Endpoint | Caller | Action |
|---|---|---|
| `GET /redirect/<encodedUrl>` | Rocket.Chat client (`OAuthProxy.ts`) | Decodes the URL and redirects to the OAuth provider's authorisation page |
| `GET /oauth_redirect` | OAuth provider callback | Unpacks `state` → extracts real Rocket.Chat callback URL → redirects browser back with the auth code |

## Usage

### 1. Install & start

```bash
cd oauth-proxy
npm install
node server.js
# Server running on http://localhost:3100
```

### 2. Register the callback URL with your OAuth provider

In your GitHub / Google / GitLab OAuth app settings, set the **callback / redirect URI** to:

```
http://localhost:3100/oauth_redirect
```

### 3. Configure Rocket.Chat

In **Admin → Settings → OAuth → Proxy**:

| Setting | Value |
|---|---|
| Proxy Host | `http://localhost:3100` |
| Proxy Services | Comma-separated service names, e.g. `github,google` |

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3100` | Port the server listens on |
| `REDIRECT_DELAY` | `3000` | Milliseconds to wait before each redirect (shows countdown page) |

```bash
PORT=4000 REDIRECT_DELAY=5000 node server.js
```
