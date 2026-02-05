'use strict';

const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8383);
const DEFAULT_UPSTREAM = process.env.CLEWDR_BASE_URL || 'http://127.0.0.1:8484';
const CLEWDR_API_KEY = (process.env.CLEWDR_API_KEY || '').trim();
const GATEWAY_API_KEY = (process.env.GATEWAY_API_KEY || '').trim();
const GATEWAY_ADMIN_KEY = (process.env.GATEWAY_ADMIN_KEY || '').trim();
const MAX_BODY_BYTES = 20 * 1024 * 1024; // 20MB
const KEYS_FILE = process.env.KEYS_FILE || path.join(__dirname, 'keys.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const UI_FILE = path.join(__dirname, 'ui.html');
const ROUTE_INFO = 'v1->normal, code/v1->code';

let currentUpstreamUrl = DEFAULT_UPSTREAM;

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const json = JSON.parse(raw);
      if (json.upstreamUrl) currentUpstreamUrl = json.upstreamUrl;
    } catch {}
  }
}
loadConfig();

function saveConfig(cfg) {
  const data = JSON.stringify(cfg, null, 2);
  fs.writeFileSync(CONFIG_FILE, data, { encoding: 'utf8' });
  if (cfg.upstreamUrl) currentUpstreamUrl = cfg.upstreamUrl;
}

function sanitizeKey(raw) {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  return cleaned;
}

function isValidKey(key) {
  return /^[A-Za-z0-9._-]+$/.test(key);
}

function loadKeys() {
  let keys = new Set();
  if (fs.existsSync(KEYS_FILE)) {
    try {
      const raw = fs.readFileSync(KEYS_FILE, 'utf8');
      const json = JSON.parse(raw);
      if (Array.isArray(json.keys)) {
        json.keys.forEach((k) => {
          const key = sanitizeKey(k);
          if (key) keys.add(key);
        });
      }
    } catch {
      // ignore and fall back to env
    }
  }
  if (keys.size === 0 && GATEWAY_API_KEY) {
    keys.add(GATEWAY_API_KEY);
    saveKeys(keys);
  }
  return keys;
}

function saveKeys(keys) {
  const data = JSON.stringify({ keys: Array.from(keys) }, null, 2);
  fs.writeFileSync(KEYS_FILE, data, { encoding: 'utf8' });
  try {
    fs.chmodSync(KEYS_FILE, 0o600);
  } catch {
    // best-effort
  }
}

let keyStore = loadKeys();
console.log(`admin key set: ${GATEWAY_ADMIN_KEY ? 'yes' : 'no'}, api keys: ${keyStore.size}`);

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'access-control-allow-origin': '*',
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function setCors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function extractBearer(req) {
  const auth = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match ? match[1].trim() : '';
}

function requireApiAuth(req, res) {
  if (keyStore.size === 0) {
    sendJson(res, 500, { error: { message: 'No API keys configured on server' } });
    return false;
  }
  const token = extractBearer(req);
  if (!token || !keyStore.has(token)) {
    sendJson(res, 401, { error: { message: 'Invalid API key' } });
    return false;
  }
  return true;
}

function requireAdminAuth(req, res) {
  if (!GATEWAY_ADMIN_KEY) {
    sendJson(res, 500, { error: { message: 'GATEWAY_ADMIN_KEY not set on server' } });
    return false;
  }
  const token = extractBearer(req);
  if (token !== GATEWAY_ADMIN_KEY) {
    sendJson(res, 401, { error: { message: 'Invalid admin key' } });
    return false;
  }
  return true;
}

function guessMediaTypeFromUrl(url) {
  const lower = url.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl);
  if (!match) {
    throw new Error('Unsupported data URL format');
  }
  return { media_type: match[1], data: match[2] };
}

