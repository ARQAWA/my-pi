'use strict';
// Forward proxy with a built-in fake OpenAI-compatible LLM for host llm.pcli.test.
// CONNECT llm.pcli.test:443 is answered locally over TLS with a self-signed cert.
// Usage: node proxy.cjs <logfile> <cert.pem> <key.pem>
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');

const [logFile, certFile, keyFile] = process.argv.slice(2);
if (!logFile || !certFile || !keyFile) {
  console.error('usage: node proxy.cjs <logfile> <cert.pem> <key.pem>');
  process.exit(2);
}
const PORT = 18999;
const FAKE_HOST = 'llm.pcli.test';
const TEXT = 'PCLI_MODEL_OK';

function log(line) {
  fs.appendFileSync(logFile, line + '\n');
}

function authOf(req) {
  const h = req.headers['proxy-authorization'];
  if (!h) return '-';
  const m = /^basic\s+(.+)$/i.exec(h.trim());
  if (!m) return '-';
  return Buffer.from(m[1], 'base64').toString('utf8');
}

const usage = { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 };

function handleChat(req, res, body) {
  let parsed = {};
  try { parsed = JSON.parse(body || '{}'); } catch (e) { /* ignore */ }
  const model = parsed.model || 'fake-1';
  const id = 'chatcmpl-pcli';
  const created = Math.floor(Date.now() / 1000);
  if (parsed.stream === true) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
    const base = { id, object: 'chat.completion.chunk', created, model };
    send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
    send({ ...base, choices: [{ index: 0, delta: { content: TEXT }, finish_reason: null }] });
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    // Usage chunk (sent when stream_options.include_usage is requested; harmless otherwise).
    send({ ...base, choices: [], usage });
    res.write('data: [DONE]\n\n');
    res.end();
  } else {
    const out = JSON.stringify({
      id, object: 'chat.completion', created, model,
      choices: [{ index: 0, message: { role: 'assistant', content: TEXT }, finish_reason: 'stop' }],
      usage,
    });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(out) });
    res.end(out);
  }
}

function handleModels(res) {
  const out = JSON.stringify({
    object: 'list',
    data: [{ id: 'fake-1', object: 'model', created: 0, owned_by: 'pcli' }],
  });
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(out) });
  res.end(out);
}

function handleFake(req, res, pathname) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    if (pathname.endsWith('/chat/completions')) return handleChat(req, res, body);
    if (pathname.endsWith('/models')) return handleModels(res);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
}

// Not listening: CONNECT sockets for the fake host are emitted into it as 'connection'
const fakeTls = https.createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, (req, res) => {
  log(`TLS ${req.method} ${req.url}`);
  handleFake(req, res, new URL(req.url, 'https://' + FAKE_HOST).pathname);
});
fakeTls.on('tlsClientError', (e) => log('TLS error ' + e.message));

const server = http.createServer((req, res) => {
  log(`HTTP ${req.method} ${req.url} auth=${authOf(req)}`);
  let url;
  try { url = new URL(req.url); } catch (e) {
    res.writeHead(400); res.end('absolute URI required'); return;
  }
  if (url.hostname === FAKE_HOST) return handleFake(req, res, url.pathname);
  // Plain forward of any other absolute-URI request.
  const headers = { ...req.headers };
  delete headers['proxy-authorization'];
  delete headers['proxy-connection'];
  const up = http.request({
    hostname: url.hostname,
    port: url.port || 80,
    path: url.pathname + url.search,
    method: req.method,
    headers,
  }, (ur) => {
    res.writeHead(ur.statusCode, ur.headers);
    ur.pipe(res);
  });
  up.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502);
    res.end('502 ' + e.message);
  });
  req.pipe(up);
});

server.on('connect', (req, clientSocket, head) => {
  log(`CONNECT ${req.url} auth=${authOf(req)}`);
  const idx = req.url.lastIndexOf(':');
  const host = req.url.slice(0, idx).replace(/^\[|\]$/g, '');
  const port = Number(req.url.slice(idx + 1)) || 443;
  if (host === FAKE_HOST) {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    clientSocket.on('error', () => {});
    if (head && head.length) clientSocket.unshift(head);
    fakeTls.emit('connection', clientSocket);
    return;
  }
  const upstream = net.connect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => {
    try { clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch (e) { /* ignore */ }
  });
  clientSocket.on('error', () => upstream.destroy());
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write('ready\n');
});
