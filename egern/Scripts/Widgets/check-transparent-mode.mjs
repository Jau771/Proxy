import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';

const scripts = [
  'Oil_Widget.js',
  'Holiday_Countdown.js',
  'Network-Pro.js',
  'ip-dch.js',
];

function textResponse(body, status = 200, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    headers,
    text: async () => text,
  };
}

function makeContext(env = {}) {
  return {
    env,
    widgetFamily: 'systemMedium',
    storage: {
      getJSON: () => ({
        prices: {
          p92: 8.32,
          p95: 8.92,
          p98: 9.92,
          diesel: 7.95,
        },
        regionName: '德州',
        trendInfo: '6月18日24时调整 ↓ 0.21-0.24',
      }),
      setJSON: () => {},
    },
    device: {
      wifi: { ssid: 'ASUS_18_5G' },
      ipv4: {
        address: '192.168.100.26',
        gateway: '192.168.100.1',
      },
    },
    network: {
      v4: {
        primaryAddress: '192.168.100.26',
        primaryRouter: '192.168.100.1',
      },
    },
    http: {
      get: async (url) => mockGet(url),
      post: async (url) => mockPost(url),
    },
  };
}

function mockGet(url) {
  if (url.includes('myip.ipip.net/json')) {
    return textResponse({
      data: {
        ip: '60.211.79.177',
        location: ['中国', '山东', '德州', '', '中国联通'],
      },
    });
  }

  if (url.includes('ip-api.com/json')) {
    return textResponse({
      query: '149.88.189.115',
      countryCode: 'JP',
      country: 'Japan',
      city: 'Osaka',
      isp: 'AWS',
      org: 'AWS',
    });
  }

  if (url.includes('my.ippure.com/v1/info')) {
    return textResponse({
      ip: '149.88.189.115',
      countryCode: 'JP',
      country: 'Japan',
      city: 'Osaka',
      isResidential: false,
      fraudScore: 30,
    });
  }

  if (url.includes('api.ipapi.is')) {
    return textResponse({
      company: {
        abuser_score: '0.0086 (Elevated)',
      },
    });
  }

  if (url.includes('chatgpt.com/cdn-cgi/trace')) {
    return textResponse('loc=JP\n');
  }

  if (url.includes('ios.chat.openai.com')) {
    return textResponse({ cf_details: '' });
  }

  if (url.includes('youtube.com/premium')) {
    return textResponse('Ad-free "contentRegion":"JP"');
  }

  if (url.includes('netflix.com/title')) {
    return textResponse('"countryCode":"JP"');
  }

  if (url.includes('tiktok.com')) {
    return textResponse('"region":"JP"');
  }

  return textResponse('OK');
}

function mockPost(url) {
  if (url.includes('gemini.google.com')) {
    return textResponse('"countryCode":"JP"');
  }

  return textResponse('OK');
}

function findFirstText(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'text' && predicate(node)) return node;
  for (const key of ['children']) {
    if (Array.isArray(node[key])) {
      for (const child of node[key]) {
        const found = findFirstText(child, predicate);
        if (found) return found;
      }
    }
  }
  return null;
}

function findFirstStack(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'stack' && predicate(node)) return node;
  for (const key of ['children']) {
    if (Array.isArray(node[key])) {
      for (const child of node[key]) {
        const found = findFirstStack(child, predicate);
        if (found) return found;
      }
    }
  }
  return null;
}

async function loadWidget(fileName) {
  const url = new URL(fileName, import.meta.url);
  const source = await readFile(url, 'utf8');
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}

for (const fileName of scripts) {
  const { default: renderWidget } = await loadWidget(fileName);
  assert.equal(typeof renderWidget, 'function', `${fileName} must export a widget function`);

  const transparentWidget = await renderWidget(makeContext({ TRANSPARENT_MODE: 'true' }));
  assert.equal(transparentWidget.type, 'widget', `${fileName} must return a widget`);
  assert.ok(
    !Object.hasOwn(transparentWidget, 'backgroundColor'),
    `${fileName} must omit root backgroundColor when TRANSPARENT_MODE=true`,
  );

  if (fileName === 'Oil_Widget.js') {
    const priceText = findFirstText(transparentWidget, (node) => /^\d+\.\d{2}$/.test(String(node.text)));
    assert.ok(priceText, 'Oil_Widget.js must render a numeric price in transparent mode');
    const titleText = findFirstText(transparentWidget, (node) => /实时油价/.test(String(node.text)));
    assert.ok(titleText, 'Oil_Widget.js must render the title in transparent mode');
    const priceRow = findFirstStack(transparentWidget, (node) => node.direction === 'row' && Array.isArray(node.children) && node.children.length === 4);
    assert.ok(priceRow, 'Oil_Widget.js must render a four-column price row in transparent mode');
  }

  const normalWidget = await renderWidget(makeContext());
  assert.equal(normalWidget.type, 'widget', `${fileName} must render without TRANSPARENT_MODE`);
}

console.log('transparent mode checks passed');
