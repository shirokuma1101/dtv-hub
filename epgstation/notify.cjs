// EPGStation recording hooks -> Discord. No third-party dependencies.
const EVENTS = {
  start: ['録画開始', 0x2ecc71],
  finish: ['録画終了', 0x95a5a6],
  failed: ['録画中エラー', 0xe74c3c],
  'prep-failed': ['録画準備失敗', 0xe74c3c],
};

function counter(value) {
  return /^\d+$/.test(value || '') && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

function time(value) {
  if (!/^\d+$/.test(value || '')) return '不明';
  const date = new Date(Number(value)); // EPGStation passes milliseconds.
  return Number.isNaN(date.getTime()) ? '不明' : date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false }) + ' JST';
}

function buildPayload(event, env) {
  if (!EVENTS[event]) throw new Error('Unknown recording event');
  const [label, initialColor] = EVENTS[event];
  let color = initialColor;
  const fields = [];
  const field = (name, value, inline = false) => fields.push({ name, value: String(value).slice(0, 1024), inline });
  field('放送局', env.CHANNELNAME || env.CHANNELID || '不明');
  field('開始時刻', time(env.STARTAT), true);
  field('終了時刻', time(env.ENDAT), true);
  if (event !== 'start') {
    const counts = [counter(env.ERROR_CNT), counter(env.DROP_CNT), counter(env.SCRAMBLING_CNT)];
    let result = '失敗';
    if (event === 'finish') {
      if (counts.some(value => value !== null && value > 0)) {
        result = '終了（エラー／ドロップ／スクランブルあり）';
        color = 0xf39c12;
      } else if (counts.every(value => value === 0)) {
        result = '終了（カウンター上の異常なし）';
        color = 0x2ecc71;
      } else {
        result = '終了（品質カウンター未取得）';
      }
    }
    field('結果', result);
    ['エラー', 'ドロップ', 'スクランブル'].forEach((name, i) => field(name, counts[i] ?? '不明', true));
  }
  if (env.RECORDEDID) field('録画ID', env.RECORDEDID);
  // Do not transmit local file paths, descriptions or arbitrary environment values.
  return {
    username: 'EPGStation',
    allowed_mentions: { parse: [] },
    embeds: [{ author: { name: 'dtv-hub' }, title: (env.NAME || '番組名不明').slice(0, 256), description: label, color, fields }],
  };
}

async function send(event, env = process.env) {
  const endpoint = env.DISCORD_WEBHOOK_URL?.trim();
  if (!endpoint) return; // Disabled by default.
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid webhook protocol');
  const body = JSON.stringify(buildPayload(event, env));
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    // Never print response bodies or URLs (the URL contains a secret token).
    await response.body?.cancel();
    if (response.ok) return;
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      const delay = Number(response.headers.get('retry-after') || 1);
      if (Number.isFinite(delay) && delay >= 0 && delay <= 2) {
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
        continue;
      }
    }
    throw new Error(`HTTP ${response.status}`);
  }
}

if (require.main === module) {
  send(process.argv[2]).catch(error => {
    const status = /^HTTP \d+$/.test(error.message) ? error.message : 'request failed';
    console.error(`[dtv-hub webhook] ${status}`);
    process.exitCode = 1;
  });
}
module.exports = { buildPayload, send };
