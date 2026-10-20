// Reservation synchronization to a calendar shared with a service account.
const fs = require('node:fs');
const { createHash, sign } = require('node:crypto');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function eventId(env) {
  if (!/^\d+$/.test(env.RESERVEID || '')) throw new Error('Missing reservation ID');
  const instance = env.GOOGLE_CALENDAR_INSTANCE || 'dtv-hub';
  return 'dtv' + createHash('sha256').update(`${instance}:${env.RESERVEID}`).digest('hex');
}

function eventBody(env) {
  const dates = [env.STARTAT, env.ENDAT].map(value => {
    if (!/^\d+$/.test(value || '')) throw new Error('Invalid reservation time');
    return new Date(Number(value)).toISOString();
  });
  if (dates[1] <= dates[0]) throw new Error('Invalid reservation interval');
  return {
    id: eventId(env),
    summary: (env.NAME || '録画予約').slice(0, 1000),
    description: `EPGStation 録画予約 #${env.RESERVEID}\n放送局: ${env.CHANNELNAME || env.CHANNELID || '不明'}`,
    start: { dateTime: dates[0], timeZone: 'Asia/Tokyo' },
    end: { dateTime: dates[1], timeZone: 'Asia/Tokyo' },
    extendedProperties: { private: { dtvHubReservation: env.RESERVEID } },
  };
}

function assertion(key, now = Math.floor(Date.now() / 1000)) {
  if (key.type !== 'service_account' || !key.client_email || !key.private_key) throw new Error('Invalid credentials');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({
    iss: key.client_email, scope: 'https://www.googleapis.com/auth/calendar.events',
    aud: TOKEN_URL, iat: now, exp: now + 3600,
  });
  return body + '.' + sign('RSA-SHA256', Buffer.from(body), key.private_key).toString('base64url');
}

async function sync(action, env = process.env, request = fetch) {
  const calendar = env.GOOGLE_CALENDAR_ID?.trim();
  if (!calendar) return;
  if (!['add', 'update', 'delete'].includes(action)) throw new Error('Invalid calendar action');
  const id = eventId(env);
  // Leave completed reservations in the calendar as a schedule history.
  if (action === 'delete' && /^\d+$/.test(env.ENDAT || '') && Number(env.ENDAT) <= Date.now()) return;
  const body = action === 'delete' ? null : eventBody(env);
  const key = JSON.parse(fs.readFileSync('/app/secrets/google-calendar.json', 'utf8'));
  const tokenResponse = await request(TOKEN_URL, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion(key) }),
  });
  if (!tokenResponse.ok) { await tokenResponse.body?.cancel(); throw new Error(`OAuth HTTP ${tokenResponse.status}`); }
  const token = (await tokenResponse.json()).access_token;
  if (typeof token !== 'string' || !token) throw new Error('Missing access token');
  return applyEvent(action, calendar, id, body, token, request);
}

async function applyEvent(action, calendar, id, body, token, request = fetch) {
  const root = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar)}/events`;
  async function call(method, url, data) {
    const response = await request(url + '?sendUpdates=none', {
      method, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    await response.body?.cancel();
    return response.status;
  }
  let status;
  if (action === 'delete') {
    status = await call('DELETE', `${root}/${id}`);
    if ([404, 410].includes(status)) return;
  } else {
    const { id: unused, ...changes } = body;
    status = await call('PATCH', `${root}/${id}`, changes);
    if (status === 404) {
      status = await call('POST', root, body);
      if (status === 409) status = await call('PATCH', `${root}/${id}`, changes);
    }
  }
  if (status < 200 || status >= 300) throw new Error(`Calendar HTTP ${status}`);
}

if (require.main === module) {
  sync(process.argv[2]).catch(() => {
    // Do not expose private keys, access tokens, calendar IDs or API responses.
    console.error('[dtv-hub calendar] synchronization failed; check credentials, sharing and API availability');
    process.exitCode = 1;
  });
}
module.exports = { eventId, eventBody, assertion, sync, applyEvent };