async function fetchImageAsBase64(url) {
  if (url.startsWith('data:')) {
    return parseDataUrl(url);
  }
  const resp = await fetch(url, {
    headers: {
      'user-agent': 'api_change/1.0',
      'accept': 'image/*'
    }
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch image: ${resp.status}`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  const data = Buffer.from(arrayBuffer).toString('base64');
  const media_type = resp.headers.get('content-type') || guessMediaTypeFromUrl(url);
  return { media_type, data };
}

function normalizeContentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === 'text')
      .map((p) => p.text || '')
      .join('\n');
  }
  return '';
}

async function convertOpenAIToClaude(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => normalizeContentToText(m.content));
  const system = systemParts.filter(Boolean).join('\n\n');

  const claudeMessages = [];
  for (const m of messages) {
    if (!m || m.role === 'system') continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = m.content;

    if (typeof content === 'string') {
      claudeMessages.push({ role, content: [{ type: 'text', text: content }] });
      continue;
    }

    if (Array.isArray(content)) {
      const blocks = [];
      for (const part of content) {
        if (!part) continue;
        if (part.type === 'text') {
          blocks.push({ type: 'text', text: part.text || '' });
          continue;
        }
        if (part.type === 'image_url' || part.type === 'input_image') {
          const url = (part.image_url && part.image_url.url) || part.url || part.data;
          if (!url) continue;
          const { media_type, data } = await fetchImageAsBase64(url);
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type, data }
          });
        }
      }
      if (blocks.length > 0) claudeMessages.push({ role, content: blocks });
      continue;
    }

    claudeMessages.push({ role, content: [{ type: 'text', text: '' }] });
  }

  const claudeBody = {
    model: body.model,
    max_tokens: body.max_tokens || 1024,
    messages: claudeMessages
  };

  if (system) claudeBody.system = system;
  if (body.temperature !== undefined) claudeBody.temperature = body.temperature;
  if (body.top_p !== undefined) claudeBody.top_p = body.top_p;
  if (body.stop !== undefined) {
    claudeBody.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  }
  if (body.stream === true) {
    claudeBody.stream = false;
  }

  return claudeBody;
}

function convertClaudeToOpenAI(claudeResp, model) {
  const text = Array.isArray(claudeResp.content)
    ? claudeResp.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    : '';
  const finish = claudeResp.stop_reason === 'end_turn' ? 'stop' : (claudeResp.stop_reason || 'stop');
  const usage = claudeResp.usage
    ? {
        prompt_tokens: claudeResp.usage.input_tokens || 0,
        completion_tokens: claudeResp.usage.output_tokens || 0,
        total_tokens: (claudeResp.usage.input_tokens || 0) + (claudeResp.usage.output_tokens || 0)
      }
    : undefined;

  const response = {
    id: claudeResp.id || `chatcmpl-${Math.random().toString(36).slice(2)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || claudeResp.model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: finish
      }
    ]
  };

  if (usage) response.usage = usage;
  return response;
}

function uiHtml() {
  try {
    const raw = fs.readFileSync(UI_FILE, 'utf8');
    return raw.replace(/\{\{ROUTE_INFO\}\}/g, ROUTE_INFO);
  } catch {
    return '<html><body>UI file missing</body></html>';
  }
}

async function proxyModels(res, kind) {
  if (!CLEWDR_API_KEY) {
    sendJson(res, 500, { error: { message: 'CLEWDR_API_KEY not set on server' } });
    return;
  }
  const path = kind === 'code' ? '/code/v1/models' : '/v1/models';
  const resp = await fetch(`${currentUpstreamUrl}${path}`, {
    headers: { Authorization: `Bearer ${CLEWDR_API_KEY}` }
  });
  const text = await resp.text();
  res.writeHead(resp.status, {
    'access-control-allow-origin': '*',
    'content-type': resp.headers.get('content-type') || 'application/json'
  });
  res.end(text);
}

