// Vercel serverless function - CORS proxy for Yahoo Finance
module.exports = async function handler(req, res) {
  const url = req.query.url;
  if (!url) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Missing ?url= parameter');
  }

  let decoded;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Invalid URL encoding');
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const resp = await fetch(decoded, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    clearTimeout(timer);

    const text = await resp.text();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.statusCode = 200;
    res.setHeader('Content-Type', resp.headers.get('content-type') || 'text/plain');
    res.end(text);
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Proxy error: ' + e.message);
  }
};
