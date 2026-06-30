﻿// SwingAI Bot 24/7 — Cloudflare Worker — FULL VERSION
// Pełna logika handlowa identyczna z https://tomekfalek-cyber.github.io/swingai-bot/
// Multi-TF (Daily+4H+1H), NB+GBM+QL, PATTERNS, Kelly, ATR-TP/SL, CORR, OBI

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// KONFIGURACJA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Gate.io jako źródło danych (OKX blokuje Cloudflare Workers na pub. endpointach)
// Format Gate.io: BTC_USDC — ceny identyczne z OKX USDC (<0.1% różnicy)
const PAIRS = ['BTC_USDC','ETH_USDC','SOL_USDC','XRP_USDC','DOGE_USDC','ADA_USDC','AVAX_USDC','LINK_USDC'];
const FEE   = 0.002;
const TIMEOUT_MS = 7 * 24 * 3600000; // 7 dni

const CORR_GROUPS = [
  ['BTC_USDC'],
  ['ETH_USDC'],
  ['SOL_USDC','AVAX_USDC'],
  ['XRP_USDC','ADA_USDC'],
  ['DOGE_USDC'],
  ['LINK_USDC']
];

const PAIR_PARAMS_DEFAULT = {
  'BTC_USDC':  { tp:0.10, sl:0.04, minScore:62 },
  'ETH_USDC':  { tp:0.12, sl:0.05, minScore:60 },
  'SOL_USDC':  { tp:0.14, sl:0.06, minScore:58 },
  'XRP_USDC':  { tp:0.15, sl:0.06, minScore:58 },
  'DOGE_USDC': { tp:0.18, sl:0.07, minScore:60 },
  'ADA_USDC':  { tp:0.14, sl:0.06, minScore:58 },
  'AVAX_USDC': { tp:0.14, sl:0.06, minScore:58 },
  'LINK_USDC': { tp:0.14, sl:0.06, minScore:58 }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GŁÓWNY HANDLER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runBotCycle(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: corsHeaders() });

    // ââ AUTENTYKACJA âââââââââââââââââââââââââââââââââââââââââââââââââ
    const AUTH_SECRET = env.AUTH_SECRET || 'swingai-secret-2024';
    const authHeader  = request.headers.get('Authorization') || '';
    const authParam   = url.searchParams.get('auth') || '';
    const isAuth = authHeader === 'Bearer ' + AUTH_SECRET || authParam === AUTH_SECRET;
    const publicPaths = ['/', '/status-public'];
    if (!isAuth && !publicPaths.includes(url.pathname)) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders() });
    }

    if (url.pathname === '/start-paper') {
      const cfg = defaultConfig();
      cfg.active = true; cfg.mode = 'paper'; cfg.startedAt = Date.now();
      await env.SWINGAI_KV.put('config', JSON.stringify(cfg));
      await env.SWINGAI_KV.put('state',  JSON.stringify(defaultState()));
      ctx.waitUntil(runBotCycle(env));
      return new Response(redirectHTML('✅ Bot PAPER uruchomiony!'), { headers: {'Content-Type':'text/html;charset=utf-8'} });
    }

    if (url.pathname === '/start-live') {
      const p = url.searchParams;
      const cfg = defaultConfig();
      cfg.active = true; cfg.mode = 'mexc'; cfg.startedAt = Date.now();
      cfg.mexcApiKey = p.get('key')  || '';
      cfg.mexcSecret = p.get('sec')  || '';
      cfg.tp    = parseFloat(p.get('tp')   || '12') / 100;
      cfg.sl    = parseFloat(p.get('sl')   || '5')  / 100;
      cfg.trail = parseFloat(p.get('trail')|| '6')  / 100;
      cfg.minScore = parseInt(p.get('score')|| '58');
      cfg.maxPos   = parseInt(p.get('maxp') || '4');
      cfg.posSize  = parseFloat(p.get('size')|| '15');
      cfg.tgToken  = p.get('tg')   || '';
      cfg.tgChat   = p.get('tgc')  || '';
      await env.SWINGAI_KV.put('config', JSON.stringify(cfg));
      await env.SWINGAI_KV.put('state',  JSON.stringify(defaultState()));
      ctx.waitUntil(runBotCycle(env));
      return new Response(redirectHTML('✅ Bot LIVE uruchomiony!'), { headers: {'Content-Type':'text/html;charset=utf-8'} });
    }

    if (url.pathname === '/save-config') {
      const p = url.searchParams;
      const cfg = await getConfig(env);
      // Klucze API — zapisz tylko jeśli niepuste
      if (p.get('key'))  cfg.mexcApiKey = p.get('key');
      if (p.get('sec'))  cfg.mexcSecret = p.get('sec');
      if (p.get('tg'))   cfg.tgToken    = p.get('tg');
      if (p.get('tgc'))  cfg.tgChat     = p.get('tgc');
      // Parametry handlowe
      if (p.get('tp'))    cfg.tp       = parseFloat(p.get('tp'))    / 100;
      if (p.get('sl'))    cfg.sl       = parseFloat(p.get('sl'))    / 100;
      if (p.get('trail')) cfg.trail    = parseFloat(p.get('trail')) / 100;
      if (p.get('score')) cfg.minScore = parseInt(p.get('score'));
      if (p.get('maxp'))  cfg.maxPos   = parseInt(p.get('maxp'));
      if (p.get('size'))  cfg.posSize  = parseFloat(p.get('size'));
      await env.SWINGAI_KV.put('config', JSON.stringify(cfg));
      return new Response(redirectHTML('✅ Konfiguracja zapisana!'), { headers: {'Content-Type':'text/html;charset=utf-8'} });
    }

    if (url.pathname === '/delete-keys') {
      const which = url.searchParams.get('w') || 'all';
      const cfg = await getConfig(env);
      if (which === 'mexc' || which === 'all') {
        cfg.mexcApiKey = ''; cfg.mexcSecret = '';
      }
      if (which === 'tg' || which === 'all') {
        cfg.tgToken = ''; cfg.tgChat = '';
      }
      await env.SWINGAI_KV.put('config', JSON.stringify(cfg));
      const label = which === 'mexc' ? 'klucze MEXC' : which === 'tg' ? 'Telegram' : 'wszystkie klucze';
      return new Response(redirectHTML('🗑️ Usunięto: ' + label), { headers: {'Content-Type':'text/html;charset=utf-8'} });
    }

    if (url.pathname === '/test-exchange') {
      const exUrl = url.searchParams.get('u') || '';
      if (!exUrl) return jsonResp({ error: 'brak parametru u' });
      try {
        const r = await fetch(exUrl, { headers: { 'Content-Type': 'application/json' } });
        const text = await r.text();
        return jsonResp({ status: r.status, body: text.slice(0, 300) });
      } catch(e) {
        return jsonResp({ status: 0, error: e.message });
      }
    }

    if (url.pathname === '/balance') {
      const cfg   = await getConfig(env);
      const state = await getState(env);
      if (cfg.mode !== 'mexc' || !cfg.mexcApiKey) {
        return jsonResp({ balance: null, mode: cfg.mode });
      }
      // Pobierz świeże saldo z MEXC bezpośrednio — MEXC nie blokuje Cloudflare
      try {
        const fresh = await mexcGetBalance(cfg);
        return jsonResp({ balance: fresh, mode: 'live' });
      } catch(e) {
        return jsonResp({ balance: null, mode: 'live', error: e.message });
      }
    }

    if (url.pathname === '/stop') {
      const cfg = await getConfig(env);
      cfg.active = false;
      await env.SWINGAI_KV.put('config', JSON.stringify(cfg));
      return new Response(redirectHTML('⏹ Bot zatrzymany'), { headers: {'Content-Type':'text/html;charset=utf-8'} });
    }

    if (url.pathname === '/run') {
      const cfg = await getConfig(env);
      if (!cfg.active)
        return new Response(redirectHTML('⚠️ Bot nieaktywny — uruchom najpierw'), { headers: {'Content-Type':'text/html;charset=utf-8'} });
      ctx.waitUntil(runBotCycle(env));
      return new Response(redirectHTML('🔄 Skan uruchomiony! Wróć za 30 sekund...'), { headers: {'Content-Type':'text/html;charset=utf-8'} });
    }

    if (url.pathname === '/status') {
      const cfg   = await getConfig(env);
      const state = await getState(env);
      // Usuń klucze API z odpowiedzi — nigdy nie eksponuj secretów
      const safeCfg = { ...cfg, mexcApiKey: cfg.mexcApiKey ? '***' : '', mexcSecret: cfg.mexcSecret ? '***' : '', tgToken: cfg.tgToken ? '***' : '' };
      return jsonResp({ config: safeCfg, state });
    }

    if (url.pathname === '/tg-updates') {
      const cfg = await getConfig(env);
      const r = await fetch('https://api.telegram.org/bot' + cfg.tgToken + '/getUpdates');
      const d = await r.json();
      return jsonResp(d);
    }

    if (url.pathname === '/tg-test') {
      const cfg = await getConfig(env);
      const payload = { chat_id: cfg.tgChat, text: 'test', parse_mode: 'HTML' };
      const tgUrl = 'https://api.telegram.org/bot' + cfg.tgToken + '/sendMessage';
      let tgResult;
      try {
        const r = await fetch(tgUrl, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        tgResult = await r.json();
      } catch(e) { tgResult = { fetchError: e.message }; }
      return jsonResp({ tokenPrefix: cfg.tgToken.slice(0,12)+'...', chat_id: cfg.tgChat, payload, tgResult });
    }

    if (url.pathname === '/send-welcome') {
      const cfg = await getConfig(env);
      if (!cfg.tgToken || !cfg.tgChat) {
        return jsonResp({ ok: false, error: 'Brak tokenu Telegram w konfiguracji', token: !!cfg.tgToken, chat: !!cfg.tgChat });
      }
      try {
        const tgResp = await fetch(
          'https://api.telegram.org/bot' + cfg.tgToken + '/sendMessage',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: cfg.tgChat,
              text: '👋 Witaj! SwingAI Bot 24/7 aktywny.\n\nPołączenie działa ✅\nPary: BTC ETH SOL XRP DOGE ADA AVAX LINK\nSkany co 1h przez Cloudflare Worker.',
              parse_mode: 'HTML'
            })
          }
        );
        const tgJson = await tgResp.json();
        return jsonResp({ ok: tgJson.ok, tg: tgJson });
      } catch(e) {
        return jsonResp({ ok: false, error: e.message });
      }
    }

    if (url.pathname === '/save-tg' && request.method === 'POST') {
      try {
        const body = await request.json();
        const cfg = await getConfig(env);
        const oldToken = cfg.tgToken;
        if (body.tg)  cfg.tgToken = body.tg;
        if (body.tgc) cfg.tgChat  = body.tgc;
        await env.SWINGAI_KV.put('config', JSON.stringify(cfg));
        return jsonResp({ ok: true, wasNew: !oldToken && !!cfg.tgToken });
      } catch(e) {
        return jsonResp({ ok: false, error: e.message });
      }
    }

    const cfg   = await getConfig(env);
    const state = await getState(env);
    return new Response(await dashboardHTML(cfg, state, env), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() }
    });
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GŁÓWNA LOGIKA CYKLU
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function runBotCycle(env) {
  const cfg   = await getConfig(env);
  if (!cfg.active) return;
  const state = await getState(env);
  state.iter  = (state.iter || 0) + 1;
  addLog(state, '--- Skan #' + state.iter + ' ---');

  // Daily reset: zeruj dzienny PnL i startBalance o północy UTC
  const todayUTC = new Date().toISOString().slice(0, 10);
  if (state.dailyDate !== todayUTC) {
    state.dailyDate         = todayUTC;
    state.dailyPnl          = 0;
    state.dailyStartBalance = 0;
  }

  // Drawdown Circuit Breaker
  const currentBalance = cfg.mode === 'mexc'
    ? (state.liveBalance > 0 ? state.liveBalance : (cfg.paperBalance || 1000))
    : (state.paperBalance > 0 ? state.paperBalance : (cfg.paperBalance || 1000));
  if (!state.peakBalance || state.peakBalance < currentBalance) state.peakBalance = currentBalance;
  const drawdown = (state.peakBalance - currentBalance) / state.peakBalance;
  const drawdownBlocked = (state.drawdownBlock || 0) > Date.now();
  if (drawdown > 0.15 && !drawdownBlocked) {
    state.drawdownBlock = Date.now() + 24 * 3600000;
    addLog(state, 'Circuit breaker: -15% drawdown — blokada BUY 24h', 'err');
  }

  // Załaduj modele AI z KV
  const nb  = makeNB(state.nb);
  const gbm = makeGBM(state.gbm);
  const ql  = makeQL(state.ql);
  const ew  = state.ensembleW || { score:1, nb:0.8, gbm:0.9, obi:0.3, ql:0.5 };
  const pairParams = state.pairParams || {};
  const adaptiveMinScore = state.adaptiveMinScore || cfg.minScore;

  try {
    // 1. Fear & Greed (z cache 1h w state)
    const fg = await getFearGreed(state);

    // 2. BTC Guard
    const btcDrop = await btcDropGuard();
    if (btcDrop) addLog(state, 'BTC Guard aktywny — brak nowych long na altcoinach', 'warn');

    // 3. Sprawdź otwarte pozycje
    await checkPositions(cfg, state, env, ql);

    // 4. Skanuj pary
    const sigs = [];
    for (const sym of PAIRS) {
      try {
        const s = await analyzeSwing(sym, cfg, state, nb, gbm, ql, ew, pairParams, adaptiveMinScore);
        sigs.push(s);
        state.lastSigs = state.lastSigs || [];
      } catch(e) {
        addLog(state, sym + ': ' + e.message, 'warn');
      }
      await sleep(700);
    }
    sigs.sort((a, b) => b.finalProb - a.finalProb);
    state.lastSigs = sigs.map(s => ({
      sym: s.sym, score: s.score, finalProb: s.finalProb,
      price: s.price, rsiD: s.rsiD, rsi4h: s.rsi4h,
      trend: s.trendD >= 1 ? 'UP' : s.trendD === 0 ? 'FLAT' : 'DN',
      buy: s.buy, why: s.why,
      patterns: (s.patterns||[]).map(p => p.name),
      aiMethod: s.aiMethod, regime: s.regime || 'neutral'
    }));

    // 5. Otwórz pozycje
    const dailyBase = state.dailyStartBalance > 0 ? state.dailyStartBalance : (cfg.paperBalance || 1000);
    const dailyLossOk = (state.dailyPnl || 0) > -0.05 * dailyBase;

    if (fg.val < 15) {
      addLog(state, 'F&G=' + fg.val + ' (ekstremalna panika) — blokada BUY', 'warn');
      // explicit return — bez tego blokada była tylko kosmetyczna (logowała warning ale nie zatrzymywała pętli)
    } else if (!dailyLossOk) {
      addLog(state, 'Dzienny limit strat przekroczony (-5% od $' + dailyBase.toFixed(0) + ')', 'err');
    } else if ((state.drawdownBlock || 0) > Date.now()) {
      addLog(state, 'Circuit breaker aktywny — brak nowych pozycji', 'warn');
    } else {
      for (const sig of sigs) {
        if ((state.positions || []).length >= cfg.maxPos) break;
        if (sig.buy) {
          await openTrade(sig, fg, btcDrop, cfg, state, env, nb, gbm, ql, ew);
        }
      }
    }

    // 6. Zapisz modele AI — walk-forward retraining
    const trades = state.trades || [];
    nb.trainFromTrades(trades);

    // Walk-forward: GBM retrenuje co 50 nowych tradów na oknie 200
    const lastRefit = state.lastGbmRefit || 0;
    const tradesSinceRefit = trades.filter(t => { const tsN = typeof t.ts === 'string' ? new Date(t.ts).getTime() : (t.ts||0); return tsN > lastRefit; }).length;
    if ((tradesSinceRefit >= 50 && trades.length >= 20) || (!gbm.trained && trades.length >= 20)) {
      gbm.trainFromTrades(trades.slice(-200));
      state.lastGbmRefit = Date.now();
      addLog(state, 'GBM walk-forward refit: ' + Math.min(trades.length,200) + ' tradów, OOS=' + gbm.accuracyOOS + '%', 'ok');
    }

    // Ensemble rebalancing: co 20 tradów aktualizuj wagi na bazie accuracy
    if (trades.length >= 20 && trades.length % 20 === 0) {
      const ewUpd = rebalanceEnsemble(ew, nb, gbm, trades.slice(0, 20));
      if (ewUpd) {
        Object.assign(ew, ewUpd);
        addLog(state, 'Ensemble rebalanced: nb=' + ew.nb.toFixed(2) + ' gbm=' + ew.gbm.toFixed(2), 'ok');
      }
    }

    state.nb  = nb.save();
    state.gbm = gbm.save();
    state.ql  = ql.save();
    state.ensembleW = ew;
    state.pairParams = pairParams;
    state.adaptiveMinScore = computeAdaptiveMinScore(trades, cfg.minScore);

    // Pobierz realne saldo z Gate.io i zapisz do cache
    if (cfg.mode === 'mexc' && cfg.mexcApiKey && cfg.mexcSecret) {
      try {
        state.liveBalance = await mexcGetBalance(cfg);
      } catch(e) { /* MEXC niedostępne — zachowaj poprzednią wartość */ }
    }

    state.lastCycle = Date.now();
    addLog(state, 'Skan #' + state.iter + ' OK | poz: ' + (state.positions||[]).length + '/' + cfg.maxPos + ' | F&G:' + fg.val, 'ok');

  } catch(e) {
    addLog(state, 'BŁĄD CYKLU: ' + e.message, 'err');
  }

  await env.SWINGAI_KV.put('state', JSON.stringify(state));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ANALIZA TECHNICZNA — MULTI-TF
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VWAP z ostatnich 50 świec 4H
function calcVWAP(highs, lows, closes, volumes) {
  const n = Math.min(50, highs.length);
  let tpVol = 0, vol = 0;
  for (let i = highs.length - n; i < highs.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    tpVol += tp * volumes[i];
    vol   += volumes[i];
  }
  return vol > 0 ? tpVol / vol : closes.at(-1);
}

// Wykryj lokalne pivoty S/R z ostatnich 50 świec Daily
function calcSRLevels(highs, lows, price) {
  const n = Math.min(50, highs.length);
  const start = highs.length - n;
  const pivotHighs = [], pivotLows = [];
  for (let i = start + 2; i < highs.length - 2; i++) {
    if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i+1] && highs[i] > highs[i+2])
      pivotHighs.push(highs[i]);
    if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && lows[i] < lows[i+1] && lows[i] < lows[i+2])
      pivotLows.push(lows[i]);
  }
  // Posortuj i wybierz 3 najbliższe powyżej i 2 poniżej
  const above = pivotHighs.filter(v => v > price).sort((a,b) => a-b).slice(0,3);
  const below = pivotLows.filter(v => v < price).sort((a,b) => b-a).slice(0,2);
  return { above, below, all: [...above, ...below] };
}

