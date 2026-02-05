# api_change

OpenAI-compatible image gateway that converts OpenAI `image_url` / `input_image` messages into Claude image blocks, then forwards to `clewdr` and converts the response back to OpenAI format.

## What this solves
- LobeHub can keep using **OpenAI provider**.
- You can send images in OpenAI format.
- Claude can understand images via the converted Claude `/v1/messages` or `/code/v1/messages`.

## Requirements
- Node.js 18+ (server has Node 20).
- A running `clewdr` on `http://127.0.0.1:8484`.

## Environment variables
- `PORT` (default `8383`)
- `CLEWDR_BASE_URL` (default `http://127.0.0.1:8484`)
- `CLEWDR_API_KEY` (required, e.g. `sk-ponsde`)
- `GATEWAY_API_KEY` (optional bootstrap key, will be written to `keys.json` if empty)
- `GATEWAY_ADMIN_KEY` (required, admin key for UI/key management)
- `KEYS_FILE` (default `/home/ponsde/api_change/keys.json`)

## Run
```bash
cd /home/ponsde/api_change
PORT=8383 \
CLEWDR_BASE_URL=http://127.0.0.1:8484 \
CLEWDR_API_KEY=sk-ponsde \
GATEWAY_API_KEY=your_gateway_key \
GATEWAY_ADMIN_KEY=sk-ponsde \
node index.js
```

## Routing (strict)
- `/v1/*` → clewdr **Claude.ai** (`/v1/messages`)
- `/code/v1/*` → clewdr **Claude Code** (`/code/v1/messages`)

This means:
- Base URL `http://<ip>:8383/v1` = normal Claude
- Base URL `http://<ip>:8383/code/v1` = Claude Code

## LobeHub config
- Provider: OpenAI
- Base URL (normal): `http://<your-server-ip>:8383/v1`
- Base URL (code): `http://<your-server-ip>:8383/code/v1`
- API Key: any key from `keys.json`
- Disable OpenAI "responses/web search" (not supported)

## Streaming
- `stream=true` is supported via **pseudo-streaming** (gateway sends chunks after full response).
- Real upstream streaming is disabled due to instability.

## Web search / responses
OpenAI `responses` / web-search is **not supported**. The gateway returns a clear error on:
- `POST /v1/responses`
- `POST /code/v1/responses`

## Health check
```bash
curl -s -H "Authorization: Bearer your_gateway_key" http://127.0.0.1:8383/health
```

## UI
```bash
curl -s http://127.0.0.1:8383/ui
```

## Key management API
- `GET /admin/keys`
- `POST /admin/keys` `{ "key": "new-key" }`
- `DELETE /admin/keys` `{ "key": "old-key" }`

## Systemd example
Create `/etc/systemd/system/api_change.service`:
```ini
[Unit]
Description=api_change image gateway
After=network.target

[Service]
Type=simple
User=ponsde
WorkingDirectory=/home/ponsde/api_change
Environment=PORT=8383
Environment=CLEWDR_BASE_URL=http://127.0.0.1:8484
Environment=CLEWDR_API_KEY=sk-ponsde
Environment=GATEWAY_API_KEY=your_gateway_key
Environment=GATEWAY_ADMIN_KEY=sk-ponsde
ExecStart=/usr/bin/node /home/ponsde/api_change/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now api_change.service
```

## Notes
- `image_url` supports normal URLs and `data:` base64 URLs.
- Some image hosts return 403 to servers; use another URL or data URL.

UI base template source:
- https://gist.github.com/rd003/3a1fa3bee319adef02db74a4d5bca299
