# Slack → Codecks Bot v4.0

Bot integrujący Slack z Codecks. Tworzy karty w Codecks na podstawie wiadomości ze Slacka.

## 🚀 Nowości w v4.0 - Dynamiczne Mappingi

**Kluczowa zmiana:** Mappingi to teraz **aliasy (skróty → pełne nazwy)**, nie UUID!

Bot przy starcie:
1. Pobiera z Codecks API listę spaces, decków i userów
2. Cachuje: `nazwa → UUID`
3. SPACE_MAPPING, DECK_MAPPING, USER_MAPPING to tylko skróty → pełne nazwy
4. Gdy mapping pusty `{}` - szuka bezpośrednio po nazwie ze Slacka

### Przykład działania:

```
SPACE_MAPPING = {"MT": "MA TXA"}
DECK_MAPPING = {}       ← pusty = szuka po nazwie
USER_MAPPING = {}

[Deck: MT/Backlog] (Tobiasz)
```

Resolvowanie:
- `MT` → alias → `"MA TXA"` → cache → UUID space
- `Backlog` → szuka w cache decks → UUID deck  
- `Tobiasz` → szuka w cache users → UUID user

## 📝 Format wiadomości

### Podstawowy format
```
[Create] Nazwa Taska (Owner)
• Opis linia 1
• Opis linia 2
   • Wcięcie w tekście
• [ ] Checkbox 1
• [] Checkbox 2
```

### Z wyborem Deck
```
[Create] [Deck: Backlog] Nazwa Taska (Owner)
• Opis
```

### Z wyborem Space/Deck
```
[Create] [Deck: MT/Backlog] Nazwa Taska
• Opis
```

### Wiele tasków
```
[Create] [Deck: MT/Code]

Task Pierwszy (Tobiasz)
• Opis
• [ ] Checkbox

Task Drugi (Anna)
• Inny opis
```

## ⚙️ Konfiguracja

### Zmienne środowiskowe

| Zmienna | Opis |
|---------|------|
| `SLACK_BOT_TOKEN` | Token bota Slack (xoxb-...) |
| `SLACK_SIGNING_SECRET` | Signing Secret z konfiguracji Slack App |
| `CODECKS_TOKEN` | Token API Codecks |
| `CODECKS_SUBDOMAIN` | Subdomena organizacji Codecks |
| `PORT` | Port serwera (domyślnie 3000) |

### Aliasy (opcjonalne)

| Zmienna | Opis | Przykład |
|---------|------|----------|
| `SPACE_MAPPING` | Aliasy dla spaces | `{"MT": "MA TXA"}` |
| `DECK_MAPPING` | Aliasy dla decków | `{"BL": "Backlog"}` |
| `USER_MAPPING` | Aliasy dla userów | `{"TB": "Tobiasz"}` |
| `DEFAULT_DECK_NAME` | Domyślny deck (nazwa) | `"Backlog"` |
| `DEFAULT_DECK_ID` | Domyślny deck (UUID) | `"abc-123"` |

**Pusty mapping `{}`** = bot szuka bezpośrednio po nazwie ze Slacka.

## 🤖 Komendy Slack

| Komenda | Opis |
|---------|------|
| `!help` | Przykład użycia |
| `!commands` | Lista komend |
| `!status` | Status cache mappingów |
| `!refresh` | Odśwież cache |

## 🌐 Endpointy HTTP

| Endpoint | Opis |
|----------|------|
| `/` | Strona główna z dokumentacją |
| `/health` | Health check (JSON) |
| `/list-spaces` | Lista spaces z cache |
| `/list-decks` | Lista decków z cache |
| `/list-users` | Lista userów z cache |
| `/refresh-cache` | Odśwież cache (POST) |
| `/slack/events` | Endpoint dla Slack Events API |

## 🚀 Instalacja

### 1. Klonowanie
```bash
git clone <repo>
cd slack-codecks-bot
npm install
```

### 2. Konfiguracja
```bash
cp .env.example .env
# Edytuj .env z własnymi danymi
```

### 3. Uruchomienie
```bash
npm start
```

