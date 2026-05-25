import { getAuthClient } from '../youtube/auth.js';

try {
  const auth = await getAuthClient();
  await auth.getAccessToken();
  console.log('YouTube authorization verified. Token is ready.');
} catch (err) {
  console.error('YouTube authorization failed:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
