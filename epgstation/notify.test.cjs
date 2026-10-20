const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const { buildPayload, send } = require('./notify.cjs');

test('recording results distinguish missing counters, warnings and failures', () => {
  const env = { NAME: '番組 @everyone', CHANNELNAME: '放送局', STARTAT: '1792400400000', ENDAT: '1792404000000' };
  assert.equal(buildPayload('start', env).embeds[0].description, '録画開始');
  assert.deepEqual(buildPayload('start', env).allowed_mentions, { parse: [] });
  assert.match(buildPayload('finish', env).embeds[0].fields[3].value, /未取得/);
  const zero = { ...env, ERROR_CNT: '0', DROP_CNT: '0', SCRAMBLING_CNT: '0' };
  assert.equal(buildPayload('finish', zero).embeds[0].color, 0x2ecc71);
  assert.equal(buildPayload('finish', { ...zero, DROP_CNT: '4' }).embeds[0].color, 0xf39c12);
  assert.equal(buildPayload('finish', { ...zero, ERROR_CNT: 'null' }).embeds[0].fields[4].value, '不明');
  for (const event of ['failed', 'prep-failed']) assert.equal(buildPayload(event, zero).embeds[0].color, 0xe74c3c);
  assert.equal(buildPayload('start', { NAME: 'a'.repeat(300) }).embeds[0].title.length, 256);
});

test('disabled webhook does not send; HTTP request and retry use local mock only', async () => {
  await send('start', {});
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      assert.equal(req.method, 'POST');
      assert.equal(JSON.parse(body).embeds[0].description, '録画終了');
      calls++;
      res.writeHead(calls === 1 ? 429 : 204, { 'Retry-After': '0' });
      res.end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await send('finish', { DISCORD_WEBHOOK_URL: `http://127.0.0.1:${server.address().port}/` });
    assert.equal(calls, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
