/**
 * @file api/proxy.js
 * Production-ready serverless proxy endpoint (Vercel, Netlify, Cloudflare, Node).
 *
 * Stateless and zero-knowledge:
 * - Only proxies public opportunity URLs (GET requests).
 * - Never logs, touches, or stores user data or API keys.
 * - Adds Access-Control-Allow-Origin headers for client consumption.
 */

export default async function handler(req, res) {
  // Support both Node.js (Vercel/Netlify) and standard Request/Response environments
  const urlParam = req.query?.url || new URL(req.url, 'http://localhost').searchParams.get('url');

  if (!urlParam) {
    if (res?.status) {
      return res.status(400).json({ error: 'Missing required "url" query parameter' });
    }
    return new Response(JSON.stringify({ error: 'Missing required "url" query parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const targetUrl = decodeURIComponent(urlParam);
    const parsed = new URL(targetUrl);

    // Safety: only allow http/https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Invalid URL protocol');
    }

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'opo/0.1 (+https://github.com/opo-agent)',
        'Accept': 'application/json, text/plain, */*'
      }
    });

    const data = await response.text();

    if (res?.status) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
      return res.status(response.status).send(data);
    }

    return new Response(data, {
      status: response.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': response.headers.get('content-type') || 'application/json'
      }
    });
  } catch (err) {
    const errMsg = err?.message || 'Proxy error';
    if (res?.status) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(500).json({ error: errMsg });
    }
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }
}
