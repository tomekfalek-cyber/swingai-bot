# SwingAI Bot — Autonomous Crypto Swing Trader

> Bot handlowy oparty na AI, działający jako strona WWW. Nie wymaga PowerShell ani instalacji.

## 🚀 Uruchomienie

**[👉 KLIKNIJ TUTAJ ABY URUCHOMIĆ BOTA](https://tomekfalek-cyber.github.io/swingai-bot/)**

---

## ⚙️ Pierwsze uruchomienie

1. Wejdź na link powyżej
2. Kliknij **⚙️ Konfiguracja**
3. Wybierz tryb:
   - **PAPER** — symulacja bez prawdziwych pieniędzy (domyślnie, klucze niepotrzebne)
   - **LIVE** — realne transakcje (wymagane klucze Binance)
4. Jeśli LIVE — wklej **Binance API Key** i **Secret**
5. Ustaw parametry (lub zostaw domyślne)
6. Kliknij **▶ START BOT**

---

## 🔑 Jak uzyskać klucze Binance API

1. Zaloguj się na [binance.com](https://www.binance.com)
2. Profil → **API Management** → **Create API**
3. Uprawnienia: tylko **Enable Spot & Margin Trading** (NIE włączaj wypłat)
4. Wklej klucze w panelu ⚙️ Konfiguracja

> 🔐 Klucze są szyfrowane i przechowywane wyłącznie w Twojej przeglądarce (localStorage). Nie są wysyłane nigdzie poza Binance.

---

## 📊 Jak działa bot

### Strategia: Swing Trading (Daily + 4H)
Bot analizuje 6 par kryptowalutowych:
`BTC/USDC` `ETH/USDC` `BNB/USDC` `SOL/USDC` `XRP/USDC` `DOGE/USDC`

### Silnik AI — Scoring 0-100
Bot wchodzi w pozycję gdy **score ≥ 62/100**, obliczany z:

| Wskaźnik | Waga | Warunek BUY |
|---|---|---|
| RSI Daily (14) | 30 pkt | ≤ 40 (wyprzedanie) |
| RSI 4H | 15 pkt | ≤ 50 |
| MACD Daily | 20 pkt | histogram rosnący / cross up |
| Bollinger Bands Daily | 18 pkt | cena przy dolnej bandzie |
| Trend EMA50/200 | 12 pkt | powyżej EMA200 |
| Wolumen spike | 5 pkt | × 1.8+ średniej |

### Zarządzanie pozycją
| Parametr | Wartość domyślna |
|---|---|
| Take Profit | 8% |
| Stop Loss | 4% |
| Trailing Stop | 4.5% (aktywny po +1.5%) |
| Max pozycje | 3 równocześnie |
| Rozmiar pozycji | $15 |
| Timeout | 7 dni |
| Cooldown po SL | 48h dla danej pary |

### Zabezpieczenia
- ⛔ Blokada 6h po 3 stratach z rzędu
- ⛔ Dzienny limit strat: -5% portfela
- ⛔ Twardy block przy trendzie spadkowym (EMA200)
- ⛔ Emergency Stop przy -12%

---

## 🖥️ Dashboard

| Panel | Opis |
|---|---|
| Lewa kolumna | Sygnały AI dla wszystkich par, score, RSI, trend |
| Środek — Pozycje | Otwarte pozycje z live P/L, SL/TP, trailing |
| Środek — Historia | Wszystkie zamknięte transakcje |
| Środek — Statystyki | Win rate, wykres P/L, zestawienie per para |
| Prawa kolumna | Status bota, cooldowny, warunki BTC, konfiguracja AI |
| Log | Pełny dziennik decyzji bota w czasie rzeczywistym |

---

## ⚠️ Ważne

- Bot działa tylko gdy strona jest **otwarta w przeglądarce**
- Dane (pozycje, historia) są zapisywane w `localStorage` przeglądarki
- W trybie LIVE transakcje są realne — zacznij od PAPER
- Strona działa tylko przez **HTTPS** (GitHub Pages) — nie z pliku lokalnego