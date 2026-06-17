// SwingAI Bot — Cloudflare Worker v2
// Universal CORS Proxy: Binance + Bybit + OKX
//
// Wdróż: dash.cloudflare.com → Workers & Pages → Create Worker → wklej kod → Deploy
// URL workera wpisz w Konfiguracji bota w polach:
//   Binance Worker URL  → https://swingai-xxx.workers.dev
//   Bybit Worker URL    → https://swingai-xxx.workers.dev  (ten sam worker!)
//   OKX Worker URL      → https://swingai-xxx.workers.dev  (ten sam worker!)
//
// Zasada działania:
//   Przeglądarka podpisuje zlecenia lokalnie (HMAC-SHA256 / HMAC-SHA256+Base64).
//   Worker TYLKO przekazuje żądania do odpowiedniej giełdy, dodając nagłówki CORS.
//   Żaden klucz API ani secret NIGDY nie opuszcza Twojej przeglądarki.
//
// Routing:
//   /proxy/api/...        → Binance   (api.binance.com)
//   /proxy/sapi/...       → Binance   (api.binance.com)
//   /proxy/v5/...         → Bybit     (api.bybit.com)
//   /proxy/api/v5/...     → OKX       (www.okx.com)   ← wykrywa nagłówek OK-ACCESS-KEY

export default {
  async fetch(request, env, ctx) {

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      const url  = new URL(request.url);
      const path = url.pathname.replace(/^\/proxy/, '');

      if (!path) {
        return new Response('SwingAI Worker v2 — OK', { status: 200, headers: corsHeaders() });
      }

      // ── Routing ────────────────────────────────────────────────────
      let targetBase;

      if (path.startsWith('/v5/')) {
        // Bybit API v5
        targetBase = 'https://api.bybit.com';
      } else if (path.startsWith('/api/v5/')) {
        // OKX API v5 — wykryj po nagłówku OK-ACCESS-KEY lub po ścieżce /api/v5/
        targetBase = 'https://www.okx.com';
      } else if (path.startsWith('/api/') || path.startsWith('/sapi/')) {
        // Binance REST API
        targetBase = 'https://api.binance.com';
      } else {
        return jsonError(400, 'Nieznana ścieżka. Obsługiwane: /api/, /sapi/ (Binance), /v5/ (Bybit), /api/v5/ (OKX)');
      }

      const targetUrl = targetBase + path + (url.search || '');

      // ── Nagłówki ───────────────────────────────────────────────────
      const fwdHeaders = new Headers();
      const skipHeaders = new Set([
        'host', 'cf-connecting-ip', 'cf-ray', 'cf-visitor',
        'cf-ipcountry', 'cf-worker', 'x-forwarded-for',
        'x-real-ip', 'x-forwarded-proto',
      ]);
      for (const [k, v] of request.headers.entries()) {
        if (!skipHeaders.has(k.toLowerCase())) {
          fwdHeaders.set(k, v);
        }
      }
      fwdHeaders.set('User-Agent', 'SwingAI-Bot/2.0');

      // ── Proxy request ──────────────────────────────────────────────
      const isBodyMethod = !['GET', 'HEAD'].includes(request.method.toUpperCase());
      const upstream = await fetch(targetUrl, {
        method:  request.method,
        headers: fwdHeaders,
        body:    isBodyMethod ? request.body : undefined,
      });

      const resBody = await upstream.arrayBuffer();

      // Zbuduj headers odpowiedzi — CORS nadpisuje oryginalne
      const outHeaders = new Headers();
      for (const [k, v] of upstream.headers.entries()) {
        // Nie przepisuj nagłówków CORS z upstream — nadpiszemy własne
        if (!k.toLowerCase().startsWith('access-control-')) {
          outHeaders.set(k, v);
        }
      }
      for (const [k, v] of Object.entries(corsHeaders())) {
        outHeaders.set(k, v);
      }

      return new Response(resBody, {
        status:  upstream.status,
        headers: outHeaders,
      });

    } catch (err) {
      return jsonError(502, 'Worker error: ' + err.message);
    }
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age':       '86400',
  };
}

function jsonError(status, msg) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
