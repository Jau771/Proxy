# Surge

Personal proxy config collection, organized per app.

## surge / egern

- `surge/` — Surge configs, modules, and routing-rule snippets.
- `egern/` — Egern equivalents.

Rule snippets here are reference/backups for quick copy-paste, not hosted
rule-sets. They keep full policy names so they can be pasted straight back
into a main config. More files will be added over time.

## FKTG

Maps selected Telegram `91.108.56.x` IPs to `91.108.56.147` and `91.108.56.201`.

Install URL:

```text
https://raw.githubusercontent.com/Jau771/Surge/main/surge/Modules/FKTG.sgmodule
```

Notes:

- This module enables `use-local-host-item-for-proxy = true` so proxied requests can use the local `[Host]` IP mappings.
- Use it only if Telegram has connection quality issues. Telegram IP availability may change over time.
