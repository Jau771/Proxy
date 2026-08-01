/*
 * Rewrite Bilibili playurl media hosts for Surge iOS/Mac.
 * The original primary and backup URLs remain in the fallback list.
 */

(function () {
  "use strict";

  var DEFAULT_CDN = "cn-hk-eq-01-09.bilivideo.com";
  var DEFAULT_BACKUP_CDN = "cn-hk-eq-01-13.bilivideo.com";
  var ARGUMENT = parseArguments();
  var LOG_LEVEL = normalizeLogLevel(ARGUMENT.log_level || "WARN");
  var stats = { tracks: 0, primary: 0, backup: 0 };

  function parseArguments() {
    var raw = typeof $argument === "string" ? $argument : "";
    var output = {};
    raw.split("&").forEach(function (pair) {
      if (!pair) return;
      var index = pair.indexOf("=");
      var key = index >= 0 ? pair.slice(0, index) : pair;
      var value = index >= 0 ? pair.slice(index + 1) : "";
      if (!key) return;
      output[safeDecode(key.trim())] = safeDecode(value.trim());
    });
    return output;
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  }

  function normalizeLogLevel(value) {
    var level = String(value || "WARN").trim().toUpperCase();
    return ["ERROR", "WARN", "INFO", "DEBUG"].indexOf(level) >= 0
      ? level
      : "WARN";
  }

  function shouldLog(level) {
    var order = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
    return order[level] <= order[LOG_LEVEL];
  }

  function log(level, message) {
    if (shouldLog(level) && typeof console !== "undefined") {
      console.log("[Bilibili CDN] " + level + " " + message);
    }
  }

  function isEnabled() {
    var value = String(ARGUMENT.enabled || "true").trim().toLowerCase();
    return ["0", "false", "off", "no"].indexOf(value) < 0;
  }

  function normalizeTarget(value, fallback) {
    var target = String(value || fallback || "").trim();
    if (/^(?:original|base|off|none)$/i.test(target)) return "";
    target = target.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
    // Host-only targets prevent accidental path, query, or credential rewrites.
    if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(target)) return "";
    return target;
  }

  function isCandidateMediaUrl(value) {
    if (typeof value !== "string" || !/^https?:\/\//i.test(value)) {
      return false;
    }
    var host = value.match(/^https?:\/\/([^/]+)/i);
    if (!host) return false;
    var hostname = host[1].replace(/:\d+$/, "").toLowerCase();
    // Akamai URLs may carry an hdnts token bound to the original host.
    if (/\.akamaized\.net$/i.test(hostname)) return false;
    return (
      /(?:^|\.)bilivideo\.(?:com|cn)$/i.test(hostname) ||
      /(?:^|\.)mcdn\.bilivideo\.cn$/i.test(hostname) ||
      /(?:^|\.)acgvideo\.com$/i.test(hostname) ||
      /(?:^|\.)hdslb\.com$/i.test(hostname)
    );
  }

  function replaceHost(value, target) {
    if (!target || !isCandidateMediaUrl(value)) return value;
    return value.replace(/^https?:\/\/[^/]+/i, "https://" + target);
  }

  function unique(values) {
    var seen = {};
    return values.filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function readFirst(track, names) {
    for (var i = 0; i < names.length; i += 1) {
      if (typeof track[names[i]] === "string" && track[names[i]]) {
        return { name: names[i], value: track[names[i]] };
      }
    }
    return null;
  }

  function readBackups(track) {
    var names = ["backupUrl", "backup_url"];
    for (var i = 0; i < names.length; i += 1) {
      if (Array.isArray(track[names[i]])) {
        return { name: names[i], values: track[names[i]].filter(function (url) {
          return typeof url === "string" && url;
        }) };
      }
    }
    return { name: "backupUrl", values: [] };
  }

  function writePrimary(track, name, value) {
    track[name] = value;
    if (name === "baseUrl" && Object.prototype.hasOwnProperty.call(track, "base_url")) {
      track.base_url = value;
    }
    if (name === "base_url" && Object.prototype.hasOwnProperty.call(track, "baseUrl")) {
      track.baseUrl = value;
    }
  }

  function rewriteTrack(track, primaryTarget, backupTarget) {
    if (!track || typeof track !== "object") return false;
    var primary = readFirst(track, ["baseUrl", "base_url", "url"]);
    var backup = readBackups(track);
    if (!primary) return false;

    var changed = false;
    var rewrittenPrimary = replaceHost(primary.value, primaryTarget);
    if (rewrittenPrimary !== primary.value) {
      stats.primary += 1;
      changed = true;
    }

    var fallbackUrls = [];
    backup.values.forEach(function (url) {
      var rewritten = replaceHost(url, backupTarget);
      if (rewritten !== url) {
        stats.backup += 1;
        changed = true;
      }
      fallbackUrls.push(rewritten, url);
    });
    fallbackUrls.push(primary.value);

    if (!changed) return false;
    stats.tracks += 1;
    writePrimary(track, primary.name, rewrittenPrimary);
    track[backup.name] = unique(fallbackUrls.filter(function (url) {
      return url !== rewrittenPrimary;
    }));
    if (backup.name === "backupUrl" && Object.prototype.hasOwnProperty.call(track, "backup_url")) {
      track.backup_url = track.backupUrl.slice();
    }
    if (backup.name === "backup_url" && Object.prototype.hasOwnProperty.call(track, "backupUrl")) {
      track.backupUrl = track.backup_url.slice();
    }
    return true;
  }

  function rewriteTrackList(list, primaryTarget, backupTarget) {
    if (!Array.isArray(list)) return false;
    var changed = false;
    list.forEach(function (track) {
      if (rewriteTrack(track, primaryTarget, backupTarget)) changed = true;
    });
    return changed;
  }

  function rewriteContainer(container, primaryTarget, backupTarget) {
    if (!container || typeof container !== "object") return false;
    var changed = false;
    var dash = container.dash;
    if (dash && typeof dash === "object") {
      changed = rewriteTrackList(dash.video, primaryTarget, backupTarget) || changed;
      changed = rewriteTrackList(dash.audio, primaryTarget, backupTarget) || changed;
      if (dash.dolby) {
        changed = rewriteTrackList(dash.dolby.audio, primaryTarget, backupTarget) || changed;
      }
      if (dash.flac && dash.flac.audio) {
        changed = rewriteTrack(dash.flac.audio, primaryTarget, backupTarget) || changed;
      }
    }
    changed = rewriteTrackList(container.durl, primaryTarget, backupTarget) || changed;
    return changed;
  }

  function finish(value) {
    if (typeof $done === "function") $done(value);
  }

  function main() {
    if (!isEnabled()) {
      finish({});
      return;
    }

    var primaryTarget = normalizeTarget(ARGUMENT.cdn, DEFAULT_CDN);
    var backupTarget = normalizeTarget(ARGUMENT.cdn_backup, DEFAULT_BACKUP_CDN);
    if (!primaryTarget) {
      log("INFO", "primary rewrite disabled");
      finish({});
      return;
    }

    var body = $response && $response.body;
    if (typeof body !== "string" || !body) {
      finish({});
      return;
    }

    var payload;
    try {
      payload = JSON.parse(body);
    } catch (_) {
      log("DEBUG", "response is not JSON");
      finish({});
      return;
    }
    if (!payload || (payload.code !== undefined && payload.code !== 0)) {
      finish({});
      return;
    }

    var container = payload.data || payload.result;
    if (!rewriteContainer(container, primaryTarget, backupTarget)) {
      finish({});
      return;
    }

    log(
      "INFO",
      "rewrote tracks=" + stats.tracks +
        " primary=" + stats.primary +
        " backup=" + stats.backup
    );
    try {
      finish({ body: JSON.stringify(payload) });
    } catch (_) {
      log("ERROR", "failed to serialize rewritten response");
      finish({});
    }
  }

  try {
    main();
  } catch (error) {
    log("ERROR", "unexpected script error");
    finish({});
  }
})();
