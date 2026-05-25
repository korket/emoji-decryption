import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { google } from 'googleapis';
import type { Auth } from 'googleapis';

const CREDENTIALS_PATH = 'credentials.json';
const TOKEN_PATH = 'token.json';
const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];
const REDIRECT_PORT = 9005;

function loadCredentials(): { client_id: string; client_secret: string } {
  if (!existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      'credentials.json not found.\n' +
      'Download OAuth 2.0 credentials (Desktop app type) from Google Cloud Console\n' +
      'and save the file as credentials.json in the project root.',
    );
  }
  const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8')) as Record<string, unknown>;
  const c = (raw['installed'] ?? raw['web']) as { client_id: string; client_secret: string } | undefined;
  if (!c?.client_id || !c?.client_secret) throw new Error('credentials.json has unexpected format');
  return { client_id: c.client_id, client_secret: c.client_secret };
}

async function authorizeInteractive(auth: Auth.OAuth2Client): Promise<Auth.Credentials> {
  return new Promise((resolve, reject) => {
    const authUrl = auth.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // ensures refresh_token is returned on first auth
    });

    console.log('\n──────────────────────────────────────────────');
    console.log('YouTube authorization required.');
    console.log('Open this URL in your browser:\n');
    console.log(authUrl);
    console.log('\nWaiting for redirect to localhost...');
    console.log('──────────────────────────────────────────────\n');

    const server = createServer((req, res) => {
      if (!req.url) return;
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      // Ignore browser noise (favicon, preflight, etc.) — wait for the real redirect
      if (!code && !error) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Waiting for OAuth redirect…');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        error
          ? `<h1>Authorization failed: ${error}</h1><p>You can close this tab.</p>`
          : '<h1>Authorized! You can close this tab and return to the terminal.</h1>',
      );
      server.close();

      if (error) { reject(new Error(`Auth denied: ${error}`)); return; }

      auth.getToken(code!).then(({ tokens }) => resolve(tokens)).catch(reject);
    });

    server.on('error', (err) => {
      reject(new Error(`Auth callback server failed on port ${REDIRECT_PORT}: ${err.message}`));
    });

    server.listen(REDIRECT_PORT, '127.0.0.1');
  });
}

export async function getAuthClient(): Promise<Auth.OAuth2Client> {
  const { client_id, client_secret } = loadCredentials();
  const auth = new google.auth.OAuth2(client_id, client_secret, `http://localhost:${REDIRECT_PORT}`);

  // Persist token refreshes automatically
  auth.on('tokens', (tokens) => {
    const existing = existsSync(TOKEN_PATH)
      ? (JSON.parse(readFileSync(TOKEN_PATH, 'utf8')) as Auth.Credentials)
      : {};
    writeFileSync(TOKEN_PATH, JSON.stringify({ ...existing, ...tokens }, null, 2));
  });

  if (existsSync(TOKEN_PATH)) {
    const saved = JSON.parse(readFileSync(TOKEN_PATH, 'utf8')) as Auth.Credentials;
    auth.setCredentials(saved);
    return auth;
  }

  const tokens = await authorizeInteractive(auth);
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  auth.setCredentials(tokens);
  console.log('Authorization successful. Token saved to token.json\n');
  return auth;
}
