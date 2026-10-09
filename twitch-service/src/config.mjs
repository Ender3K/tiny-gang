export function readConfig(env = process.env) {
  const required = ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'FIREBASE_SERVICE_ACCOUNT_JSON', 'TOKEN_ENCRYPTION_KEY'];
  for (const name of required) if (!env[name]) throw new Error(`Missing ${name}. See twitch-service/README.md.`);
  const base = new URL(env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || 'http://localhost:8787');
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('PUBLIC_URL must be the service origin.');
  if (base.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw new Error('PUBLIC_URL must use HTTPS outside local development.');
  const origins = (env.APP_ORIGINS || 'https://ender3k.github.io').split(',').map(s => s.trim());
  for (const origin of origins) if (new URL(origin).origin !== origin || !/^https?:/.test(origin)) throw new Error('APP_ORIGINS must contain exact origins, without paths.');
  let serviceAccount;
  try { serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); } catch { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must be a service-account JSON object.'); }
  if (!serviceAccount.private_key || !serviceAccount.client_email || !serviceAccount.project_id) throw new Error('Incomplete Firebase service-account configuration.');
  if (env.TOKEN_ENCRYPTION_KEY.length < 32) throw new Error('TOKEN_ENCRYPTION_KEY must contain at least 32 characters.');
  return {clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET, publicUrl: base.origin, origins,
    redirectUri: base.origin + '/auth/twitch/callback', serviceAccount,
    databaseUrl: env.FIREBASE_DATABASE_URL || 'https://smash-or-pass-bb76b-default-rtdb.europe-west1.firebasedatabase.app',
    encryptionKey: env.TOKEN_ENCRYPTION_KEY, vaultPath: env.TOKEN_STORE_PATH || './data/twitch-tokens.json',
    port: Number(env.PORT || 8787), host: env.BIND_ADDRESS || '0.0.0.0'};
}