### 4. Konfiguracja Slack App
- Request URL: `https://your-domain.com/slack/events`
- Subscribe to bot events: `message.channels`, `message.groups`
- OAuth Scopes: `chat:write`, `reactions:write`, `channels:history`, `groups:history`

## 🔧 Jak uzyskać token Codecks

1. Zaloguj się do Codecks
2. Otwórz DevTools → Network
3. Znajdź request do `api.codecks.io`
4. Skopiuj wartość cookie `at` - to Twój token

## 📊 Architektura v4.0

```
┌─────────────────────────────────────────────────────────────┐
│                     SLACK MESSAGE                           │
│  [Create] [Deck: MT/Backlog] Task (Tobiasz)                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      PARSER (parser.js)                     │
│  Wyodrębnia: tasks[], deckPath, assigneeNames               │
│  (bez resolvowania UUID!)                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      CACHE (cache.js)                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Aliasy:                                              │   │
│  │   SPACE_MAPPING: {"MT": "MA TXA"}                   │   │
│  │   DECK_MAPPING:  {}                                  │   │
│  │   USER_MAPPING:  {}                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                              │                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Cache (nazwa → UUID):                                │   │
│  │   spaces: "ma txa" → "uuid-space"                   │   │
│  │   decks:  "backlog" → {id, spaceId}                 │   │
│  │   users:  "tobiasz" → "uuid-user"                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Resolvowanie:                                              │
│  1. Sprawdź alias: "MT" → "MA TXA"                         │
│  2. Szukaj w cache: "ma txa" → UUID                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  CODECKS API (codecks.js)                   │
│  createCard({ deckId: UUID, assigneeId: UUID, ... })       │
└─────────────────────────────────────────────────────────────┘
```

## 📁 Struktura plików

```
slack-codecks-bot/
├── src/
│   ├── index.js      # Główna aplikacja, Express server
│   ├── parser.js     # Parser wiadomości Slack
│   ├── codecks.js    # Klient API Codecks
│   └── cache.js      # Cache mappingów (nazwa → UUID)
├── config.json       # Domyślna konfiguracja
├── .env.example      # Przykład zmiennych środowiskowych
├── package.json
└── README.md
```

## 🔄 Migracja z v3.x

### Stary system (v3.x):
```env
# Mappingi to były UUID
DECK_MAPPING={"backlog": "abc-123-uuid", "code": "def-456-uuid"}
USER_MAPPING={"tobiasz": "user-uuid-123"}
```

### Nowy system (v4.0):
```env
# Mappingi to teraz ALIASY (lub puste)
DECK_MAPPING={}
USER_MAPPING={}
SPACE_MAPPING={"MT": "MA TXA"}
```

**Bot sam pobiera UUID z API!**

## 🐛 Troubleshooting

### Cache nie inicjalizuje się
- Sprawdź `CODECKS_TOKEN` i `CODECKS_SUBDOMAIN`
- Użyj endpointu `/health` do sprawdzenia statusu
- Użyj `!refresh` na Slacku do ręcznego odświeżenia

### Deck/User nie znaleziony
- Sprawdź `/list-decks` i `/list-users` czy nazwa jest poprawna
- Pamiętaj o wielkości liter w aliasach
- Użyj `!status` żeby zobaczyć ile jest zcachowanych elementów

### Karta nie tworzy się
- Sprawdź logi serwera
- Upewnij się że masz uprawnienia do tworzenia kart w Codecks
- Sprawdź czy deck ID jest poprawne

## 📜 Changelog

### v4.0 (2025-02-05)
- 🆕 Dynamiczne mappingi - cache pobierany z API przy starcie
- 🆕 Aliasy zamiast UUID w konfiguracji
- 🆕 Pełna obsługa ścieżek Space/Deck
- 🆕 Komendy `!status` i `!refresh`
- 🆕 Endpointy do przeglądania cache
- 🔧 Refaktoryzacja kodu - rozdzielenie parsera i cache

### v3.2
- Obsługa [Deck: Space/Deck]
- Wielopoziomowe taski

### v3.0
- Podstawowa integracja Slack → Codecks
