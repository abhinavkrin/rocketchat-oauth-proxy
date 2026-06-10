/**
 * Local OAuth Proxy Server for Rocket.Chat development
 *
 * Mirrors the behaviour of https://oauth-proxy.rocket.chat
 *
 * Two endpoints:
 *
 *  GET /redirect/<encodedLoginUrl>
 *    – Called by the Rocket.Chat client (OAuthProxy.ts) to kick off the OAuth
 *      flow.  Decodes the URL and 302-redirects the browser to the OAuth
 *      provider's authorisation page.
 *
 *  GET /oauth_redirect?code=…&state=<encodedRedirectUri>!<originalState>
 *    – The OAuth provider calls back here (this is the registered redirect_uri).
 *      The proxy unpacks the state, recovers the real Rocket.Chat callback URL
 *      and 302-redirects the browser back to the instance with the auth code.
 */

const express = require('express');

const app = express();
const ts = () => new Date().toISOString();
const PORT = process.env.PORT || 3100;
const DELAY_MS = parseInt(process.env.REDIRECT_DELAY ?? '3000', 10);

/** Render an HTML page that displays a countdown and redirects after DELAY_MS. */
function delayedRedirectPage(url, label) {
  const seconds = DELAY_MS / 1000;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>OAuth Proxy – Redirecting…</title>
  <style>
    body { font-family: sans-serif; display: flex; flex-direction: column;
           align-items: center; justify-content: center; height: 100vh; margin: 0;
           background: #f5f5f5; color: #333; }
    .card { background: #fff; border-radius: 8px; padding: 2rem 3rem;
            box-shadow: 0 2px 12px rgba(0,0,0,.1); text-align: center; max-width: 560px; }
    h2 { margin: 0 0 .5rem; }
    p  { margin: .25rem 0; word-break: break-all; font-size: .85rem; color: #555; }
    .counter { font-size: 2.5rem; font-weight: bold; margin: 1rem 0; color: #1d74f5; }
    a { color: #1d74f5; }
  </style>
</head>
<body>
  <div class="card">
    <h2>OAuth Proxy</h2>
    <p>${label}</p>
    <div class="counter" id="n">${seconds}</div>
    <p>Redirecting to:</p>
    <p><a href="${url}">${url}</a></p>
  </div>
  <script>
    // Bring the popup to the front so the user can see the countdown.
    window.focus();
    let n = ${seconds};
    const el = document.getElementById('n');
    const iv = setInterval(() => {
      n--;
      el.textContent = n;
      if (n <= 0) { clearInterval(iv); location.replace(${JSON.stringify(url)}); }
    }, 1000);
  </script>
</body>
</html>`;
}

// ─── 1. /redirect ────────────────────────────────────────────────────────────
//
// Rocket.Chat client sets:
//   loginUrl = `${proxyHost}/redirect/${encodeURIComponent(originalLoginUrl)}`
//
// We decode and redirect to the OAuth provider.

app.use('/redirect', (req, res) => {
  // req.originalUrl preserves percent-encoding, e.g. /redirect/https%3A%2F%2F…
  const encoded = req.originalUrl.slice('/redirect/'.length);

  if (!encoded) {
    return res.status(400).send('Missing encoded URL after /redirect/');
  }

  let url;
  try {
    url = decodeURIComponent(encoded);
  } catch {
    return res.status(400).send('Malformed encoded URL');
  }

  console.log(`${ts()} [/redirect] → ${url} (delay ${DELAY_MS}ms)`);
  res.send(delayedRedirectPage(url, 'Sending you to the OAuth provider…'));
});

// ─── 2. /oauth_redirect ──────────────────────────────────────────────────────
//
// OAuth provider redirects here with:
//   ?code=AUTH_CODE&state=<encodedOriginalRedirectUri>!<originalState>
//
// The state was constructed by OAuthProxy.ts as:
//   `${redirectUri}!${originalState}`
// where redirectUri is the URL-encoded Rocket.Chat _oauth/<service> endpoint.
//
// After Express URL-decodes the query string we get:
//   state = "https://myrocket.chat/_oauth/github!<originalState>"
//
// We split on the FIRST '!' to recover both parts.

app.get('/oauth_redirect', (req, res) => {
  const { code, error, error_description: errorDescription } = req.query;
  const state = req.query.state;

  if (!state) {
    return res.status(400).send('Missing state parameter');
  }

  const sep = state.indexOf('!');
  if (sep === -1) {
    return res
      .status(400)
      .send('Invalid state format – expected "<redirectUri>!<originalState>"');
  }

  const redirectUri = state.slice(0, sep);        // e.g. https://myrocket.chat/_oauth/github
  const originalState = state.slice(sep + 1);     // the original opaque state from Rocket.Chat

  const params = new URLSearchParams();
  if (code)             params.set('code',              code);
  if (error)            params.set('error',             error);
  if (errorDescription) params.set('error_description', errorDescription);
  params.set('state', originalState);

  // redirectUri may already contain a query string (e.g. "?close" added by Meteor)
  // so use '&' as separator in that case to avoid a double '?'.
  const separator = redirectUri.includes('?') ? '&' : '?';
  const callbackUrl = `${redirectUri}${separator}${params.toString()}`;
  console.log(`${ts()} [/oauth_redirect] code=${code ?? '–'} error=${error ?? '–'} → ${callbackUrl} (delay ${DELAY_MS}ms)`);
  res.send(delayedRedirectPage(callbackUrl, 'Sending you back to Rocket.Chat…'));
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'oauth-proxy', port: PORT });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`${ts()} OAuth proxy server listening on http://localhost:${PORT}`);
  console.log('');
  console.log('Configure Rocket.Chat admin settings:');
  console.log(`  Accounts > OAuth > Proxy Host    → http://localhost:${PORT}`);
  console.log('  Accounts > OAuth > Proxy Services → comma-separated service names');
  console.log('                                      e.g. github,google,gitlab');
});
