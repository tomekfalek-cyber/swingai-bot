# SwingAI Bot — Autonomous Crypto Trader Pro

> Autonomiczny bot swing tradingowy z prawdziwym AI (Naïve Bayes + Gradient Boosting + Pattern Recognition + Adaptive Learning). Działa jako strona WWW — bez instalacji, bez PowerShell.

## 🚀 Uruchomienie

**[👉 KLIKNIJ TUTAJ ABY URUCHOMIĆ BOTA](https://tomekfalek-cyber.github.io/swingai-bot/)**

---

## ⚙️ Pierwsze uruchomienie

1. Wejdź na link powyżej
2. Kliknij **⚙️ Konfiguracja**
3. Wybierz tryb:
   - **PAPER** — symulacja (klucze niepotrzebne, zacznij tutaj)
   - **LIVE** — realne transakcje (wymaga kluczy Binance + Cloudflare Worker)
4. W trybie LIVE: wklej Binance API Key i Secret oraz Worker URL
5. Kliknij **🧠 ML Wagi → Trenuj NB + GBM** (opcjonalne, poprawia jakość sygnałów)
6. Kliknij **▶ START BOT**

---

## 🤖 Silnik AI — co naprawdę robi

Bot używa **4 modułów AI** działających jako ensemble:

| Moduł | Opis | Waga w decyzji |
|---|---|---|
| **Naïve Bayes** | Uczy się z historii transakcji bota. P(wzrost\|RSI,MACD,BB,Trend) | 30% |
| **Gradient Boosting** | 20 drzew decyzyjnych trenowanych na danych Binance | 30% |
| **Pattern Recognition** | 8 formacji świecowych (Hammer, Engulfing, Morning Star...) | w score |
| **Adaptive Learning** | Co 5 transakcji retrenuje modele. Automatycznie zaostrza próg gdy win rate < 40% | dynamiczny |

**Finalna decyzja:**
```
P(wzrost) = Score(40%) + NaïveBayes(30%) + GradientBoosting(30%)
Wejście gdy P(wzrost) ≥ minScore/100
```

---

## 📡 WebSocket — live ceny

Bot łączy się z Binance WebSocket przy starcie:
- Odbiera ceny **w czasie rzeczywistym** (zamiast co 15 minut)
- Trailing Stop reaguje w **sekundach**
- Automatyczny rekonekt co 10s przy awarii
- Status widoczny w panelu: `WebSocket: LIVE ⚡`

---

## 📐 Dynamic TP/SL oparty na ATR

```
TP  = wejście + max(cfg_tp%,  2.5 × ATR14)
SL  = wejście - max(cfg_sl%,  1.5 × ATR14)
TSL = max(cfg_trail%, 1.2 × ATR14 / cena)
R:R minimum = 1.5:1 (wymuszony)
```
Przy spokojnym rynku — ciasne poziomy. Przy zmiennym — szersza przestrzeń.

---

## 📊 Correlation Matrix

Pary podzielone na grupy korelacji. Maksymalnie **1 pozycja per grupę**:

| Grupa | Pary |
|---|---|
| L1 Large Cap | ETH, BNB |
| L1 Alt | SOL, AVAX, NEAR, DOT |
| Payments | XRP, ADA, LTC |
| Memecoins | DOGE, SHIB |
| DeFi | LINK, UNI, ATOM |

---

## 🛡️ Zarządzanie ryzykiem

| Parametr | Wartość domyślna |
|---|---|
| Take Profit | ATR-based (min 8%) |
| Stop Loss | ATR-based (min 4%) |
| Trailing Stop | ATR-based (min 4.5%), aktywny po +1.5% |
| Max pozycje | 3 (correlation-aware) |
| Kelly Criterion | Dynamiczny rozmiar — max 5% kapitału |
| Fear & Greed min | 25 — poniżej blokuje wejścia |
| Pump & Dump filter | vol > 4× lub +15% w 5 dni → blok |
| BTC Correlation Guard | BTC -5% w 24h → blokuje altcoiny |
| Dzienny limit strat | -5% portfela |
| Blokada po 3 stratach | 6h global cooldown |
| Cooldown po SL | 48h per para |
| Timeout pozycji | 7 dni |

---

## 🔬 Backtest

Zakładka **Backtest** w aplikacji:
- Pobiera dane OHLCV z Binance (do 2 lat)
- Symuluje każdy dzień: score → wejście → TP/SL/Timeout
- Wyniki: zwrot total, win rate, max drawdown, Sharpe Ratio
- Krzywa kapitału na wykresie

---

## 🔑 Tryb LIVE — Cloudflare Worker (jednorazowo, 5 minut)

Binance blokuje zapytania z przeglądarki (CORS). Worker to darmowe proxy:

1. Wejdź na **dash.cloudflare.com** → Workers & Pages → Create Worker
2. Kliknij **Edit code** → wklej kod z pliku [`swingai_worker.js`](swingai_worker.js)
3. Kliknij **Deploy** → skopiuj URL (np. `https://swingai.xxx.workers.dev`)
4. Wklej URL w ⚙️ Konfiguracja → pole **Cloudflare Worker URL**
5. Kliknij **🔌 Test połączenia** → powinny być 3× ✅

**Darmowy plan Cloudflare: 100 000 req/dzień** — w zupełności wystarczy.

---

## 📱 Telegram powiadomienia (opcjonalne)

1. Napisz do **@BotFather** na Telegram → `/newbot`
2. Skopiuj token
3. Napisz do swojego bota, potem wejdź na `https://api.telegram.org/bot<TOKEN>/getUpdates` → znajdź `chat.id`
4. Wklej token i chat_id w ⚙️ Konfiguracja

Bot wyśle powiadomienie przy każdym BUY, TAKE PROFIT i STOP LOSS.

---

## ⚠️ Ważne

- Bot działa tylko gdy **strona jest otwarta** w przeglądarce
- Dane zapisywane w `localStorage` przeglądarki
- **Zacznij od PAPER** — obserwuj 2-4 tygodnie przed przejściem na LIVE
- Żaden bot nie gwarantuje zysku — w bessie nawet najlepsze systemy tracą
- Inwestuj tylko kwoty które możesz stracić

---

## 📁 Pliki

| Plik | Opis |
|---|---|
| `index.html` | Główna aplikacja bota (cały kod w jednym pliku) |
| `swingai_worker.js` | Cloudflare Worker — proxy CORS dla Binance API |
| `README.md` | Ta instrukcja |