const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { eventId, eventBody, assertion, sync, applyEvent } = require('./calendar.cjs');
const env = { RESERVEID: '42', NAME: '番組', CHANNELNAME: '放送局', STARTAT: '1792400400000', ENDAT: '1792404000000' };

test('stable IDs, separate instances, valid dates, input validation', () => {
  assert.match(eventId(env), /^[0-9a-v]{5,1024}$/);
  assert.equal(eventId(env), eventId({ ...env, NAME: '変更' }));
  assert.notEqual(eventId(env), eventId({ ...env, GOOGLE_CALENDAR_INSTANCE: 'other' }));
  assert.equal(eventBody(env).start.timeZone, 'Asia/Tokyo');
  assert.equal(eventBody(env).location, '放送局');
  assert.equal(eventBody({ ...env, CHANNELNAME: '', CHANNELID: '123' }).location, '123');
  assert.equal(eventBody({ ...env, CHANNELNAME: '' }).location, '不明');
  assert.throws(() => eventBody({ ...env, ENDAT: env.STARTAT }));
  assert.throws(() => eventId({}));
});

test('OAuth assertion is signed correctly and has a bounded lifetime', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = assertion({ type: 'service_account', client_email: 'test@example.invalid', private_key: privateKey }, 1000);
  const [header, claims, signature] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(claims, 'base64url')).exp, 4600);
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, 'base64url')));
});

test('create, update, missing delete, conflict and API error handling without network', async () => {
  for (const [action, statuses, methods] of [
    ['add', [404, 200], ['PATCH', 'POST']],
    ['update', [200], ['PATCH']],
    ['add', [404, 409, 200], ['PATCH', 'POST', 'PATCH']],
    ['delete', [404], ['DELETE']], ['delete', [410], ['DELETE']],
  ]) {
    const calls = [];
    await applyEvent(action, 'calendar@example.invalid', eventId(env), eventBody(env), 'test-token', async (url, options) => {
      assert.ok(url.startsWith('https://www.googleapis.com/calendar/v3/calendars/calendar%40example.invalid/events'));
      calls.push(options.method);
      return new Response(null, { status: statuses.shift() });
    });
    assert.deepEqual(calls, methods);
  }
  await assert.rejects(applyEvent('update', 'id', eventId(env), eventBody(env), 'test', async () => new Response(null, { status: 403 })), /403/);
  await sync('add', {}, () => assert.fail('disabled integration must not send'));
  await sync('delete', { ...env, GOOGLE_CALENDAR_ID: 'test' }, () => assert.fail('completed event must be retained'));
});
