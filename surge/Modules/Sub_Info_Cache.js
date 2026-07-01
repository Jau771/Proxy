/*
 * Surge subscription traffic panel with stale-if-error cache.
 * It keeps the last successful subscription-userinfo result per slot/name and
 * never prints the subscription URL in panel errors.
 */

const SLOT_SEPARATOR = '<<SurgePanelSlot>>';
const FIELD_SEPARATOR = '<<SurgePanelField>>';
const MAX_SUBSCRIPTIONS = 10;
const CACHE_PREFIX = 'sub_info_cache_v1';
const REQUEST_PROFILES = [
  {
    method: 'head',
    headers: {
      'User-Agent': 'Quantumult%20X/1.5.2',
      Accept: '*/*',
    },
  },
  {
    method: 'get',
    headers: {
      'User-Agent': 'clash-verge-rev/2.3.1',
      Accept: 'application/x-yaml,text/plain,*/*',
      'Profile-Update-Interval': '24',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  },
  {
    method: 'get',
    headers: {
      'User-Agent': 'clash-verge/v2.0.0',
      Accept: 'application/x-yaml,text/plain,*/*',
      'Profile-Update-Interval': '24',
    },
  },
  {
    method: 'get',
    headers: {
      'User-Agent': 'mihomo/1.19.3',
      Accept: 'application/x-yaml,text/plain,*/*',
      'Profile-Update-Interval': '24',
    },
  },
];

const rawArgument = typeof $argument === 'string' ? $argument.trim() : '';

(async () => {
  const context = parseArguments(rawArgument);
  const slots = context.slots.filter((slot) => slot.url).slice(0, MAX_SUBSCRIPTIONS);

  if (!slots.length) {
    $done({
      title: buildPanelTitle(context),
      content: '请至少填写一个机场订阅链接。',
      icon: 'paperplane.circle.fill',
      'icon-color': '#007AFF',
    });
    return;
  }

  const sections = [];
  for (let index = 0; index < slots.length; index += 1) {
    sections.push(await buildPanelSection(slots[index], index + 1));
  }

  $done({
    title: buildPanelTitle(context),
    content: sections.join('\n\n'),
    icon: 'paperplane.circle.fill',
    'icon-color': '#007AFF',
  });
})();

function parseArguments(argument) {
  const fallback = {
    panelTitle: '机场订阅流量',
    hideUpdateTime: false,
    slots: [],
  };

  if (!argument) return fallback;

  const payloadIndex = argument.indexOf('payload=');
  if (payloadIndex !== -1) {
    const metaPart = payloadIndex > 0 ? argument.slice(0, payloadIndex - 1) : '';
    const metaParams = parseKeyValueArgument(metaPart);
    const payload = argument.slice(payloadIndex + 'payload='.length);
    const slots = parseSlotPayload(payload);
    return {
      panelTitle: normalizePanelTitle(metaParams.panel_title) || fallback.panelTitle,
      hideUpdateTime: isOnValue(metaParams.hide_update_time),
      slots,
    };
  }

  const params = parseKeyValueArgument(argument);
  const slots = [];
  for (let index = 1; index <= MAX_SUBSCRIPTIONS; index += 1) {
    slots.push({
      name: sanitizeTemplateValue(params[`name${index}`] || params[`NAME${index}`] || params[`机场名称${index}`] || ''),
      url: sanitizeTemplateValue(params[`url${index}`] || params[`URL${index}`] || params[`订阅链接${index}`] || ''),
      resetDay: sanitizeTemplateValue(params[`resetDay${index}`] || params[`RESET${index}`] || params[`重置日${index}`] || ''),
    });
  }

  return {
    panelTitle: normalizePanelTitle(params.panel_title) || fallback.panelTitle,
    hideUpdateTime: isOnValue(params.hide_update_time),
    slots,
  };
}

function parseSlotPayload(payload) {
  if (!payload) return [];
  return payload
    .split(SLOT_SEPARATOR)
    .map((entry) => {
      const [name = '', url = '', resetDay = ''] = entry.split(FIELD_SEPARATOR);
      return {
        name: sanitizeTemplateValue(name),
        url: sanitizeTemplateValue(url),
        resetDay: sanitizeTemplateValue(resetDay),
      };
    })
    .filter((slot) => slot.name || slot.url || slot.resetDay);
}

function parseKeyValueArgument(argument) {
  const result = {};
  const matcher = /(?:^|&)([^=&]+)=([^&]*)/g;
  let match;

  while ((match = matcher.exec(argument))) {
    result[match[1]] = safeDecode(match[2]);
  }

  return result;
}

function safeDecode(value) {
  if (typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

function sanitizeTemplateValue(value) {
  const decoded = safeDecode(value).trim();
  if (/^\{\{\{[^}]+\}\}\}$/.test(decoded)) return '';
  if (/^机场\d+$/i.test(decoded)) return '';
  if (/^订阅链接\d+$/i.test(decoded)) return '';
  if (/^重置日\d+$/i.test(decoded)) return '';
  return decoded;
}

function normalizePanelTitle(value) {
  return typeof value === 'string' ? safeDecode(value).trim() : '';
}

function isOnValue(value) {
  return String(value || '').trim().toLowerCase() === 'on';
}

function buildPanelTitle(context) {
  const parts = [];
  if (context.panelTitle) parts.push(context.panelTitle);
  if (!context.hideUpdateTime) parts.push(formatClock(new Date()));
  return parts.join(' | ');
}

async function buildPanelSection(slot, index) {
  const name = slot.name || inferNameFromUrl(slot.url);
  const resetDay = normalizeResetDay(slot.resetDay);
  const cacheKey = buildCacheKey(index, name);
  const cached = readCache(cacheKey);

  try {
    const info = await fetchSubscriptionInfo(slot.url);
    const data = {
      name,
      upload: Number(info.upload || 0),
      download: Number(info.download || 0),
      total: Number(info.total || 0),
      expire: Number(info.expire || 0),
      resetDay,
      updatedAt: Date.now(),
    };
    writeCache(cacheKey, data);
    return formatPanelSection(data, false);
  } catch (_) {
    if (cached) {
      return formatPanelSection({
        ...cached,
        name,
        resetDay,
      }, true);
    }
    return `${name}\n获取失败（无缓存）`;
  }
}

async function fetchSubscriptionInfo(url) {
  const attempts = buildRequestAttempts(url);

  for (const attempt of attempts) {
    try {
      const userInfo = await requestUserInfo(attempt);
      if (userInfo) return parseSubscriptionUserInfo(userInfo);
    } catch (_) {}
  }

  throw new Error('request failed');
}

function buildRequestAttempts(url) {
  const attempts = [];
  for (const variant of buildUrlVariants(url)) {
    for (const profile of REQUEST_PROFILES) {
      attempts.push({
        url: variant,
        method: profile.method,
        headers: profile.headers,
      });
    }
  }
  return attempts;
}

function buildUrlVariants(url) {
  const variants = [];
  const seen = {};
  const append = (candidate) => {
    if (!candidate || seen[candidate]) return;
    seen[candidate] = true;
    variants.push(candidate);
  };

  append(url);
  append(withQueryParam(url, 'flag', 'clash'));
  append(withQueryParam(url, 'flag', 'meta'));
  append(withQueryParam(url, 'target', 'clash'));
  append(withQueryParam(url, 'target', 'clash-meta'));
  append(withQueryParam(url, 'client', 'clash-verge-rev'));

  return variants;
}

function withQueryParam(url, key, value) {
  if (!url || !isLikelyUrl(url)) return '';
  if (new RegExp(`([?&])${escapeRegExp(key)}=`).test(url)) return url;
  return `${url}${url.indexOf('?') === -1 ? '?' : '&'}${key}=${encodeURIComponent(value)}`;
}

function requestUserInfo(request) {
  return new Promise((resolve, reject) => {
    const client = $httpClient[request.method];
    if (typeof client !== 'function') {
      reject(new Error('unsupported method'));
      return;
    }

    client(
      {
        url: request.url,
        headers: request.headers,
      },
      (error, response) => {
        if (error || !response) {
          reject(new Error('empty response'));
          return;
        }

        if (response.status < 200 || response.status >= 400) {
          reject(new Error(`HTTP ${response.status}`));
          return;
        }

        const headerKey = Object.keys(response.headers || {}).find(
          (key) => key.toLowerCase() === 'subscription-userinfo'
        );

        if (!headerKey || !response.headers[headerKey]) {
          reject(new Error('subscription-userinfo missing'));
          return;
        }

        resolve(response.headers[headerKey]);
      }
    );
  });
}

function parseSubscriptionUserInfo(headerValue) {
  const pairs = String(headerValue).match(/\w+=[\d.eE+-]+/g) || [];
  if (!pairs.length) throw new Error('subscription-userinfo missing');
  return Object.fromEntries(
    pairs.map((item) => {
      const [key, value] = item.split('=');
      return [key, Number(value)];
    })
  );
}

function formatPanelSection(data, stale) {
  const used = Number(data.upload || 0) + Number(data.download || 0);
  const total = Number(data.total || 0);
  const percent = total > 0 ? `${((used / total) * 100).toFixed(1)}%` : '--';
  const lines = [
    data.name,
    `已用：${bytesToSize(used)} / ${bytesToSize(total)} (${percent})`,
  ];

  if (data.expire) {
    lines.push(`到期：${formatDate(data.expire)}`);
  }

  if (data.resetDay) {
    lines.push(`重置：剩余 ${getRemainingDays(data.resetDay)} 天`);
  }

  if (stale && data.updatedAt) {
    lines.push(`缓存：${formatClock(new Date(data.updatedAt))}`);
  }

  return lines.join('\n');
}

function readCache(key) {
  const raw = $persistentStore.read(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(Number(parsed.total))) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function writeCache(key, data) {
  $persistentStore.write(JSON.stringify(data), key);
}

function buildCacheKey(index, name) {
  return `${CACHE_PREFIX}_${index}_${stableHash(name || `slot-${index}`)}`;
}

function stableHash(input) {
  const text = String(input || '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeResetDay(value) {
  const resetDay = parseInt(value, 10);
  return Number.isFinite(resetDay) && resetDay > 0 && resetDay <= 31 ? resetDay : null;
}

function inferNameFromUrl(url) {
  const matched = String(url).match(/^https?:\/\/([^\/?#]+)/i);
  return matched ? matched[1] : '未命名订阅';
}

function isLikelyUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function getRemainingDays(resetDay) {
  const now = new Date();
  const currentDay = now.getDate();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  let resetDate = new Date(currentYear, currentMonth, resetDay);
  if (currentDay >= resetDay) {
    resetDate = new Date(currentYear, currentMonth + 1, resetDay);
  }

  const delta = resetDate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(delta / (24 * 60 * 60 * 1000)));
}

function bytesToSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, power)).toFixed(power === 0 ? 0 : 2)} ${units[power]}`;
}

function formatDate(expireValue) {
  const timestamp = Number(expireValue);
  const date = new Date(timestamp > 1e12 ? timestamp : timestamp * 1000);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatClock(date) {
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