// Wykryj reżim rynkowy
function detectRegime(closes, atrD, ema50, ema200) {
  const price = closes.at(-1);
  const atrPct = atrD / price;
  if (atrPct > 0.035) return 'volatile';
  if (Math.abs(ema50/ema200 - 1) < 0.005 && atrPct < 0.02) return 'sideways';
  if (price > ema50 && ema50 > ema200) return 'bull_trend';
  if (price < ema50 && ema50 < ema200) return 'bear_trend';
  return 'neutral';
}

// Sharpe, Sortino, Max Drawdown
function calcStats(trades) {
  if (!trades || trades.length < 5) return { sharpe:0, sortino:0, maxDD:0, winRate:0 };
  const rets = trades.map(t => t.pnlPct / 100);
  const avg = rets.reduce((a,b) => a+b, 0) / rets.length;
  const std = Math.sqrt(rets.reduce((a,b) => a + (b-avg)**2, 0) / rets.length);
  const sharpe = std > 0 ? +(avg / std * Math.sqrt(252)).toFixed(2) : 0;
  const downRets = rets.filter(r => r < 0);
  const downAvg  = downRets.length > 0 ? downRets.reduce((a,b) => a+b, 0) / downRets.length : 0;
  const downStd  = downRets.length > 0 ? Math.sqrt(downRets.reduce((a,b) => a + (b-downAvg)**2, 0) / downRets.length) : 0;
  const sortino = downStd > 0 ? +(avg / downStd * Math.sqrt(252)).toFixed(2) : 0;
  let peak = 1, equity = 1, maxDD = 0;
  for (const r of rets) { equity *= (1 + r); if (equity > peak) peak = equity; const dd = (peak - equity)/peak; if (dd > maxDD) maxDD = dd; }
  const winRate = +(rets.filter(r => r > 0).length / rets.length * 100).toFixed(1);
  return { sharpe, sortino, maxDD: +(maxDD * 100).toFixed(1), winRate };
}