async function handleChatCompletions(req, res, bodyText, route) {
  if (!CLEWDR_API_KEY) {
    sendJson(res, 500, { error: { message: 'CLEWDR_API_KEY not set on server' } });
    return;
  }

  let body;
  try {
    body = JSON.parse(bodyText || '{}');
  } catch {
    sendJson(res, 400, { error: { message: 'Invalid JSON' } });
    return;
  }

  try {
    const claudeBody = await convertOpenAIToClaude(body);
    const path = route === 'code' ? '/code/v1/messages' : '/v1/messages';
    const resp = await fetch(`${currentUpstreamUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        Authorization: `Bearer ${CLEWDR_API_KEY}`
      },
      body: JSON.stringify(claudeBody)
    });

    const respText = await resp.text();
    if (!resp.ok) {
      res.writeHead(resp.status, {
        'access-control-allow-origin': '*',
        'content-type': 'application/json'
      });
      res.end(respText);
      return;
    }

    const claudeResp = JSON.parse(respText);
    const openaiResp = convertClaudeToOpenAI(claudeResp, body.model);
    if (body.stream) {
      await pseudoStreamOpenAI(res, openaiResp, body.model);
      return;
    }
    sendJson(res, 200, openaiResp);
  } catch (err) {
    sendJson(res, 500, { error: { message: err.message || 'Internal error' } });
  }
}

function writeSse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

async function pseudoStreamOpenAI(res, openaiResp, model) {
  res.writeHead(200, {
    'access-control-allow-origin': '*',
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive'
  });

  const content = openaiResp?.choices?.[0]?.message?.content || '';
  const id = openaiResp.id || `chatcmpl-${Math.random().toString(36).slice(2)}`;
  const created = openaiResp.created || Math.floor(Date.now() / 1000);
  const m = model || openaiResp.model;

  const chunkSize = 40;
  for (let i = 0; i < content.length; i += chunkSize) {
    const part = content.slice(i, i + chunkSize);
    writeSse(res, {
      id,
      object: 'chat.completion.chunk',
      created,
      model: m,
      choices: [{ index: 0, delta: { content: part }, finish_reason: null }]
    });
    await new Promise((r) => setTimeout(r, 10));
  }

  writeSse(res, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  res.write('data: [DONE]\n\n');
  res.end();
}

function responsesNotSupported(res) {
  sendJson(res, 400, {
    error: {
      message: 'OpenAI Responses/Web Search is not supported by this gateway. Disable web search in the client.'
    }
  });
}

async function checkUpstream() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(currentUpstreamUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    return res.status >= 200 && res.status < 500;
  } catch (e) {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
      setCors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      setCors(res);
      const upstreamOk = await checkUpstream();
      sendJson(res, 200, {
        ok: true,
        upstream: upstreamOk ? 'ok' : 'unreachable',
        upstreamUrl: currentUpstreamUrl
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/ui') {
      setCors(res);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(uiHtml());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/keys') {
      setCors(res);
      if (!requireAdminAuth(req, res)) return;
      sendJson(res, 200, { keys: Array.from(keyStore) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/keys') {
      setCors(res);
      if (!requireAdminAuth(req, res)) return;
      const bodyText = await readBody(req);
      let body;
      try {
        body = JSON.parse(bodyText || '{}');
      } catch {
        sendJson(res, 400, { error: { message: 'Invalid JSON' } });
        return;
      }
      if (!body.key || typeof body.key !== 'string') {
        sendJson(res, 400, { error: { message: 'key is required' } });
        return;
      }
      const key = sanitizeKey(body.key);
      if (!key) {
        sendJson(res, 400, { error: { message: 'key is required' } });
        return;
      }
      if (!isValidKey(key)) {
        sendJson(res, 400, { error: { message: 'key contains invalid characters' } });
        return;
      }
      keyStore.add(key);
      saveKeys(keyStore);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/admin/keys') {
      setCors(res);
      if (!requireAdminAuth(req, res)) return;
      const bodyText = await readBody(req);
      let body;
      try {
        body = JSON.parse(bodyText || '{}');
      } catch {
        sendJson(res, 400, { error: { message: 'Invalid JSON' } });
        return;
      }
      if (!body.key || typeof body.key !== 'string') {
        sendJson(res, 400, { error: { message: 'key is required' } });
        return;
      }
      const key = sanitizeKey(body.key);
      if (!key) {
        sendJson(res, 400, { error: { message: 'key is required' } });
        return;
      }
      keyStore.delete(key);
      saveKeys(keyStore);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/config') {
      setCors(res);
      if (!requireAdminAuth(req, res)) return;
      sendJson(res, 200, { upstreamUrl: currentUpstreamUrl });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/config') {
      setCors(res);
      if (!requireAdminAuth(req, res)) return;
      const bodyText = await readBody(req);
      let body;
      try {
        body = JSON.parse(bodyText || '{}');
      } catch {
        sendJson(res, 400, { error: { message: 'Invalid JSON' } });
        return;
      }
      if (body.upstreamUrl && typeof body.upstreamUrl === 'string') {
        saveConfig({ upstreamUrl: body.upstreamUrl.trim() });
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (!requireApiAuth(req, res)) return;

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      await proxyModels(res, 'normal');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/code/v1/models') {
      await proxyModels(res, 'code');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const bodyText = await readBody(req);
      await handleChatCompletions(req, res, bodyText, 'normal');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/code/v1/chat/completions') {
      const bodyText = await readBody(req);
      await handleChatCompletions(req, res, bodyText, 'code');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/responses') {
      responsesNotSupported(res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/code/v1/responses') {
      responsesNotSupported(res);
      return;
    }

    sendJson(res, 404, { error: { message: 'Not found' } });
  } catch (err) {
    sendJson(res, 500, { error: { message: err.message || 'Internal error' } });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`api_change gateway listening on 0.0.0.0:${PORT}`);
});
