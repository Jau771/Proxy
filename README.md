# Proxy

Personal proxy config collection, organized per app.

## surge / egern

- `surge/` — Surge configs. `Modules/` for modules, `Rules/` for rule snippets.
- `egern/` — Egern equivalents (`Rules/`).

Rule snippets under `Rules/` are reference/backups for quick copy-paste, not
hosted rule-sets. They keep full policy names so they can be pasted straight
back into a main config. More files will be added over time.

Current snippets:

- `surge/Rules/Telegram-DC.list` — Telegram DC IP mapping reference
- `surge/Rules/Gemini.list` — Gemini supplement for filling gaps in the existing `Extra_AI.list`

## FKTG

Maps selected Telegram `91.108.56.x` IPs to `91.108.56.147` and `91.108.56.201`.

Install URL:

```text
https://raw.githubusercontent.com/Jau771/Proxy/main/surge/Modules/FKTG.sgmodule
```

Notes:

- This module enables `use-local-host-item-for-proxy = true` so proxied requests can use the local `[Host]` IP mappings.
- Use it only if Telegram has connection quality issues. Telegram IP availability may change over time.

## Bilibili CDN Redirect

Files:

- `surge/Modules/Bilibili_CDN_Redirect.sgmodule` — Surge module definition.
- `surge/Modules/Bilibili_CDN_Redirect.js` — `http-response` JSON rewrite script.

The module targets Bilibili playback APIs on `api.bilibili.com` and
`app.bilibili.com`. It rewrites media `baseUrl`/`base_url` hosts and keeps the
original primary and backup URLs in the fallback list. Akamai URLs are left
untouched because their `hdnts` token may be bound to the original host.

Requirements and limitations:

- Surge MITM must be enabled and trusted on the device; the module appends the
  two API hostnames to `[MITM]`.
- On iOS, install the latest module after updates. The parameter table uses the
  iOS-compatible `key:value,key:value` form, and the module forwards values
  with Surge's `{{{parameter}}}` placeholders.
- The Bilibili app traffic must actually pass through Surge. Certificate
  pinning or a changed playback endpoint can prevent the script from running.
- CDN speed is location- and time-dependent. Benchmark the default or a
  custom host and disable the module (`enabled=false` or `cdn=original`) if a
  selected host is slower or returns an error.
