// SwingAI Bot — Cloudflare Worker (CORS Proxy dla Binance API)
// Wdróż na: https://dash.cloudflare.com -> Workers & Pages -> Create Worker
// Następnie wklej URL workera w ustawieniach bota (pole "Worker URL")
//
// Zasada działania:
//   Przeglądarka podpisuje zlecenia lokalnie (HMAC-SHA256),
//   Worker tylko przekazuje je do Binance dodając nagłówki CORS.
//   Secret API NIGDY nie opuszcza przeglądarki.

export default {
  async fetch(request, env, ctx) {

    // CORS preflight (OPTIONS)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    try {
      const url = new URL(request.url);

      // Oczekiwany format: /proxy/api/v3/... -> https://api.binance.com/api/v3/...
      const path = url.pathname.replace(/^\/proxy/, '');
      if (!path.startsWith('/api/') && !path.startsWith('/sapi/')) {
        return jsonError(400, 'Nieprawidłowa ścieżka — tylko /api/ i /sapi/');
      }

      const binanceUrl = 'https://api.binance.com' + path + (url.search || '');

      // Przekaż nagłówki (w tym X-MBX-APIKEY podany przez przeglądarkę)
      const fwdHeaders = new Headers();
      for (const [k, v] of request.headers.entries()) {
        // Filtruj nagłówki które Cloudflare nie pozwala forwardować
        if (!['host', 'cf-connecting-ip', 'cf-ray', 'cf-visitor',
              'x-forwarded-for', 'x-real-ip'].includes(k.toLowerCase())) {
          fwdHeaders.set(k, v);
        }
      }
      fwdHeaders.set('User-Agent', 'SwingAI-Bot/1.0');

      const binanceRes = await fetch(binanceUrl, {
        method:  request.method,
        headers: fwdHeaders,
        body:    ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      });

      // Zwróć odpowiedź z dodanymi nagłówkami CORS
      const resBody = await binanceRes.arrayBuffer();
      return new Response(resBody, {
        status:  binanceRes.status,
        headers: {
          ...Object.fromEntries(binanceRes.headers.entries()),
          ...corsHeaders(),
        },
      });

    } catch (err) {
      return jsonError(502, 'Worker error: ' + err.message);
    }
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, PUT, OPTIONS',
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
