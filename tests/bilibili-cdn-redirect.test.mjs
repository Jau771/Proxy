import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const moduleText = fs.readFileSync(
  new URL("../surge/Modules/Bilibili_CDN_Redirect.sgmodule", import.meta.url),
  "utf8",
);

const script = fs.readFileSync(
  new URL("../surge/Modules/Bilibili_CDN_Redirect.js", import.meta.url),
  "utf8",
);

function runScript({ argument = "", payload, request }) {
  let doneValue;
  const sandbox = {
    $argument: argument,
    $done(value) {
      doneValue = value;
    },
    console,
    decodeURIComponent,
  };
  if (request) {
    sandbox.$request = request;
  } else {
    sandbox.$request = { url: "https://api.bilibili.com/x/player/playurl" };
    sandbox.$response = { body: JSON.stringify(payload) };
  }
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: "Bilibili_CDN_Redirect.js" });
  return doneValue;
}

function fixture() {
  return {
    code: 0,
    data: {
      dash: {
        video: [
          {
            baseUrl:
              "https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/video.m4s?upsig=one",
            backupUrl: [
              "https://upos-sz-mirrorhwb.bilivideo.com/upgcxcode/video.m4s?upsig=two",
            ],
          },
        ],
        audio: [
          {
            base_url:
              "https://xy150x139x224x14xy.mcdn.bilivideo.cn:8082/v1/audio.m4s?upsig=bound",
            backup_url: [],
          },
        ],
      },
      durl: [
        {
          url: "https://upos-sz-mirrorhw.bilivideo.com/video.flv?upsig=three",
        },
      ],
    },
  };
}

test("rewrites Bilibili media hosts and keeps original fallback URLs", () => {
  const result = runScript({
    argument:
      "cdn=cn-hk-eq-01-09.bilivideo.com&cdn_backup=cn-hk-eq-01-13.bilivideo.com",
    payload: fixture(),
  });
  const output = JSON.parse(result.body);
  const video = output.data.dash.video[0];
  assert.match(video.baseUrl, /^https:\/\/cn-hk-eq-01-09\.bilivideo\.com\//);
  assert.match(video.backupUrl[0], /^https:\/\/cn-hk-eq-01-13\.bilivideo\.com\//);
  assert.ok(video.backupUrl.some((url) => url.includes("mirrorcosov")));
  assert.match(output.data.durl[0].url, /^https:\/\/cn-hk-eq-01-09\.bilivideo\.com\//);
});

test("does not rewrite Akamai URLs with host-bound tokens", () => {
  const payload = fixture();
  payload.data.dash.audio[0].base_url =
    "https://upos-hz-mirrorakam.akamaized.net/audio.m4s?hdnts=bound";
  const result = runScript({
    argument: "cdn=cn-hk-eq-01-09.bilivideo.com",
    payload,
  });
  const output = JSON.parse(result.body);
  assert.match(output.data.dash.audio[0].base_url, /mirrorakam\.akamaized\.net/);
});

test("returns untouched response when disabled", () => {
  const payload = fixture();
  const result = runScript({ argument: "enabled=false", payload });
  assert.equal(Object.keys(result).length, 0);
});

test("uses iOS-compatible module arguments and Surge placeholders", () => {
  assert.match(
    moduleText,
    /^#!arguments=cdn:[^,]+,cdnBackup:[^,]+,enabled:true,logLevel:INFO$/m,
  );
  assert.match(moduleText, /argument=cdn=\{\{\{cdn\}\}\}/);
  assert.match(moduleText, /cdn_backup=\{\{\{cdnBackup\}\}\}/);
  assert.match(moduleText, /enabled=\{\{\{enabled\}\}\}/);
  assert.match(moduleText, /log_level=\{\{\{logLevel\}\}\}/);
  assert.match(moduleText, /type=http-request/);
  assert.match(moduleText, /\*\.bilivideo\.com/);
});

test("rewrites an actual upgcxcode request and updates Host", () => {
  const originalUrl =
    "https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/video.m4s?upsig=one";
  const result = runScript({
    argument: "cdn=cn-hk-eq-01-09.bilivideo.com",
    request: { url: originalUrl, headers: { Host: "upos-sz-mirrorcosov.bilivideo.com" } },
  });
  assert.match(result.url, /^https:\/\/cn-hk-eq-01-09\.bilivideo\.com\//);
  assert.equal(result.headers.Host, "cn-hk-eq-01-09.bilivideo.com");
  assert.match(result.url, /upsig=one$/);
});

test("keeps Akamai request hosts unchanged", () => {
  const originalUrl =
    "https://upos-hz-mirrorakam.akamaized.net/upgcxcode/video.m4s?hdnts=bound";
  const result = runScript({
    argument: "cdn=cn-hk-eq-01-09.bilivideo.com",
    request: { url: originalUrl, headers: { Host: "upos-hz-mirrorakam.akamaized.net" } },
  });
  assert.equal(Object.keys(result).length, 0);
});
