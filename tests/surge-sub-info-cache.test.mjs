import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../surge/Modules/Sub_Info_Cache.js', import.meta.url), 'utf8');

function runScript({
  argument,
  responses = [],
  store = {},
  now = new Date('2026-07-01T05:41:00Z'),
} = {}) {
  const writes = [];
  const requests = [];
  let responseIndex = 0;
  let doneValue;

  const sandbox = {
    $argument: argument,
    $persistentStore: {
      read(key) {
        return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
      },
      write(value, key) {
        writes.push({ key, value });
        store[key] = value;
        return true;
      },
    },
    $httpClient: {
      head(request, callback) {
        requests.push({ method: 'head', request });
        const response = responses[responseIndex++] || { error: 'network down' };
        callback(response.error || null, response.response || null, response.body || '');
      },
      get(request, callback) {
        requests.push({ method: 'get', request });
        const response = responses[responseIndex++] || { error: 'network down' };
        callback(response.error || null, response.response || null, response.body || '');
      },
    },
    $done(value) {
      doneValue = value;
    },
    console,
    Date: class extends Date {
      constructor(...args) {
        if (args.length === 0) return new Date(now);
        return new Date(...args);
      }

      static now() {
        return now.getTime();
      }
    },
    Promise,
    setTimeout,
    clearTimeout,
    encodeURIComponent,
    decodeURIComponent,
    URL,
    URLSearchParams,
  };

  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: 'Sub_Info_Cache.js' });

  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      if (doneValue) {
        resolve({ doneValue, writes, requests, store });
        return;
      }
      if (Date.now() - started > 1000) {
        throw new Error('script did not call $done');
      }
      setTimeout(check, 0);
    };
    check();
  });
}

const baseArgument = [
  'panel_title=机场订阅流量',
  'hide_update_time=on',
  'payload=奶昔<<SurgePanelField>>https://token.example/sub?token=secret<<SurgePanelField>>1',
].join('&');

test('tries clash meta user agent before Quantumult', async () => {
  const { requests } = await runScript({
    argument: baseArgument,
    responses: [
      {
        response: {
          status: 200,
          headers: {
            'subscription-userinfo': 'upload=1; download=1; total=10; expire=1811808000',
          },
        },
      },
    ],
  });

  assert.equal(requests[0].request.headers['User-Agent'], 'clash.meta/1.19.20');
});

test('writes a sanitized cache entry after successful subscription fetch', async () => {
  const { doneValue, writes } = await runScript({
    argument: baseArgument,
    responses: [
      {
        response: {
          status: 200,
          headers: {
            'subscription-userinfo': 'upload=1073741824; download=1073741824; total=10737418240; expire=1811808000',
          },
        },
      },
    ],
  });

  assert.match(doneValue.content, /奶昔/);
  assert.match(doneValue.content, /已用：2\.00 GB \/ 10\.00 GB \(20\.0%\)/);
  assert.equal(writes.length, 1);
  assert.match(writes[0].key, /^sub_info_cache_v1_1_/);
  assert.doesNotMatch(writes[0].key, /secret/);
  assert.doesNotMatch(writes[0].value, /token\.example|secret/);
});

test('uses stale cache when all subscription requests fail', async () => {
  const cache = {
    name: '奶昔',
    upload: 1073741824,
    download: 1073741824,
    total: 10737418240,
    expire: 1811808000,
    resetDay: 1,
    updatedAt: new Date('2026-07-01T04:41:00Z').getTime(),
  };
  const store = {
    sub_info_cache_v1_1_frz2: JSON.stringify(cache),
  };

  const { doneValue } = await runScript({
    argument: baseArgument,
    responses: Array.from({ length: 24 }, () => ({ error: 'TLS failed for https://token.example/sub?token=secret' })),
    store,
  });

  assert.match(doneValue.content, /奶昔/);
  assert.match(doneValue.content, /已用：2\.00 GB \/ 10\.00 GB \(20\.0%\)/);
  assert.match(doneValue.content, /缓存：/);
  assert.doesNotMatch(doneValue.content, /获取失败|token\.example|secret|TLS failed/);
});

test('does not leak subscription URL when there is no cache and requests fail', async () => {
  const { doneValue } = await runScript({
    argument: baseArgument,
    responses: Array.from({ length: 24 }, () => ({ error: 'TLS failed for https://token.example/sub?token=secret' })),
  });

  assert.match(doneValue.content, /奶昔/);
  assert.match(doneValue.content, /获取失败（无缓存）/);
  assert.doesNotMatch(doneValue.content, /token\.example|secret|TLS failed/);
});
