// Local CORS proxy server for 买入决策助手
// Run: node proxy.js
// Then open index.html in browser
const http = require('http');
const https = require('https');

const PORT = 8787;

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  const target = reqUrl.searchParams.get('url');

  if (!target) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing ?url= parameter');
    return;
  }

  let decoded;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Invalid URL encoding');
    return;
  }

  const proto = decoded.startsWith('https') ? https : http;
  const proxyReq = proto.get(decoded, { headers: { 'User-Agent': 'Mozilla/5.0' } }, proxyRes => {
    res.writeHead(proxyRes.statusCode, { 'Content-Type': proxyRes.headers['content-type'] || 'text/plain' });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', err => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Proxy error: ' + err.message);
  });

  proxyReq.setTimeout(15000, () => {
    proxyReq.destroy();
    res.writeHead(504, { 'Content-Type': 'text/plain' });
    res.end('Upstream timeout');
  });
});

server.listen(PORT, () => {
  console.log(`Proxy running at http://localhost:${PORT}`);
});
