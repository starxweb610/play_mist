/**
 * utils/gpgs.js
 * Server-side verification for Google Play Games Services sign-in.
 *
 * The Android client calls PGS `requestServerSideAccess()` and sends us the
 * resulting one-time **server auth code**. We exchange it for an access token
 * using our OAuth2 *web* client credentials, then read the authoritative player
 * identity from the Play Games API. We never trust a player ID sent directly by
 * the client — only one derived from a code Google issued for our web client.
 *
 * Required env (from the Google Cloud OAuth2 *web application* client linked to
 * the Play Games Services configuration):
 *   GOOGLE_PGS_CLIENT_ID
 *   GOOGLE_PGS_CLIENT_SECRET
 */

const TOKEN_URL   = 'https://oauth2.googleapis.com/token';
const PLAYER_URL  = 'https://www.googleapis.com/games/v1/players/me';

class GpgsError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.reason = reason; // 'config' | 'invalid_code' | 'google' | 'network'
  }
}

/**
 * Exchange a PGS server auth code for the verified player identity.
 * @param {string} authCode one-time server auth code from the Android client
 * @returns {Promise<{ playerId: string, displayName: string|null }>}
 * @throws {GpgsError}
 */
async function verifyServerAuthCode(authCode) {
  const clientId     = process.env.GOOGLE_PGS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_PGS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GpgsError('config', 'GOOGLE_PGS_CLIENT_ID/SECRET not configured');
  }
  if (!authCode || typeof authCode !== 'string') {
    throw new GpgsError('invalid_code', 'Missing auth code');
  }

  // 1. Exchange the server auth code for an access token.
  let tokenRes, tokenJson;
  try {
    tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: authCode,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        // PGS server-side access codes are not tied to a redirect URI.
        redirect_uri: '',
      }),
    });
    tokenJson = await tokenRes.json().catch(() => ({}));
  } catch (err) {
    throw new GpgsError('network', `Token exchange failed: ${err.message}`);
  }
  if (!tokenRes.ok || !tokenJson.access_token) {
    // Google rejected the code (expired/replayed/wrong client).
    throw new GpgsError('invalid_code', tokenJson.error_description || tokenJson.error || 'Token exchange rejected');
  }

  // 2. Read the authoritative player identity.
  let playerRes, player;
  try {
    playerRes = await fetch(PLAYER_URL, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    player = await playerRes.json().catch(() => ({}));
  } catch (err) {
    throw new GpgsError('network', `Player lookup failed: ${err.message}`);
  }
  if (!playerRes.ok || !player.playerId) {
    throw new GpgsError('google', player.error?.message || 'Player lookup rejected');
  }

  return {
    playerId: player.playerId,
    displayName: player.displayName || null,
  };
}

module.exports = { verifyServerAuthCode, GpgsError };