async function analyzeSwing(sym, cfg, state, nb, gbm, ql, ew, pairParams, adaptiveMinScore) {
  // Pobierz timeframe'y sekwencyjnie — OKX rate limit
  const kd      = await getKlines(sym, 'D',   200);
  await sleep(200);
  const k4h     = await getKlines(sym, '240', 100);
  await sleep(200);
  const k1h     = await getKlines(sym, '60',  50);
  await sleep(200);
  const obiData = await getOrderbook(sym);

  const pk = k => ({
    c: k.map(x => +x[4]),
    h: k.map(x => +x[2]),
    l: k.map(x => +x[3]),
    o: k.map(x => +x[1]),
    v: k.map(x => +x[5])
  });
  const d = pk(kd), h4 = pk(k4h), h1 = pk(k1h);
  const price = d.c.at(-1);

  // ━━ Wskaźniki Daily
  const rsiD   = rsi(d.c, 14);
  const macdD  = macdFull(d.c);
  const bbD    = bband(d.c, 20);
  const ema50  = emaLast(d.c, 50);
  const ema200 = emaLast(d.c, 200);
  const atrD   = atr(d.h, d.l, d.c, 14);
  // VWAP 4H
  const vwap4h = calcVWAP(h4.h, h4.l, h4.c, h4.v);
  // S/R levels
  const srLevels = calcSRLevels(d.h, d.l, price);
  // Market Regime
  const regime = detectRegime(d.c, atrD, ema50, ema200);

  // ━━ Wskaźniki 4H
  const rsi4h  = rsi(h4.c, 14);
  const macd4h = macdFull(h4.c);

  // ━━ Wskaźniki 1H
  const rsi1h  = rsi(h1.c, 14);
  const macd1h = macdFull(h1.c);
  const confirm1h = macd1h.hist > 0 && rsi1h < 55;

  // ━━ RSI Divergence
  const rsiArrD  = rsiArray(d.c.slice(-40),  14);
  const rsiArr4h = rsiArray(h4.c.slice(-30), 14);
  const divD  = rsiDivergence(d.c.slice(-40),  rsiArrD,  38);
  const div4h = rsiDivergence(h4.c.slice(-30), rsiArr4h, 28);

  // ━━ Trend
  const trendD = price > ema200 ? (price > ema50 ? 2 : 1) : (price > ema50 ? 0 : -1);

  // ━━ Volume
  const _vSum20 = d.v.length >= 20 ? d.v.slice(-20).reduce((a,b)=>a+b,0) : 0;
  const volR  = (_vSum20 > 0) ? d.v.at(-1) / (_vSum20/20) : 1;
  const _v4Sum20 = h4.v.length >= 20 ? h4.v.slice(-20).reduce((a,b)=>a+b,0) : 0;
  const vol4R = (_v4Sum20 > 0) ? h4.v.at(-1) / (_v4Sum20/20) : 1;

  // ━━ Momentum
  const mom5  = d.c.length > 5  ? (price / d.c.at(-6)  - 1) * 100 : 0;
  const mom10 = d.c.length > 10 ? (price / d.c.at(-11) - 1) * 100 : 0;

  // ━━ Scoring
  let score = 0;
  const why = [];

  if      (rsiD <= 25) { score += 30; why.push('RSI-D=' + rsiD.toFixed(0) + ' (extreme OS)'); }
  else if (rsiD <= 32) { score += 24; why.push('RSI-D oversold (' + rsiD.toFixed(0) + ')'); }
  else if (rsiD <= 40) { score += 16; why.push('RSI-D low (' + rsiD.toFixed(0) + ')'); }
  else if (rsiD <= 48) { score += 8; }
  else if (rsiD >= 70) { score -= 15; why.push('RSI-D wykupiony'); }

  if      (rsi4h <= 30) { score += 15; why.push('RSI-4H oversold'); }
  else if (rsi4h <= 40) { score += 10; why.push('RSI-4H low'); }
  else if (rsi4h <= 50) { score += 5; }
  else if (rsi4h >= 70) { score -= 10; why.push('RSI-4H wykupiony'); }

  if      (macdD.hist > 0 && macdD.line < 0) { score += 20; why.push('MACD cross up Daily'); }
  else if (macdD.hist > 0)                    { score += 12; why.push('MACD hist+ Daily'); }
  else if (macdD.hist > -atrD * 0.005)        { score += 4; }
  else                                         { score -= 5; }

  if      (bbD.pos < 0.08) { score += 18; why.push('Cena przy dolnej BB'); }
  else if (bbD.pos < 0.20) { score += 13; why.push('BB dolna strefa'); }
  else if (bbD.pos < 0.35) { score += 6; }
  else if (bbD.pos > 0.85) { score -= 10; why.push('BB górna — ryzyko'); }

  if      (trendD === 2)  { score += 12; why.push('Ponad EMA50+200 — bull'); }
  else if (trendD === 1)  { score += 8;  why.push('Ponad EMA200'); }
  else if (trendD === 0)  { score += 3; }
  else                    { score -= 20; why.push('Poniżej EMA200 — bessa'); }

  if      (mom5 > 0 && mom10 < 0)    { score += 8; why.push('Momentum odwrócenie'); }
  else if (mom5 < -5 && mom10 < -10) { score += 5; why.push('Oversold momentum'); }
  else if (mom5 > 8)                  { score -= 5; why.push('Zbyt szybki wzrost'); }

  if (volR > 1.8 || vol4R > 2.0) { score += 5; why.push('Vol spike x' + Math.max(volR,vol4R).toFixed(1)); }
  else if (volR < 0.4)            { score -= 8; why.push('Niski wolumen'); }

  if (macd4h.hist > 0 && macdD.hist > 0) { score += 5; why.push('MACD 4H+D zgodność'); }
  if (confirm1h)  { score += 5; why.push('1H potwierdza'); }
  else            { score -= 3; }

  // RSI Divergence
  if      (divD.bull && div4h.bull) { score += 20; why.push('RSI dywergencja bycza D+4H'); }
  else if (divD.bull)               { score += 14; why.push('RSI dywergencja bycza Daily'); }
  else if (div4h.bull)              { score += 8;  why.push('RSI dywergencja bycza 4H'); }
  if (divD.bear)  { score -= 12; why.push('RSI dywergen. niedźwiedzia Daily'); }
  if (div4h.bear) { score -= 7;  why.push('RSI dywergen. niedźwiedzia 4H'); }

  if (trendD === -1 && rsiD > 50) { score = Math.min(score, 15); why.push('BESSA: brak long'); }
  score = Math.max(0, Math.min(100, Math.round(score)));

  // VWAP scoring
  if (price > vwap4h) { score += 8;  why.push('Ponad VWAP'); }
  else                { score -= 5;  why.push('Poniżej VWAP'); }
  score = Math.max(0, Math.min(100, score));

  // S/R scoring
  const srSupport    = srLevels.below.find(s => Math.abs(price/s - 1) <= 0.015);
  const srResistance = srLevels.above.find(r => price > r * 0.985);
  if (srSupport)    { score += 12; why.push('S/R support'); }
  if (srResistance) { score -= 10; why.push('Pod oporem S/R'); }
  score = Math.max(0, Math.min(100, score));

  // Regime scoring
  let regimeMinScoreAdj = 0;
  if (regime === 'sideways')   { regimeMinScoreAdj = 8; }
  if (regime === 'bull_trend') { score += 5; why.push('Reżim: bull trend'); }
  if (regime === 'bear_trend') { score -= 15; why.push('Reżim: bear trend'); }
  if (regime === 'volatile')   { score -= 8;  why.push('Reżim: volatile'); }
  score = Math.max(0, Math.min(100, score));

  // ━━ Candlestick Patterns
  const patResult = PATTERNS.detect(d.c, d.o, d.h, d.l);
  if (patResult.bullish > 0) {
    const volOk = volR >= 1.3;
    const eff   = volOk ? patResult.bullish : Math.floor(patResult.bullish * 0.5);
    score = Math.min(100, score + Math.min(15, eff * 6));
    patResult.patterns.filter(p=>p.type==='bullish').forEach(p=>why.push(p.name + (volOk?'':' (słaby vol)')));
  }
  if (patResult.bearish > 0) {
    score = Math.max(0, score - Math.min(12, patResult.bearish * 5));
    patResult.patterns.filter(p=>p.type==='bearish').forEach(p=>why.push('⚠ ' + p.name));
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  // ━━ OBI (Order Book Imbalance)
  const obiScore = calcOBI(obiData);
  if (obiScore > 0) { score = Math.min(100, score + obiScore); why.push('OBI bycze'); }
  if (obiScore < 0) { score = Math.max(0,   score + obiScore); why.push('OBI niedźwiedzie'); }

  // ━━ ML Predictions
  const nbFeatures  = nb.discretize({ rsiD, macdHist: macdD.hist, bbPos: bbD.pos, trendD, mom5, confirm1h });
  const bodyRatio  = Math.abs(d.c.at(-1) - d.o.at(-1)) / (d.h.at(-1) - d.l.at(-1) + 0.001);
  const atrPctFeat = Math.min(1, atrD / price / 0.1);
  const emaSlopeD  = Math.max(-1, Math.min(1, (ema50/ema200 - 1) * 10));
  const gbmFeatures = [rsiD/100, macdD.hist>0?1:0, bbD.pos, (trendD+1)/3, mom5/20, mom10/20, confirm1h?1:0, volR/3, obiData.ratio||0.5, bodyRatio, atrPctFeat, emaSlopeD];

  const nbPred  = nb.predict({ rsiD, macdHist: macdD.hist, bbPos: bbD.pos, trendD, mom5, confirm1h });
  const gbmProb = gbm.predict(gbmFeatures);

  const qlSig   = { rsiD, macdHist: macdD.hist, trendD, bbPos: bbD.pos, obiRatio: obiData.ratio || 0.5 };
  const qlSugg  = ql.suggests(qlSig);
  let qlBonus = 0;
  if (qlSugg) {
    if (qlSugg.action === 'BUY'  && qlSugg.confidence > 0.05) { qlBonus =  8; why.push('QL: BUY'); }
    // HOLD jest neutralny — nie karamy za brak sygnału
    score = Math.max(0, Math.min(100, score + qlBonus));
  }

  // ━━ Ensemble
  let finalProb = score / 100;
  let aiMethod  = 'Score';
  const obiNorm = ((obiData.ratio || 0.5) - 0.3) / 0.4;

  if (nb.trained && gbm.trained) {
    const wSum = (ew.score + ew.nb + ew.gbm + ew.obi + ew.ql) || 1;
    finalProb = Math.max(0, Math.min(1,
      (score/100 * ew.score + nbPred.prob * ew.nb + gbmProb * ew.gbm +
       Math.max(0, Math.min(1, obiNorm)) * ew.obi +
       (qlSugg && qlSugg.action==='BUY' ? 1 : 0) * ew.ql) / wSum));
    aiMethod = 'Ensemble(Score+NB+GBM+OBI+QL)';
    if (nbPred.label === 'SKIP' && gbmProb < 0.4) why.push('AI odradza wejście');
  } else if (nb.trained) {
    const wSum = (ew.score + ew.nb + ew.obi) || 1;
    finalProb = (score/100 * ew.score + nbPred.prob * ew.nb + Math.max(0,Math.min(1,obiNorm)) * ew.obi) / wSum;
    aiMethod  = 'Score+NB+OBI';
  }

  // ━━ Per-pair threshold
  const pp       = pairParams[sym] || PAIR_PARAMS_DEFAULT[sym] || null;
  const minScore = (pp ? pp.minScore : adaptiveMinScore) + regimeMinScoreAdj;
  const buy      = finalProb >= minScore / 100;

  return {
    sym, price,
    rsiD: +rsiD.toFixed(1), rsi4h: +rsi4h.toFixed(1), rsi1h: +rsi1h.toFixed(1), confirm1h,
    macdHist: macdD.hist, macdLine: macdD.line,
    bbPos: bbD.pos, trendD, ema50, ema200, atrD,
    score, finalProb: +finalProb.toFixed(3), buy,
    nbPred, gbmProb: +gbmProb.toFixed(3), qlSugg, aiMethod,
    obiRatio: obiData.ratio || 0.5, obiScore,
    patterns: patResult.patterns,
    srLevels, vwap4h, regime,
    why, nbFeatures, gbmFeatures, qlSig,
    volR: +volR.toFixed(2), vol4R: +vol4R.toFixed(2),
    mom5: +mom5.toFixed(2), mom10: +mom10.toFixed(2)
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ZARZĄDZANIE POZYCJAMI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function checkPositions(cfg, state, env, ql) {
  const updated = [];
  for (const pos of (state.positions || [])) {
    try {
      const price = await getLastPrice(pos.sym);
      pos.cp = price;
      if (price > pos.highP) pos.highP = price;

      const pnlPct = (price - pos.entry) / pos.entry * 100;
      const trail  = pos.highP * (1 - pos.trailDist);
      let reason = null;

      // Timeout 7 dni
      // Po partial TP pos.sl = entry*(1+FEE*2) — break-even powyżej entry dla long.
      // Sprawdzamy bezpośrednio cenę vs pos.sl zamiast liczyć pnlPct threshold (który byłby dodatni i nigdy nie wyzwoliłby SL).
      if (Date.now() - pos.entryTs > TIMEOUT_MS) reason = 'TIMEOUT 7d';
      else if (pnlPct >= cfg.tp * 100)             reason = 'TAKE PROFIT';
      else if (pos.partialClosed ? price <= pos.sl : pnlPct <= -cfg.sl * 100) reason = 'STOP LOSS';
      else if (price <= trail && pnlPct > 1.5)     reason = 'TRAILING STOP';

      // Partial TP (50% pozycji przy połowie TP)
      const _tpPct6 = pos.tp > 0 ? (pos.tp - pos.entry) / pos.entry * 100 : cfg.tp * 100;
       if (!reason && pnlPct >= _tpPct6 * 0.5 && !pos.partialClosed) {
         const halfQty = pos.qty / 2;
         const halfPnl = (price - pos.entry) * halfQty;
         const halfSize = pos.size / 2;
         let partialOk = true;
         if (cfg.mode === 'mexc' && cfg.mexcApiKey) {
           try {
             await mexcMarketSell(pos.sym, halfQty, cfg);
           } catch(e) {
             addLog(state, 'PARTIAL SELL FAILED ' + pos.sym + ': ' + e.message, 'err');
             partialOk = false;
           }
         }
         if (partialOk) {
           pos.qty = halfQty;
           pos.size = halfSize;
           pos.partialClosed = true;
           pos.sl = pos.entry * (1 + FEE * 2); // break-even po obu prowizjach
           if (cfg.mode === 'paper') {
             state.paperBalance = (state.paperBalance || 0) + halfSize + halfPnl;
           }
           addLog(state, 'PARTIAL TP ' + pos.sym + ' +$' + halfPnl.toFixed(2) + ' (' + pnlPct.toFixed(1) + '%) → reszta jedzie dalej', 'ok');
         }
       }

      if (reason) {
        const closed = await closePosition(pos, price, reason, cfg, state, ql);
        if (closed === false) {
          // SELL FAILED — zachowaj pozycję
          updated.push(pos);
        }
      } else {
        updated.push(pos);
      }
    } catch(e) {
      addLog(state, 'checkPos ' + pos.sym + ': ' + e.message, 'err');
      updated.push(pos);
    }
    await sleep(150);
  }
  state.positions = updated;
}

async function openTrade(sig, fg, btcDrop, cfg, state, env, nb, gbm, ql, ew) {
  if ((state.positions||[]).some(p => p.sym === sig.sym)) return;
  if (((state.cooldown || {})[sig.sym] || 0) > Date.now()) {
    addLog(state, 'Cooldown ' + sig.sym, 'warn'); return;
  }
  if ((state.globalBlockUntil||0) > Date.now()) {
    addLog(state, 'Globalna blokada aktywna', 'warn'); return;
  }
  if (isPumpDump(sig)) return;
  if (isVolumeAnomaly(sig)) { addLog(state, 'Vol anomaly: ' + sig.sym + ' vol=' + sig.volR.toFixed(2) + 'x — pomijam', 'warn'); return; }
  if (isDeadHour()) { addLog(state, 'Dead hour (01-05 UTC): ' + sig.sym + ' — pomijam', 'warn'); return; }

  // BTC Guard
  if (btcDrop && sig.sym !== 'BTC_USDC') {
    addLog(state, 'BTC Guard: pomijam ' + sig.sym, 'warn'); return;
  }

  // Correlation Guard
  if (corrBlocked(sig.sym, state)) return;

  // Fear & Greed penalty
  let adjSig = sig;
  if (fg.val < cfg.fgMin) {
    const newProb = Math.max(0, sig.finalProb - 0.10);
    adjSig = Object.assign({}, sig, { finalProb: newProb, score: Math.max(0, sig.score - 10) });
    const pp = (state.pairParams||{})[sig.sym] || PAIR_PARAMS_DEFAULT[sig.sym];
    const minSc = pp ? pp.minScore : (state.adaptiveMinScore || cfg.minScore);
    if (adjSig.finalProb < minSc / 100) {
      addLog(state, 'F&G=' + fg.val + ' — po karze za słaby score pomijam ' + sig.sym, 'warn'); return;
    }
  }

  const paperBal = state.paperBalance > 0 ? state.paperBalance : (cfg.paperBalance || 1000);
  const total    = cfg.mode === 'mexc' ? (state.liveBalance > 0 ? state.liveBalance : paperBal) : paperBal;
  const micro    = isMicroAccount(total);

  // Micro account: max 1 pozycja naraz
  if (micro && (state.positions || []).length >= 1) {
    addLog(state, 'Micro konto — czekam na zamkniecie obecnej pozycji', 'warn'); return;
  }

  // Portfolio Heat check — tylko dla normalnych kont (>= 100$)
  if (!micro) {
    const totalRisk     = (state.positions || []).reduce((s, p) => {
      const slPct = p.partialClosed
        ? 0
        : (p.entry > 0 ? Math.abs((p.sl || 0) - p.entry) / p.entry : cfg.sl);
      return s + (p.size||0) * slPct;
    }, 0);
    const portfolioHeat = totalRisk / (total > 0 ? total : 1);
    if (portfolioHeat > 0.10) {
      addLog(state, 'Portfolio heat >10% — blokada (' + (portfolioHeat*100).toFixed(1) + '%)', 'warn');
      return;
    }
  }

  const posSize  = kellySize(cfg, state, total);
  const minSize  = micro ? 1 : 10;
  if (posSize < minSize) {
    addLog(state, 'Za mala pozycja (' + posSize.toFixed(2) + '$) — pomijam ' + sig.sym, 'warn'); return;
  }
  const levels = calcDynamicLevels(adjSig.price, adjSig.atrD, cfg);

  addLog(state,
    'BUY ' + adjSig.sym + ' @ ' + adjSig.price.toFixed(4) +
    ' | score=' + adjSig.score + ' finalProb=' + (adjSig.finalProb*100).toFixed(1) + '%' +
    ' | $' + posSize.toFixed(2) + ' TP=' + (levels.tp).toFixed(4) +
    ' SL=' + (levels.sl).toFixed(4) + ' R:R=' + levels.rr +
    ' | ' + adjSig.aiMethod + ' | ' + cfg.mode.toUpperCase(), 'ok');
  if (!Array.isArray(state.positions)) state.positions = [];

  if (cfg.mode === 'mexc' && cfg.mexcApiKey) {
    try {
      const res = await mexcMarketBuy(adjSig.sym, posSize, cfg);
      const execP = res.price || adjSig.price;
      const el    = calcDynamicLevels(execP, adjSig.atrD, cfg);
      state.positions.push(buildPosition(adjSig, execP, res.qty, el, posSize, ql));
      // Ustaw dailyStartBalance przy pierwszej transakcji live w danym dniu
      if (!state.dailyStartBalance || state.dailyStartBalance <= 0) {
        try {
          const liveBal = await mexcGetBalance(cfg);
          state.dailyStartBalance = (typeof liveBal === 'number' && liveBal > 0) ? liveBal : posSize * (cfg.maxPos || 4);
        } catch(_) {
          state.dailyStartBalance = posSize * (cfg.maxPos || 4);
        }
      }
    } catch(e) {
      addLog(state, 'BUY FAILED ' + adjSig.sym + ': ' + e.message, 'err');
      return;
    }
  } else {
    const qty = posSize / adjSig.price;
    state.positions.push(buildPosition(adjSig, adjSig.price, qty, levels, posSize, ql));
    if (cfg.mode === 'paper') {
      state.paperBalance = Math.max(0, (state.paperBalance || paperBal) - posSize);
    }
    if (!state.dailyStartBalance || state.dailyStartBalance <= 0) {
      state.dailyStartBalance = paperBal;
    }
  }

  const _pairName = adjSig.sym.replace('_USDC', '').replace('_USDT', '');
  const _modeLabel = cfg.mode === 'mexc' ? 'LIVE (MEXC)' : 'PAPER (symulacja)';
  await tgSend(cfg,
    '🟢 <b>SYGNAŁ KUPNA — ' + _pairName + '</b>\n\n' +
    '💰 Cena wejścia: <b>$' + adjSig.price.toFixed(4) + '</b>\n' +
    '💵 Rozmiar pozycji: <b>$' + posSize.toFixed(2) + '</b> (Kelly)\n' +
    '🎯 Take Profit: <b>$' + levels.tp.toFixed(4) + '</b>\n' +
    '🛑 Stop Loss: <b>$' + levels.sl.toFixed(4) + '</b>\n' +
    '⚖️ Zysk/Ryzyko: <b>' + levels.rr + '</b>\n\n' +
    '📊 Wynik AI: <b>' + adjSig.score + '/100</b> | Pewność: <b>' + (adjSig.finalProb*100).toFixed(1) + '%</b>\n' +
    '🤖 Metoda: ' + adjSig.aiMethod + '\n' +
    '📝 Powody: ' + adjSig.why.slice(0,4).join(', ') + '\n\n' +
    '🔧 Tryb: ' + _modeLabel);
}

function buildPosition(sig, price, qty, levels, size, ql) {
  return {
    sym: sig.sym, entry: price, qty, cp: price, highP: price,
    sl: levels.sl, tp: levels.tp, trailDist: levels.trail,
    entryTs: Date.now(), score: sig.score, finalProb: sig.finalProb,
    aiMethod: sig.aiMethod, nbFeatures: sig.nbFeatures, gbmFeatures: sig.gbmFeatures,
    qlSig: sig.qlSig, gbmProb: sig.gbmProb, nbLabel: sig.nbPred ? sig.nbPred.label : 'NEUTRAL',
    why: sig.why.join(', '), size, rr: levels.rr
  };
}

async function closePosition(pos, price, reason, cfg, state, ql) {
  const grossPnl = (price - pos.entry) * pos.qty;
  const feeCost  = pos.size * FEE + (pos.size + grossPnl) * FEE;
  const pnl      = grossPnl - feeCost;
  const pnlPct   = pnl / pos.size * 100;
  const durH   = ((Date.now() - pos.entryTs) / 3600000).toFixed(1);

  if (cfg.mode === 'mexc' && cfg.mexcApiKey) {
    try {
      await mexcMarketSell(pos.sym, pos.qty, cfg);
    } catch(e) {
      addLog(state, 'SELL FAILED ' + pos.sym + ': ' + e.message, 'err');
      // Zwróć false żeby checkPositions mogło zachować pozycję w updated[]
      return false;
    }
  } else if (cfg.mode === 'paper') {
    state.paperBalance = (state.paperBalance || 0) + pos.size + pnl;
  }

  state.dailyPnl = (state.dailyPnl || 0) + pnl;
  if (pnl < 0) {
    state.consLoss = (state.consLoss || 0) + 1;
    if (!state.cooldown || typeof state.cooldown !== 'object') state.cooldown = {};
    state.cooldown[pos.sym] = Date.now() + 12 * 3600000;
    if (state.consLoss >= 4) {
      state.globalBlockUntil = Date.now() + 3 * 3600000;
      addLog(state, '4 straty z rzędu — blokada 3h', 'err');
    }
  } else {
    state.consLoss = 0;
  }

  // Q-Learning update — nagroda normalizowana do [-1, +1]
  if (pos.qlSig && ql) {
    const reward = Math.max(-1, Math.min(1, pnlPct / 10));
    ql.update(pos.qlSig, 'BUY', reward, null);
  }

  const trade = {
    sym: pos.sym, entry: pos.entry, exit: price, qty: pos.qty,
    pnl: +pnl.toFixed(4), pnlPct: +pnlPct.toFixed(2),
    durH, reason, score: pos.score, finalProb: pos.finalProb,
    aiMethod: pos.aiMethod, nbFeatures: pos.nbFeatures, gbmFeatures: pos.gbmFeatures,
    nbLabel: pos.nbLabel || 'NEUTRAL', ts: Date.now()
  };
  state.trades = [trade, ...(state.trades || [])].slice(0, 300);
  state.stats = calcStats(state.trades);

  const _closeIcon = pnl >= 0 ? '🟢' : '🔴';
  const _closeSym = pos.sym.replace('_USDC','').replace('_USDT','');
  const _reasonPL = reason === 'TAKE PROFIT' ? 'REALIZACJA ZYSKU' :
    reason === 'STOP LOSS' ? 'STOP LOSS AKTYWOWANY' :
    reason === 'TRAILING STOP' ? 'STOP KROCZĄCY' :
    reason === 'TIMEOUT 7d' ? 'KONIEC CZASU (7 dni)' : reason;
  addLog(state,
    _closeIcon + ' ' + pos.sym + ' ' + reason +
    ' P/L: ' + (pnl>=0?'+':'') + '$' + pnl.toFixed(2) +
    ' (' + pnlPct.toFixed(2) + '%) | ' + durH + 'h | R:R=' + (pos.rr||'?'),
    pnl >= 0 ? 'ok' : 'err');

  await tgSend(cfg,
    _closeIcon + ' <b>' + _reasonPL + ' — ' + _closeSym + '</b>\n\n' +
    '💰 Wynik: <b>' + (pnl>=0?'+':'') + '$' + pnl.toFixed(2) + ' (' + pnlPct.toFixed(2) + '%)</b>\n' +
    '⏱️ Czas trwania: ' + durH + 'h\n' +
    '📊 Score wejścia: ' + pos.score + '/100\n' +
    '🔧 Tryb: ' + (cfg.mode === 'mexc' ? 'LIVE (MEXC)' : 'PAPER'));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GUARDS — FILTRY BEZPIECZEŃSTWA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function isPumpDump(sig) {
  if (sig.vol4R > 4.0) { return true; }
  if (sig.mom5  > 15)  { return true; }
  return false;
}

function isVolumeAnomaly(sig) {
  if (sig.volR < 0.35) return true;
  if (sig.score >= 62 && sig.vol4R < 0.3) return true;
  return false;
}

function isDeadHour() {
  const h = new Date().getUTCHours();
  return h >= 1 && h < 5;
}

async function btcDropGuard() {
  try {
    const r = await fetchWithTimeout('https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BTC_USDC');
    const d = await r.json();
    if (!Array.isArray(d) || !d[0]) return false;
    return parseFloat(d[0].change_percentage || '0') < -5;
  } catch(e) { return false; }
}

function corrBlocked(sym, state) {
  let group = -1;
  for (let i = 0; i < CORR_GROUPS.length; i++) {
    if (CORR_GROUPS[i].indexOf(sym) !== -1) { group = i; break; }
  }
  if (group < 0) return false;
  const openInGroup = (state.positions || []).filter(p => {
    for (let i = 0; i < CORR_GROUPS.length; i++)
      if (CORR_GROUPS[i].indexOf(p.sym) !== -1 && i === group) return true;
    return false;
  }).length;
  return openInGroup >= 1;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RISK MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Micro account mode: balance < 100 → 1 pozycja, 90% kapitału, brak Kelly cap
function isMicroAccount(total) { return (isFinite(total) && total > 0 && total < 100); }

function kellySize(cfg, state, total) {
  const safeTotal = (isFinite(total) && total > 0) ? total : 100;

  // Micro account: inwestuj 90% salda, min 1$
  if (isMicroAccount(safeTotal)) {
    return Math.max(1, Math.round(safeTotal * 0.90 * 100) / 100);
  }

  const fixedSize = cfg.posSize || 15;
  const trades    = (state.trades || []).slice(-30);
  if (trades.length < 5) {
    return Math.min(fixedSize, Math.max(10, safeTotal * (cfg.riskPct || 2) / 100));
  }
  const wins   = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const p    = wins.length / trades.length;
  const avgW = wins.length   ? wins.reduce((a,t)=>a+t.pnlPct,0)/wins.length/100   : cfg.tp;
  const avgL = losses.length ? Math.abs(losses.reduce((a,t)=>a+t.pnlPct,0)/losses.length)/100 : cfg.sl;
  const b    = avgW / (avgL > 0 ? avgL : cfg.sl || 0.04);
  if (!isFinite(b) || b <= 0) return Math.min(fixedSize, Math.max(10, safeTotal * (cfg.riskPct||2)/100));
  let kelly = (b * p - (1 - p)) / b;
  if (kelly <= 0) return Math.min(fixedSize, Math.max(5, safeTotal * 0.02));
  kelly = Math.min(0.05, kelly * 0.5);
  const sz = Math.max(5, Math.round(safeTotal * kelly * 100) / 100);
  return Math.min(fixedSize, sz, safeTotal * 0.20);
}

function calcDynamicLevels(price, atrD, cfg) {
  const atrPct   = atrD / price;
  const tpOffset = Math.max(cfg.tp,   atrPct * 2.5);
  const slOffset = Math.max(cfg.sl,   atrPct * 1.5);
  const trail    = Math.max(cfg.trail, atrPct * 1.2);
  const tp    = price * (1 + tpOffset);
  const sl    = price * (1 - slOffset);
  const rr    = ((tp - price) / (price - sl)).toFixed(1);
  return { tp, sl, trail, rr, atrPct: (atrPct*100).toFixed(2) };
}

function computeAdaptiveMinScore(trades, baseMin) {
  if (!trades || trades.length < 10) return baseMin;
  const recent = trades.slice(0, 20);
  const winRate = recent.filter(t => t.pnl > 0).length / recent.length;
  if (winRate < 0.4) return Math.min(75, baseMin + 5);
  if (winRate > 0.65) return Math.max(50, baseMin - 3);
  return baseMin;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FORMACJE ŚWIECOWE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const PATTERNS = {
  detect(closes, opens, highs, lows) {
    const n = closes.length;
    if (n < 5) return { patterns:[], score:0, bullish:0, bearish:0 };
    const o=opens, h=highs, l=lows, c=closes;
    const i = n - 1;
    const patterns = [];

    const body  = j => Math.abs(c[j]-o[j]);
    const range = j => h[j]-l[j];
    const isUp  = j => c[j] > o[j];
    const isDown = j => c[j] < o[j];
    const atrVal = (range(i)+range(i-1)+range(i-2))/3 || 1;

    // HAMMER
    const lowerSh = isUp(i) ? o[i]-l[i] : c[i]-l[i];
    const upperSh = isUp(i) ? h[i]-c[i] : h[i]-o[i];
    if (body(i) < atrVal*0.3 && lowerSh > body(i)*2 && upperSh < body(i)*0.5 && isDown(i-1)) {
      patterns.push({ name:'Hammer', type:'bullish', strength:75, desc:'Silne odrzucenie w dół' });
    }
    // BULLISH ENGULFING
    if (isDown(i-1) && isUp(i) && o[i]<c[i-1] && c[i]>o[i-1] && body(i)>body(i-1)*1.1) {
      patterns.push({ name:'Bullish Engulfing', type:'bullish', strength:82, desc:'Popyt przytłoczył podaż' });
    }
    // MORNING STAR
    if (n>=3 && isDown(i-2) && body(i-1)<atrVal*0.25 && isUp(i) && c[i]>(o[i-2]+c[i-2])/2) {
      patterns.push({ name:'Morning Star', type:'bullish', strength:85, desc:'Odwrócenie trendu spadkowego' });
    }
    // DOJI
    if (body(i) < atrVal*0.1 && range(i) > atrVal*0.3) {
      const t = (isDown(i-1)||isDown(i-2)) ? 'bullish' : 'neutral';
      patterns.push({ name:'Doji', type:t, strength:55, desc:'Rynek niezdecydowany' });
    }
    // PIERCING LINE
    if (isDown(i-1) && isUp(i) && o[i]<l[i-1] && c[i]>(o[i-1]+c[i-1])/2 && c[i]<o[i-1]) {
      patterns.push({ name:'Piercing Line', type:'bullish', strength:70, desc:'Kupujący weszli po bessie' });
    }
    // THREE WHITE SOLDIERS
    if (n>=3 && isUp(i) && isUp(i-1) && isUp(i-2) && c[i]>c[i-1] && c[i-1]>c[i-2] && body(i)>atrVal*0.4 && body(i-1)>atrVal*0.4) {
      patterns.push({ name:'Three White Soldiers', type:'bullish', strength:80, desc:'Silny trend wzrostowy' });
    }
    // SHOOTING STAR
    const upperSh2 = isUp(i) ? h[i]-c[i] : h[i]-o[i];
    const lowerSh2 = isUp(i) ? o[i]-l[i] : c[i]-l[i];
    if (body(i)<atrVal*0.3 && upperSh2>body(i)*2 && lowerSh2<body(i)*0.5 && isUp(i-1)) {
      patterns.push({ name:'Shooting Star', type:'bearish', strength:72, desc:'Ostrzeżenie przed korektą' });
    }
    // BEARISH ENGULFING
    if (isUp(i-1) && isDown(i) && o[i]>c[i-1] && c[i]<o[i-1] && body(i)>body(i-1)*1.1) {
      patterns.push({ name:'Bearish Engulfing', type:'bearish', strength:78, desc:'Podaż przejęła kontrolę' });
    }

    const bullish = patterns.filter(p=>p.type==='bullish').length;
    const bearish = patterns.filter(p=>p.type==='bearish').length;
    const score   = patterns.reduce((s,p)=>s+(p.type==='bullish'?p.strength:-p.strength),0);
    return { patterns, score, bullish, bearish };
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MODUŁY AI/ML
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function rebalanceEnsemble(ew, nb, gbm, recentTrades) {
  if (!recentTrades || recentTrades.length < 10) return null;
  const newEw = { score: ew.score, nb: ew.nb, gbm: ew.gbm, obi: ew.obi, ql: ew.ql };

  // NB accuracy: sprawdź czy zapisany nbLabel zgadza się z wynikiem
  let nbCorrect = 0, nbTotal = 0;
  recentTrades.forEach(t => {
    if (!t.nbLabel) return;
    nbTotal++;
    if ((t.nbLabel === 'BUY' && t.pnl > 0) || (t.nbLabel !== 'BUY' && t.pnl <= 0)) nbCorrect++;
  });
  if (nbTotal >= 5) {
    const nbAcc = nbCorrect / nbTotal;
    newEw.nb = +Math.max(0.3, Math.min(1.5, nbAcc * 2)).toFixed(2);
  }

  // GBM OOS accuracy
  const gbmAcc = gbm.accuracyOOS > 0 ? gbm.accuracyOOS / 100 : 0.5;
  newEw.gbm = +Math.max(0.3, Math.min(1.5, gbmAcc * 2)).toFixed(2);

  newEw.score = 1.0;
  newEw.obi = 0.3;
  return newEw;
}

function makeNB(saved) {
  const nb = {
    model: null, trained: false, trainCount: 0,

    discretize(f) {
      return [
        f.rsiD<=30?0:f.rsiD<=45?1:f.rsiD<=60?2:3,
        f.macdHist>0.001?2:f.macdHist>-0.001?1:0,
        f.bbPos<0.2?0:f.bbPos<0.5?1:f.bbPos<0.8?2:3,
        f.trendD+1,
        f.mom5<-5?0:f.mom5<0?1:f.mom5<5?2:3,
        f.confirm1h?1:0
      ];
    },

    trainFromTrades(trades) {
      if (trades.length < 10) return false;
      const bins = [4,3,4,4,4,2];
      const nF   = 6;
      const counts = { 0:{}, 1:{} };
      const cc     = { 0:0, 1:0 };
      [0,1].forEach(cl => {
        for (let f=0;f<nF;f++) for (let b=0;b<bins[f];b++) counts[cl][f+'_'+b]=1;
      });
      trades.forEach(t => {
        if (!t.nbFeatures) return;
        const lbl = t.pnl > 0 ? 1 : 0;
        cc[lbl]++;
        t.nbFeatures.forEach((bin,f) => { counts[lbl][f+'_'+bin] = (counts[lbl][f+'_'+bin]||0)+1; });
      });
      const total = cc[0]+cc[1];
      if (total < 5) return false;
      this.model = { counts, cc, total, bins, nF };
      this.trained = true; this.trainCount = total;
      return true;
    },

    predict(features) {
      if (!this.trained || !this.model) return { prob:0.5, confidence:'low', label:'NEUTRAL' };
      const m = this.model;
      const bins = this.discretize(features);
      const lp = {};
      [0,1].forEach(cl => {
        let p = Math.log((m.cc[cl]+1)/(m.total+2));
        for (let f=0;f<m.nF;f++) {
          const k = f+'_'+bins[f];
          const cnt = m.counts[cl][k]||1;
          const tot = Object.keys(m.counts[cl]).filter(k2=>k2.startsWith(f+'_')).reduce((s,k2)=>s+(m.counts[cl][k2]||0),0);
          p += Math.log(cnt/Math.max(tot,1));
        }
        lp[cl] = p;
      });
      const mx = Math.max(lp[0],lp[1]);
      const e0=Math.exp(lp[0]-mx), e1=Math.exp(lp[1]-mx);
      const prob = e1/(e0+e1);
      const conf = prob>0.7||prob<0.3?'high':prob>0.6||prob<0.4?'medium':'low';
      return { prob:+prob.toFixed(3), confidence:conf, label:prob>0.55?'BUY':prob<0.45?'SKIP':'NEUTRAL' };
    },

    save() { return { model:this.model, trained:this.trained, trainCount:this.trainCount }; }
  };
  if (saved) { nb.model=saved.model; nb.trained=saved.trained; nb.trainCount=saved.trainCount||0; }
  return nb;
}

function predictFromTrees(trees, lr, x) {
  let F = 0.5;
  trees.forEach(t => { F += lr * (x[t.fi] <= t.th ? t.lVal : t.rVal); });
  return Math.max(0, Math.min(1, F));
}

function makeGBM(saved) {
  const gbm = {
    trees: [], lr: 0.1, trained: false, accuracy: 0, accuracyOOS: 0,

    buildStump(X, residuals) {
      const nF = X[0].length;
      let bestGain=-Infinity, best=null;
      for (let fi=0;fi<nF;fi++) {
        const vals = X.map(x=>x[fi]).sort((a,b)=>a-b);
        for (let ti=1;ti<5;ti++) {
          const th = vals[Math.floor(ti*vals.length/5)];
          const left=[], right=[];
          X.forEach((x,i) => (x[fi]<=th?left:right).push(residuals[i]));
          if (!left.length||!right.length) continue;
          const lM=left.reduce((a,b)=>a+b,0)/left.length;
          const rM=right.reduce((a,b)=>a+b,0)/right.length;
          const gain=left.length*lM*lM+right.length*rM*rM;
          if (gain>bestGain) { bestGain=gain; best={fi,th,lVal:lM,rVal:rM}; }
        }
      }
      return best;
    },

    trainFromTrades(trades) {
      if (trades.length < 20) return false;
      const X=[], y=[];
      trades.forEach(t => { if (t.gbmFeatures&&t.gbmFeatures.length===12) { X.push(t.gbmFeatures); y.push(t.pnl>0?1:0); } });
      if (X.length < 20) return false;
      const si = Math.floor(X.length*0.7);
      const Xt=X.slice(0,si), yt=y.slice(0,si);
      this.trees=[];
      let F = new Array(Xt.length).fill(0.5);
      for (let t=0;t<20;t++) {
        const res = yt.map((yi,i)=>yi-F[i]);
        const tree = this.buildStump(Xt, res);
        if (!tree) break;
        this.trees.push(tree);
        F = F.map((fi,i)=>fi+this.lr*(Xt[i][tree.fi]<=tree.th?tree.lVal:tree.rVal));
      }
      const ok = F.filter((f,i)=>(f>0.5?1:0)===yt[i]).length;
      this.accuracy = +(ok/Xt.length*100).toFixed(1);
      // Walk-forward OOS accuracy
      let oosOk = 0;
      for (let i = si; i < X.length; i++) {
        const pred = predictFromTrees(this.trees, this.lr, X[i]);
        if ((pred > 0.5 ? 1 : 0) === y[i]) oosOk++;
      }
      this.accuracyOOS = X.length > si ? +(oosOk / (X.length - si) * 100).toFixed(1) : 0;
      this.trained = true;
      return true;
    },

    predict(x) {
      if (!this.trained||!this.trees.length) return 0.5;
      let F=0.5;
      this.trees.forEach(t => { F+=this.lr*(x[t.fi]<=t.th?t.lVal:t.rVal); });
      return Math.max(0,Math.min(1,F));
    },

    save() { return { trees:this.trees, trained:this.trained, accuracy:this.accuracy, accuracyOOS:this.accuracyOOS||0 }; }
  };
  if (saved) { gbm.trees=saved.trees||[]; gbm.trained=saved.trained||false; gbm.accuracy=saved.accuracy||0; gbm.accuracyOOS=saved.accuracyOOS||0; }
  return gbm;
}

function makeQL(saved) {
  const ql = {
    Q: {}, alpha:0.15, gamma:0.90, epsilon:0.10, trained:false, updates:0,

    stateKey(sig) {
      const r = sig.rsiD<=30?0:sig.rsiD<=45?1:sig.rsiD<=60?2:3;
      const m = sig.macdHist>0?1:0;
      const t = sig.trendD+1;
      const o = sig.obiRatio ? (sig.obiRatio>=0.58?2:sig.obiRatio<=0.42?0:1) : 1;
      const b = sig.bbPos<0.25?0:sig.bbPos<0.5?1:2;
      return r+'_'+m+'_'+t+'_'+o+'_'+b;
    },

    initState(k) { if (!this.Q[k]) this.Q[k]={BUY:0,HOLD:0}; },

    update(sig, action, reward, nextSig) {
      if (!sig) return;
      const k = this.stateKey(sig);
      this.initState(k);
      const old = this.Q[k][action];
      let maxN;
      if (nextSig) {
        const nk=this.stateKey(nextSig); this.initState(nk);
        maxN=Math.max(this.Q[nk].BUY,this.Q[nk].HOLD);
      } else {
        maxN=Math.max(this.Q[k].BUY,this.Q[k].HOLD);
      }
      this.Q[k][action]=old+this.alpha*(reward+this.gamma*maxN-old);
      this.updates++;
      this.trained=this.updates>=10;
      this.epsilon=Math.max(0.10,0.30-this.updates*0.001);
    },

    suggests(sig) {
      if (!this.trained) return null;
      const k=this.stateKey(sig); this.initState(k);
      const diff=this.Q[k].BUY-this.Q[k].HOLD;
      return { action:diff>0?'BUY':'HOLD', confidence:Math.abs(diff), qBuy:+this.Q[k].BUY.toFixed(4), qHold:+this.Q[k].HOLD.toFixed(4) };
    },

    save() { return { Q:this.Q, updates:this.updates, epsilon:this.epsilon }; }
  };
  if (saved) { ql.Q=saved.Q||{}; ql.updates=saved.updates||0; ql.epsilon=saved.epsilon||0.10; ql.trained=ql.updates>=10; }
  return ql;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WSKAŹNIKI TECHNICZNE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function emaArr(arr, p) {
  if (!arr||!arr.length) return [0];
  const k=2/(p+1);
  if (arr.length<p) { const sma=arr.reduce((a,b)=>a+b,0)/arr.length; return arr.map(()=>sma); }
  let prev=arr.slice(0,p).reduce((a,b)=>a+b,0)/p;
  const o=new Array(p).fill(prev);
  for (let i=p;i<arr.length;i++) { prev=arr[i]*k+prev*(1-k); o.push(prev); }
  return o;
}
function emaLast(arr, p) { const a=emaArr(arr,p); return a.length?a.at(-1):0; }

function rsi(c, p=14) {
  if (c.length<p+1) return 50;
  let avgG=0,avgL=0;
  for (let i=1;i<=p;i++) { const d=c[i]-c[i-1]; if(d>0)avgG+=d; else avgL-=d; }
  avgG/=p; avgL/=p;
  for (let i=p+1;i<c.length;i++) {
    const d=c[i]-c[i-1];
    if(d>0){avgG=(avgG*(p-1)+d)/p;avgL=avgL*(p-1)/p;}
    else{avgG=avgG*(p-1)/p;avgL=(avgL*(p-1)-d)/p;}
  }
  if (avgL===0) return avgG>0?100:50;
  const ratio=avgG/avgL;
  if (!isFinite(ratio)) return 50;
  return 100-100/(1+ratio);
}

function rsiArray(closes, period=14) {
  const n=closes.length, result=new Array(n).fill(50);
  if (n<period+1) return result;
  let avgG=0,avgL=0;
  for (let i=1;i<=period;i++){const d=closes[i]-closes[i-1];if(d>0)avgG+=d;else avgL-=d;}
  avgG/=period; avgL/=period;
  const rv=avgL===0?(avgG>0?100:50):100-100/(1+avgG/avgL);
  result[period]=isFinite(rv)?rv:50;
  for (let j=period+1;j<n;j++){
    const dj=closes[j]-closes[j-1];
    if(dj>0){avgG=(avgG*(period-1)+dj)/period;avgL=avgL*(period-1)/period;}
    else{avgG=avgG*(period-1)/period;avgL=(avgL*(period-1)-dj)/period;}
    const rv2=avgL===0?(avgG>0?100:50):100-100/(1+avgG/avgL);
    result[j]=isFinite(rv2)?rv2:50;
  }
  return result;
}

function rsiDivergence(prices, rsiArr, lookback=20) {
  const n = prices.length;
  if (n < lookback) return { bull: false, bear: false };
  const pS = prices.slice(-lookback), rS = rsiArr.slice(-lookback);
  const len = pS.length;

  // Znajdź dwa lokalne minima ceny w oknie (bycza dywergencja)
  // i dwa lokalne maksima ceny (niedźwiedzia dywergencja)
  const localMins = [], localMaxs = [];
  for (let i = 1; i < len - 1; i++) {
    if (pS[i] < pS[i-1] && pS[i] < pS[i+1]) localMins.push(i);
    if (pS[i] > pS[i-1] && pS[i] > pS[i+1]) localMaxs.push(i);
  }

  let bull = false, bear = false;

  // Bycza: drugie minimum ceny NIŻSZE niż pierwsze, ale RSI przy drugim WYŻSZE
  if (localMins.length >= 2) {
    const i1 = localMins[localMins.length - 2];
    const i2 = localMins[localMins.length - 1];
    if (pS[i2] < pS[i1] * 0.999 && rS[i2] > rS[i1] + 3) bull = true;
  }

  // Niedźwiedzia: drugie maksimum ceny WYŻSZE niż pierwsze, ale RSI przy drugim NIŻSZE
  if (localMaxs.length >= 2) {
    const i1 = localMaxs[localMaxs.length - 2];
    const i2 = localMaxs[localMaxs.length - 1];
    if (pS[i2] > pS[i1] * 1.001 && rS[i2] < rS[i1] - 3) bear = true;
  }

  return { bull, bear };
}

function macdFull(c) {
  if (c.length<35) return {line:0,signal:0,hist:0};
  const e12=emaArr(c,12), e26=emaArr(c,26);
  const ml=e12.map((v,i)=>i<26?0:v-e26[i]);
  const sl=emaArr(ml.slice(26),9);
  const n=ml.length-1, sn=sl.length-1;
  return {line:ml[n], signal:sn>=0?sl[sn]:0, hist:ml[n]-(sn>=0?sl[sn]:0)};
}

function bband(c, p=20) {
  if (!c||!c.length) return {upper:0,mid:0,lower:0,pos:0.5};
  if (c.length<p) {const v=c.at(-1)||0;return{upper:v*1.02,mid:v,lower:v*0.98,pos:0.5};}
  const sl=c.slice(-p), m=sl.reduce((a,b)=>a+b,0)/p;
  const std=Math.sqrt(sl.reduce((a,b)=>a+(b-m)**2,0)/(p-1));
  const up=m+2*std, lo=m-2*std;
  const pos=up===lo?0.5:Math.max(0,Math.min(1,(c.at(-1)-lo)/(up-lo)));
  return {upper:up,mid:m,lower:lo,pos,range:up-lo};
}

function atr(h, l, c, p=14) {
  if (h.length<p+1) return 0;
  const trs=[];
  for (let i=1;i<h.length;i++) trs.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));
  return trs.slice(-p).reduce((a,b)=>a+b,0)/p;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MARKET DATA — BYBIT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function fetchWithTimeout(url, ms, headers) {
  ms = ms || 8000;
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  const opts = { signal: ctrl.signal };
  if (headers) opts.headers = headers;
  return fetch(url, opts).finally(() => clearTimeout(tid));
}

async function getKlines(sym, interval, limit) {
  // Gate.io: mapowanie interwałów
  const ivMap = { 'D':'1d', '240':'4h', '60':'1h', '30':'30m', '15':'15m' };
  const iv = ivMap[interval] || '1d';
  const r = await fetchWithTimeout(
    `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${sym}&interval=${iv}&limit=${limit}`
  );
  if (!r.ok) throw new Error('getKlines HTTP ' + r.status + ' ' + sym);
  const d = await r.json();
  if (!Array.isArray(d) || d.length === 0)
    throw new Error('getKlines: brak danych ' + sym);
  // Gate.io: [timestamp, volume, close, high, low, open, ...]
  return d.map(k => [+k[0]*1000, +k[5], +k[3], +k[4], +k[2], +k[1]]);
}

async function getLastPrice(sym) {
  const r = await fetchWithTimeout(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${sym}`);
  if (!r.ok) throw new Error('getPrice HTTP ' + r.status);
  const d = await r.json();
  if (!Array.isArray(d) || !d[0]) throw new Error('getPrice: brak danych ' + sym);
  return +d[0].last;
}

async function getOrderbook(sym) {
  try {
    const r = await fetchWithTimeout(`https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${sym}&limit=10`);
    if (!r.ok) return { ratio: 0.5 };
    const d = await r.json();
    if (!d.bids || !d.asks) return { ratio: 0.5 };
    const bids = d.bids.reduce((s, x) => s + +x[1], 0);
    const asks = d.asks.reduce((s, x) => s + +x[1], 0);
    const total = bids + asks;
    return { ratio: total > 0 ? bids / total : 0.5, bids, asks };
  } catch(e) { return { ratio: 0.5 }; }
}

function calcOBI(obiData) {
  const r = obiData.ratio || 0.5;
  if (r >= 0.65) return 4;
  if (r >= 0.58) return 2;
  if (r <= 0.35) return -4;
  if (r <= 0.42) return -2;
  return 0;
}

async function getFearGreed(state) {
  const cache = state.lastFG || { val: 50, label: 'Neutral', ts: 0 };
  if (Date.now() - (cache.ts || 0) < 3600000) return cache;
  try {
    const r = await fetchWithTimeout('https://api.alternative.me/fng/?limit=1', 5000);
    const d = await r.json();
    if (!d.data || !d.data[0]) return cache;
    const val = +d.data[0].value;
    if (!isFinite(val)) return cache;
    const fg = { val, label: d.data[0].value_classification || 'Neutral', ts: Date.now() };
    state.lastFG = fg;
    return fg;
  } catch(e) { return cache; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MEXC TRADING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function mexcSign(params, cfg) {
  const ts = String(Date.now());
  const qs = params + '&timestamp=' + ts;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(cfg.mexcSecret),
    { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(qs));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
  return { qs: qs + '&signature=' + sigHex, apiKey: cfg.mexcApiKey };
}

function mexcSymbol(sym) { return sym.replace('_',''); }

// MEXC wymaga różnej precyzji ilości dla każdej pary
function mexcQtyPrecision(sym) {
  if (sym.includes('DOGE') || sym.includes('SHIB') || sym.includes('XRP') || sym.includes('ADA')) return 0;
  if (sym.includes('BTC'))  return 5;
  if (sym.includes('ETH'))  return 4;
  if (sym.includes('SOL') || sym.includes('AVAX') || sym.includes('LINK')) return 3;
  return 4;
}
function mexcFmtQty(sym, qty) {
  const prec = mexcQtyPrecision(sym);
  return prec === 0 ? Math.floor(qty).toString() : qty.toFixed(prec);
}

async function mexcMarketBuy(sym, quoteQty, cfg) {
  const msym = mexcSymbol(sym);
  const s = await mexcSign('symbol=' + msym + '&side=BUY&type=MARKET&quoteOrderQty=' + quoteQty.toFixed(2), cfg);
  const r = await fetch('https://api.mexc.com/api/v3/order?' + s.qs, { method:'POST', headers: { 'X-MEXC-APIKEY': s.apiKey, 'Content-Type': 'application/json' } });
  const d = await r.json();
  if (!d.orderId) throw new Error('MEXC buy: ' + (d.msg || JSON.stringify(d)));
  await sleep(1000);
  const s2 = await mexcSign('symbol=' + msym + '&orderId=' + d.orderId, cfg);
  const det = await (await fetch('https://api.mexc.com/api/v3/order?' + s2.qs, { headers: { 'X-MEXC-APIKEY': s2.apiKey } })).json();
  const avgPrice = det.avgPrice ? +det.avgPrice : (det.price ? +det.price : 0);
  const qty = det.executedQty ? +det.executedQty : (quoteQty / (avgPrice || 1));
  return { price: avgPrice, qty };
}

async function mexcMarketSell(sym, qty, cfg) {
  const msym = mexcSymbol(sym);
  const s = await mexcSign('symbol=' + msym + '&side=SELL&type=MARKET&quantity=' + mexcFmtQty(sym, qty), cfg);
  const r = await fetch('https://api.mexc.com/api/v3/order?' + s.qs, { method:'POST', headers: { 'X-MEXC-APIKEY': s.apiKey, 'Content-Type': 'application/json' } });
  const d = await r.json();
  if (!d.orderId) throw new Error('MEXC sell: ' + (d.msg || JSON.stringify(d)));
  return true;
}

async function mexcGetBalance(cfg) {
  const ts = String(Date.now());
  const qs = 'timestamp=' + ts;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(cfg.mexcSecret),
    { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(qs));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
  const r = await fetch('https://api.mexc.com/api/v3/account?' + qs + '&signature=' + sigHex,
    { headers: { 'X-MEXC-APIKEY': cfg.mexcApiKey } });
  const d = await r.json();
  if (!d.balances) throw new Error('MEXC balance: ' + JSON.stringify(d));
  const usdc = d.balances.find(b => b.asset === 'USDC');
  return usdc ? +usdc.free : 0;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TELEGRAM
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function tgSend(cfg, msg) {
  if (!cfg.tgToken || !cfg.tgChat) return;
  try {
    await fetch(`https://api.telegram.org/bot${cfg.tgToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.tgChat, text: msg, parse_mode: 'HTML' })
    });
  } catch(e) {}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// KV HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function getConfig(env) {
  try { const c=await env.SWINGAI_KV.get('config'); return c?JSON.parse(c):defaultConfig(); }
  catch(e) { return defaultConfig(); }
}
async function getState(env) {
  try { const s=await env.SWINGAI_KV.get('state'); return s?JSON.parse(s):defaultState(); }
  catch(e) { return defaultState(); }
}
function defaultConfig() {
  return { active:false, mode:'paper', tp:0.12, sl:0.05, trail:0.06, maxPos:4, posSize:15,
           riskPct:2, paperBalance:1000, minScore:58, fgMin:20,
           mexcApiKey:'', mexcSecret:'', tgToken:'', tgChat:'' };
}
function defaultState() {
  return { positions:[], trades:[], log:[], iter:0, dailyPnl:0, dailyStartBalance:0,
           paperBalance:1000, consLoss:0, globalBlockUntil:0, cooldown:{},
           lastCycle:null, lastFG:{ val:50, label:'Neutral', ts:0 }, lastSigs:[],
           nb:null, gbm:null, ql:null, ensembleW:null, pairParams:{}, adaptiveMinScore:58,
           peakBalance:0, drawdownBlock:0, stats:null };
}
function addLog(state, msg, type='info') {
  state.log = [{ ts:new Date().toISOString(), msg, type }, ...(state.log||[])].slice(0, 60);
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DASHBOARD HTML — SERVER-SIDE RENDER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function dashboardHTML(cfg, state, env) {
  // Pobierz HTML z GitHub z cache KV (TTL 5 minut) — unikamy fetcha przy każdym odświeżeniu
  let html;
  const CACHE_KEY = 'html_cache';
  const CACHE_TS_KEY = 'html_cache_ts';
  const CACHE_TTL_MS = 5 * 60 * 1000;
  try {
    const now = Date.now();
    const cachedTs = await env.SWINGAI_KV.get(CACHE_TS_KEY);
    const tsOk = cachedTs && (now - parseInt(cachedTs)) < CACHE_TTL_MS;
    if (tsOk) {
      html = await env.SWINGAI_KV.get(CACHE_KEY);
    }
    if (!html) {
      const resp = await fetchWithTimeout('https://tomekfalek-cyber.github.io/swingai-bot/', 10000);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      html = await resp.text();
      await env.SWINGAI_KV.put(CACHE_KEY, html);
      await env.SWINGAI_KV.put(CACHE_TS_KEY, String(now));
    }
  } catch(e) {
    // Spróbuj użyć stale cache jeśli fetch się nie powiódł
    try { const stale = await env.SWINGAI_KV.get(CACHE_KEY); if (stale) html = stale; } catch(_) {}
    if (!html) return '<html><body style="background:#020810;color:#ff3d5a;font-family:sans-serif;padding:40px"><h2>Błąd pobierania frontendu</h2><p>' + e.message + '</p><p><a href="/" style="color:#2d8fff">Odśwież</a></p></body></html>';
  }

  // Dane bota do wstrzyknięcia
  const botState = JSON.stringify({
    active:       cfg.active || false,
    mode:         cfg.mode || 'paper',
    paperBalance: state.paperBalance || 0,
    dailyPnl:     state.dailyPnl || 0,
    positions:    state.positions || [],
    trades:       state.trades || [],
    lastSigs:     state.lastSigs || [],
    lastCycle:    state.lastCycle || null,
    iter:         state.iter || 0,
    lastFG:       state.lastFG || null,
    nb:           state.nb || null,
    gbm:          state.gbm || null,
    ql:           state.ql || null,
    ensembleW:    state.ensembleW || null,
    log:          (state.log || []).slice(0, 30),
    stats:        state.stats || null,
    gbmAccuracyOOS: (state.gbm && state.gbm.accuracyOOS) || null,
    regime:       (state.lastSigs && state.lastSigs[0] && state.lastSigs[0].regime) || null,
    liveBalance:  state.liveBalance || null,
    exchange:     'MEXC'
  });

  // Zapisane dane dostępowe (przekazujemy je do frontendu żeby wypełnić formularz)
  const savedCreds = JSON.stringify({
    tgToken:        cfg.tgToken    ? '***SAVED***' : '',
    tgChat:         cfg.tgChat     || '',
    tgTokenSet:     !!cfg.tgToken,
    mexcApiKeySet:  !!cfg.mexcApiKey,
    mexcSecretSet:  !!cfg.mexcSecret
  });

  // Wstrzyknij: Worker URL proxy + dane bota zaraz po "let CFG = {"
  const injection = `
  // ââ CLOUDFLARE WORKER INJECTION ââââââââââââââââââââââââââââââââââ
  (function() {
    const WORKER_PROXY = 'https://swingai-bot-24h.tomek-falek.workers.dev';
    const BOT_BASE     = 'https://swingai-bot-24h.tomek-falek.workers.dev';
    const BOT_TOKEN    = 'swingai-secret-2024';
    const BOT_STATE    = ${botState.replace(/<\/script>/gi, '<\\/script>')};
    const SAVED_CREDS  = ${savedCreds.replace(/<\/script>/gi, '<\\/script>')};

    document.addEventListener('DOMContentLoaded', function() {

      // Ustaw Worker URL + migracja starych wartości CFG.mode
      try {
        const stored = localStorage.getItem('swingai_cfg_v3');
        const c = stored ? JSON.parse(stored) : {};
        if (!c.workerUrl || !c.workerUrl.startsWith('https://')) {
          c.workerUrl = WORKER_PROXY;
        }
        // Migracja: stara wartość 'okx' oznaczała MEXC (błąd w dropdown)
        if (c.mode === 'okx') { c.mode = 'mexc'; c.exchange = 'mexc'; }
        // Migracja: wartość 'live' oznaczała Binance — zostaw jak jest
        localStorage.setItem('swingai_cfg_v3', JSON.stringify(c));
      } catch(e) {}

      // Przepisz linki /start-paper, /stop, /run — dodaj ?auth=TOKEN
      // Użytkownik klika normalnie, token dodawany automatycznie
      document.querySelectorAll('a[href]').forEach(function(a) {
        const href = a.getAttribute('href');
        if (href && (href.startsWith('/start') || href === '/stop' || href === '/run' || href.startsWith('/delete'))) {
          const sep = href.includes('?') ? '&' : '?';
          a.href = BOT_BASE + href + sep + 'auth=' + BOT_TOKEN;
        }
      });

      // Badge statusu bota
      try {
        const botBadge = document.getElementById('bot-status-badge');
        if (botBadge) {
          botBadge.textContent = BOT_STATE.active ? '24h BOT: AKTYWNY' : '24h BOT: OFF';
          botBadge.style.color = BOT_STATE.active ? 'var(--green)' : 'var(--text3)';
        }
      } catch(e) {}

      // Nadpisz updateHeader — żeby conn-badge zawsze pokazywał ONLINE gdy Worker aktywny
      if (BOT_STATE.active) {
        var _origUpdateHeader = window.updateHeader;
        window.updateHeader = async function() {
          if (_origUpdateHeader) await _origUpdateHeader.apply(this, arguments);
          var cb = document.getElementById('conn-badge');
          if (cb) { cb.className = 'badge bon'; cb.textContent = 'ONLINE'; }
          var dot = document.getElementById('ai-dot');
          if (dot && !dot.className.includes('scan')) dot.className = 'ai-dot scan';
        };
      }

      // ââ WYPEŁNIJ FORMULARZ DANYMI Z KV (działa na każdym urządzeniu) ââ
      setTimeout(function() {
        try {
          // Telegram
          var tgTokenInput = document.getElementById('cfg-tg-token');
          var tgChatInput  = document.getElementById('cfg-tg-chat');
          if (tgTokenInput && SAVED_CREDS.tgTokenSet) {
            // Nie pokazujemy tokenu (bezpieczeństwo), ale oznaczamy że jest zapisany
            tgTokenInput.placeholder = '✓ Token zapisany w chmurze (wpisz nowy aby zmienić)';
            tgTokenInput.style.borderColor = 'var(--green)';
          }
          if (tgChatInput && SAVED_CREDS.tgChat) {
            tgChatInput.value = SAVED_CREDS.tgChat;
          }
          // MEXC
          var okxKeyInput  = document.getElementById('cfg-mexc-key') || document.getElementById('cfg-okx-key');
          var okxSecInput  = document.getElementById('cfg-mexc-secret') || document.getElementById('cfg-okx-secret');
          if (okxKeyInput && SAVED_CREDS.mexcApiKeySet) {
            okxKeyInput.placeholder = 'Klucz MEXC API zapisany w chmurze (wpisz nowy aby zmienic)';
            okxKeyInput.style.borderColor = 'var(--green)';
          }
          if (okxSecInput && SAVED_CREDS.mexcSecretSet) {
            okxSecInput.placeholder = 'MEXC Secret zapisany w chmurze (wpisz nowy aby zmienic)';
            okxSecInput.style.borderColor = 'var(--green)';
          }
          // Zaktualizuj wyświetlany status TG
          var rbTg = document.getElementById('rb-tg');
          if (rbTg && SAVED_CREDS.tgTokenSet) {
            rbTg.textContent = 'OK'; rbTg.className = 'val up';
          }
        } catch(e) {}
      }, 400);

      // ââ PRZECHWYCENIE saveSettings — SYNC DO WORKERA ââââââââââââââ
      var _origSaveSettings = window.saveSettings;
      window.saveSettings = function() {
        // Najpierw wywołaj oryginalną funkcję (zapis do localStorage)
        if (_origSaveSettings) _origSaveSettings.apply(this, arguments);

        // Zbierz dane z formularza
        try {
          var params = new URLSearchParams();
          params.set('auth', BOT_TOKEN);

          var tgTok = document.getElementById('cfg-tg-token');
          var tgCht = document.getElementById('cfg-tg-chat');
          var okxK  = document.getElementById('cfg-mexc-key') || document.getElementById('cfg-okx-key');
          var okxS  = document.getElementById('cfg-mexc-secret') || document.getElementById('cfg-okx-secret');
          

          var anyNew = false;
          if (tgTok && tgTok.value.trim() && tgTok.value.trim() !== '***SAVED***') {
            params.set('tg', tgTok.value.trim()); anyNew = true;
          }
          if (tgCht && tgCht.value.trim()) {
            params.set('tgc', tgCht.value.trim()); anyNew = true;
          }
          if (okxK && okxK.value.trim()) {
            params.set('key', okxK.value.trim()); anyNew = true;
          }
          if (okxS && okxS.value.trim()) {
            params.set('sec', okxS.value.trim()); anyNew = true;
          }
          

          if (anyNew) {
            var hasTg = params.has('tg') || (tgCht && tgCht.value.trim());
            fetch(BOT_BASE + '/save-config?' + params.toString())
              .then(function() {
                var st = document.getElementById('cfg-status');
                if (st) { st.textContent = 'Zapisano + synchronizacja z chmurą ✓'; st.style.color = 'var(--green)'; }
                // Jeśli zapisano token TG — wyślij wiadomość powitalną
                if (hasTg) {
                  setTimeout(function() {
                    fetch(BOT_BASE + '/send-welcome?auth=' + BOT_TOKEN).catch(function(){});
                  }, 1500);
                }
              })
              .catch(function(e) { console.warn('Sync z Workerem nieudana:', e); });
          }
        } catch(e) { console.warn('saveSettings injection error:', e); }
      };

      // Nadpisz startBot/stopBot — klikając START/STOP użytkownik steruje Workerem (24/7)
      // a nie lokalnym botem przeglądarki który działa tylko gdy karta jest otwarta
      window._origStartBot = window.startBot;
      window._origStopBot  = window.stopBot;

      window.startBot = function() {
        // Odczytaj tryb z CFG (zapisany w localStorage przez saveSettings)
        var isLive = typeof CFG !== 'undefined' && CFG.mode === 'mexc' && CFG.mexcApiKey;
        var startUrl;
        if (isLive) {
          var p = new URLSearchParams();
          p.set('auth', BOT_TOKEN);
          p.set('key',  CFG.mexcApiKey  || '');
          p.set('sec',  CFG.mexcSecret  || '');
          p.set('tp',   ((CFG.tp   || 0.12)*100).toFixed(1));
          p.set('sl',   ((CFG.sl   || 0.05)*100).toFixed(1));
          p.set('trail',((CFG.trail|| 0.06)*100).toFixed(1));
          p.set('score',String(CFG.minScore || 58));
          p.set('maxp', String(CFG.maxPos   || 4));
          p.set('size', String(CFG.posSize  || 15));
          if (CFG.tgToken) { p.set('tg', CFG.tgToken); p.set('tgc', CFG.tgChat||''); }
          startUrl = BOT_BASE + '/start-live?' + p.toString();
        } else {
          startUrl = BOT_BASE + '/start-paper?auth=' + BOT_TOKEN;
        }
        fetch(startUrl)
          .then(function() {
            var btnRun  = document.getElementById('btn-run');
            var btnStop = document.getElementById('btn-stop');
            var btnScan = document.getElementById('btn-scan');
            var rbStat  = document.getElementById('rb-status');
            var aiDot   = document.getElementById('ai-dot');
            var rbMode  = document.getElementById('rb-mode');
            if (btnRun)  btnRun.style.display  = 'none';
            if (btnStop) btnStop.style.display  = '';
            if (btnScan) btnScan.style.display  = '';
            if (rbStat)  { rbStat.textContent = '🟢 Aktywny (24h Worker)'; rbStat.className = 'val up'; }
            if (rbMode)  { rbMode.textContent = isLive ? 'LIVE' : 'PAPER'; rbMode.className = isLive ? 'val up' : 'val'; }
            if (aiDot)   aiDot.className = 'ai-dot scan';
            var connBadge = document.getElementById('conn-badge');
            if (connBadge) { connBadge.className = 'badge bon'; connBadge.textContent = 'ONLINE'; }
            if (typeof running !== 'undefined') running = true;
          })
          .catch(function(e) { alert('Błąd startu Workera: ' + e.message); });
      };

      window.stopBot = function() {
        fetch(BOT_BASE + '/stop?auth=' + BOT_TOKEN)
          .then(function() {
            var btnRun  = document.getElementById('btn-run');
            var btnStop = document.getElementById('btn-stop');
            var btnScan = document.getElementById('btn-scan');
            var rbStat  = document.getElementById('rb-status');
            var aiDot   = document.getElementById('ai-dot');
            if (btnRun)  btnRun.style.display  = '';
            if (btnStop) btnStop.style.display  = 'none';
            if (btnScan) btnScan.style.display  = 'none';
            if (rbStat)  { rbStat.textContent = 'â¬ Zatrzymany'; rbStat.className = 'val dn'; }
            if (aiDot)   aiDot.className = 'ai-dot';
            if (typeof running !== 'undefined') running = false;
          })
          .catch(function(e) { alert('Błąd stopu Workera: ' + e.message); });
      };

      // Jeśli Worker-bot jest aktywny — zasilij UI danymi z Workera
      if (BOT_STATE.active) {
        setTimeout(function() {
          try {
            // 1. Wstrzyknij dane do localStorage żeby loadAll() je widział
            var stored = localStorage.getItem('swingai_v3');
            var st = stored ? JSON.parse(stored) : {};
            st.positions  = BOT_STATE.positions  || st.positions  || [];
            st.trades     = BOT_STATE.trades     || st.trades     || [];
            st.paperBal   = BOT_STATE.paperBalance || st.paperBal  || 1000;
            st.dailyPnl   = BOT_STATE.dailyPnl   !== undefined ? BOT_STATE.dailyPnl : (st.dailyPnl || 0);
            st.iter       = BOT_STATE.iter        || st.iter       || 0;
            localStorage.setItem('swingai_v3', JSON.stringify(st));

            // 2. Odśwież stan w pamięci (ST to globalny obiekt przeglądarki)
            if (typeof ST !== 'undefined') {
              ST.positions = st.positions;
              ST.trades    = st.trades;
              ST.paperBal  = st.paperBal;
              ST.dailyPnl  = st.dailyPnl;
              ST.iter      = st.iter;
            }
            // Zaktualizuj element DOM z numerem iteracji
            var iterEl = document.getElementById('rb-iter');
            if (iterEl && st.iter) iterEl.textContent = st.iter;

            // 3. Wyświetl pary z ostatniego skanu Workera
            if (BOT_STATE.lastSigs && BOT_STATE.lastSigs.length > 0 && typeof renderSigList === 'function') {
              // Dopasuj format — Worker używa BTC_USDC, frontend oczekuje sym z trendD
              var sigs = BOT_STATE.lastSigs.map(function(s) {
                return {
                  sym:      s.sym.replace('_USDC', 'USDC'),
                  price:    s.price    || 0,
                  score:    s.score    || 0,
                  finalProb: s.finalProb || 0,
                  rsiD:     s.rsiD     || 50,
                  rsi4h:    s.rsi4h    || 50,
                  macdHist: s.macdHist || 0,
                  bbPos:    s.bbPos    || 0.5,
                  trendD:   s.trend === 'UP' ? 2 : s.trend === 'FLAT' ? 0 : -1,
                  buy:      s.buy      || false,
                  why:      s.why      || [],
                  patterns: s.patterns || [],
                  aiMethod: s.aiMethod || 'Worker',
                  volR:     s.volR     || 1,
                  vol4R:    s.vol4R    || 1,
                  mom5:     s.mom5     || 0,
                  mom10:    s.mom10    || 0
                };
              });
              renderSigList(sigs);
              if (typeof lastSigs !== 'undefined') lastSigs = sigs;
            }

            // 4. Zaktualizuj UI — status aktywny, ukryj Start
            running = true;
            var btnRun  = document.getElementById('btn-run');
            var btnStop = document.getElementById('btn-stop');
            var btnScan = document.getElementById('btn-scan');
            var rbStat  = document.getElementById('rb-status');
            var aiDot   = document.getElementById('ai-dot');
            if (btnRun)  btnRun.style.display  = 'none';
            if (btnStop) btnStop.style.display  = '';
            if (btnScan) btnScan.style.display  = '';
            if (rbStat)  { rbStat.textContent = '🟢 Aktywny (24h Worker)'; rbStat.className = 'val up'; }
            if (aiDot)   aiDot.className = 'ai-dot scan';

            // 5. Odśwież wyświetlone pozycje i trades jeśli istnieją funkcje
            if (typeof renderPositions === 'function') renderPositions();
            if (typeof renderTrades    === 'function') renderTrades();

            // 6. Pokaż czas ostatniego skanu Workera
            if (BOT_STATE.lastCycle) {
              var d = new Date(BOT_STATE.lastCycle);
              var pad = function(n){ return n<10?'0'+n:n; };
              var ts = pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
              var el = document.getElementById('scan-progress');
              if (el) el.textContent = 'ostatni skan Worker: ' + ts + ' | skan #' + (BOT_STATE.iter || '');
            }

            // Wyswietl gielde i worker proxy w status panelu
            var rbExchange = document.getElementById('rb-exchange');
            if (rbExchange) { rbExchange.textContent = BOT_STATE.exchange || 'MEXC'; rbExchange.className = 'val up'; }
            var rbProxy = document.getElementById('rb-proxy');
            if (rbProxy) { rbProxy.textContent = BOT_BASE; rbProxy.className = 'val up'; }
            // Popraw tryb - upewnij sie ze pokazuje LIVE gdy mode=live
            var rbMode = document.getElementById('rb-mode');
            if (rbMode && BOT_STATE.mode) { rbMode.textContent = BOT_STATE.mode.toUpperCase(); rbMode.className = BOT_STATE.mode === 'live' ? 'val up' : 'val'; }
            // Wyswietl saldo live jesli dostepne
            if (BOT_STATE.liveBalance !== null && BOT_STATE.liveBalance !== undefined) {
              var rbBal = document.getElementById('rb-balance') || document.getElementById('rb-live-bal');
              if (rbBal) { rbBal.textContent = '$' + Number(BOT_STATE.liveBalance).toFixed(2) + ' (MEXC)'; rbBal.className = 'val up'; }
            }

          } catch(e) { console.warn('Worker injection error:', e); }
        }, 600);
      }
    });
  })();
  // ââ END INJECTION ââââââââââââââââââââââââââââââââââââââââââââââââ
`;

  // Wstrzyknij tuż po <script> 'use strict'; bloku (po "let CFG = {")
  // Używamy funkcji zamiast stringa — unikamy interpretacji $' $` $& przez replace()
  html = html.replace(
    "let CFG = {",
    function() { return injection + "\nlet CFG = {"; }
  );

  // Podmień conn-badge bezpośrednio w HTML — zanim przeglądarka wyrenderuje stronę
  if (cfg.active) {
    html = html.replace(
      '<span id="conn-badge" class="badge boff">OFFLINE</span>',
      '<span id="conn-badge" class="badge bon">ONLINE</span>'
    );
    html = html.replace(
      '<span class="ai-dot off" id="ai-dot"></span>',
      '<span class="ai-dot scan" id="ai-dot"></span>'
    );
  }

  // Podmień openSettings — pola z kluczami w KV pokazują zielony placeholder
  html = html.replace(
    "function openSettings() {\n  gi('cfg-key').value      = CFG.apiKey||'';\n  gi('cfg-secret').value   = CFG.secret||'';\n  gi('cfg-worker').value   = CFG.workerUrl||'';\n  gi('cfg-mode').value     = CFG.mode;\n  gi('cfg-byb-key').value    = CFG.bybApiKey||'';\n  gi('cfg-byb-secret').value = CFG.bybSecret||'';\n  gi('cfg-byb-worker').value = CFG.bybWorker||'';\n  gi('cfg-okx-key').value      = CFG.okxApiKey||'';\n  gi('cfg-okx-secret').value   = CFG.okxSecret||'';\n  gi('cfg-okx-pass').value     = CFG.okxPassphrase||'';\n  gi('cfg-okx-worker').value   = CFG.okxWorker||'';",
    `function openSettings() {
  gi('cfg-key').value      = CFG.apiKey||'';
  gi('cfg-secret').value   = CFG.secret||'';
  gi('cfg-worker').value   = CFG.workerUrl||'';
  gi('cfg-mode').value     = CFG.mode;
  gi('cfg-byb-key').value    = CFG.bybApiKey||'';
  gi('cfg-byb-secret').value = CFG.bybSecret||'';
  gi('cfg-byb-worker').value = CFG.bybWorker||'';
  // MEXC - jesli klucze sa w KV (chmurze), pokaz placeholder zamiast pustego pola
  var sc = (typeof SAVED_CREDS !== 'undefined') ? SAVED_CREDS : {};
  if (sc.mexcApiKeySet) {
    var mexcKeyEl = document.getElementById('cfg-mexc-key') || document.getElementById('cfg-okx-key'); if (mexcKeyEl) { mexcKeyEl.value = ''; mexcKeyEl.placeholder = 'Klucz MEXC API zapisany w chmurze (wpisz nowy aby zmienic)'; mexcKeyEl.style.borderColor='var(--green)'; }
  } else { var mexcKeyEl2 = document.getElementById('cfg-mexc-key') || document.getElementById('cfg-okx-key'); if (mexcKeyEl2) { mexcKeyEl2.value = CFG.mexcApiKey||''; mexcKeyEl2.style.borderColor=''; } }
  if (sc.mexcSecretSet) {
    var mexcSecEl = document.getElementById('cfg-mexc-secret') || document.getElementById('cfg-okx-secret'); if (mexcSecEl) { mexcSecEl.value = ''; mexcSecEl.placeholder = 'MEXC Secret zapisany w chmurze (wpisz nowy aby zmienic)'; mexcSecEl.style.borderColor='var(--green)'; }
  } else { var mexcSecEl2 = document.getElementById('cfg-mexc-secret') || document.getElementById('cfg-okx-secret'); if (mexcSecEl2) { mexcSecEl2.value = CFG.mexcSecret||''; mexcSecEl2.style.borderColor=''; } }
  // MEXC nie uzywa passphrase - pominiete
  // (okxPassSet usuniete)
  // (okxPassphrase usuniete)
  // MEXC nie uzywa okxWorker - pominiete
  // TG — analogicznie
  if (sc.tgTokenSet) {
    gi('cfg-tg-token').value = ''; gi('cfg-tg-token').placeholder = '✓ Token zapisany w chmurze (wpisz nowy aby zmienić)'; gi('cfg-tg-token').style.borderColor='var(--green)';
  } else { gi('cfg-tg-token').value = CFG.tgToken||''; gi('cfg-tg-token').style.borderColor=''; }`
  );

  // Podmień saveCfg() w saveSettings — dodaj sync do Workera i wysyłkę powitania
  html = html.replace(
    "saveCfg();\n  gi('cfg-status').textContent='Zapisano'; gi('cfg-status').style.color='var(--green)';",
    `saveCfg();
  // ââ WORKER SYNC ââ
  (function() {
    var BOT_BASE  = 'https://swingai-bot-24h.tomek-falek.workers.dev';
    var BOT_TOKEN = 'swingai-secret-2024';
    var params = new URLSearchParams();
    params.set('auth', BOT_TOKEN);
    var tgTok = (gi('cfg-tg-token').value||'').trim();
    var tgCht = (gi('cfg-tg-chat').value||'').trim();
    var okxK  = (gi('cfg-mexc-key') ? gi('cfg-mexc-key') : (gi('cfg-okx-key') || {value:''})).value.trim();
    var okxS  = (gi('cfg-mexc-secret') ? gi('cfg-mexc-secret') : (gi('cfg-okx-secret') || {value:''})).value.trim();
    var okxP  = ''; // MEXC nie uzywa passphrase
    var hasTg = SAVED_CREDS.tgTokenSet;
    if (tgTok) { params.set('tg', tgTok); hasTg = true; }
    if (tgCht) { params.set('tgc', tgCht); hasTg = true; }
    if (okxK)  params.set('key',  okxK);
    if (okxS)  params.set('sec',  okxS);
    // okxP/pass - MEXC nie uzywa passphrase - pominiete
    fetch(BOT_BASE + '/save-config?' + params.toString())
      .then(function() {
        gi('cfg-status').textContent = 'Zapisano + synchronizacja z chmurą ✓';
        gi('cfg-status').style.color = 'var(--green)';
        if (hasTg) {
          setTimeout(function() {
            fetch(BOT_BASE + '/send-welcome?auth=' + BOT_TOKEN).catch(function(){});
          }, 1200);
        }
      })
      .catch(function() {});
  })();
  gi('cfg-status').textContent='Zapisano'; gi('cfg-status').style.color='var(--green)';`
  );

  // Dodaj badge bota w nagłówku (tuż przed </div> zamykającym #hdr-stats)
  const botBadgeHtml = `<div id="bot-status-badge" style="font-size:7.5pt;padding:2px 9px;border-radius:6px;background:rgba(0,229,160,.12);color:var(--green);font-weight:700;white-space:nowrap;margin-left:4px">${cfg.active ? '24h BOT: AKTYWNY' : '24h BOT: OFF'}</div>`;
  html = html.replace('</div>\n</div>\n\n<div id="main">', botBadgeHtml + '\n</div>\n</div>\n\n<div id="main">');

  return html;
}

function redirectHTML(msg) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="2;url=/">
<style>body{background:#020810;color:#00e5a0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-size:1.4em;flex-direction:column;gap:12px;}</style>
</head><body><div>${msg}</div><div style="color:#334d74;font-size:0.5em">Przekierowanie za 2 sekundy...</div></body></html>`;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': '*'
  };
}

function jsonResp(data, status=200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}


