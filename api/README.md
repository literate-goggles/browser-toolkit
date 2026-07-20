# daily.chebakov.me · vocab bans API

Tiny zero-dependency Node http server that stores per-source banned word lists
so the "Ban this word" feature on the vocab quiz syncs across browsers/devices.

## Endpoints

Mounted by nginx under `/api/vocab/bans` on daily.chebakov.me.

| Method | Path                                     | Body            | Returns                              |
| ------ | ---------------------------------------- | --------------- | ------------------------------------ |
| GET    | `/api/vocab/bans`                        |                 | `{ bans: { <sourceId>: [word, …] }}` |
| POST   | `/api/vocab/bans/<sourceId>`             | `{ "word": … }` | `{ ok, banned }`                     |
| DELETE | `/api/vocab/bans/<sourceId>`             |                 | `{ ok }` (clears source)             |
| DELETE | `/api/vocab/bans/<sourceId>/<word>`      |                 | `{ ok, banned }` (single word)       |

## Runtime

Listens on `127.0.0.1:3011` by default. Data file at
`~/Projects/browser-toolkit/api/bans.json`.

Managed by systemd — unit at `~/Projects/dotfiles/systemd/daily-vocab-bans.service`.

```sh
sudo systemctl status daily-vocab-bans
sudo systemctl restart daily-vocab-bans
sudo journalctl -u daily-vocab-bans -f
```

## Deploy from scratch

```sh
cd ~/Projects/dotfiles && make services
```
