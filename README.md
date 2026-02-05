# 🤖 Slack → Codecks Bot v3.0

Bot integrujący Slack z Codecks - automatycznie tworzy karty w Codecks na podstawie wiadomości na Slacku.

---

## 📁 Struktura projektu

```
slack-codecks-bot/
├── src/
│   ├── index.js      # Główny serwer (EXPRESS)
│   ├── parser.js     # Parser wiadomości Slack
│   └── codecks.js    # Klient API Codecks
├── config.json       # Konfiguracja publiczna (puste wartości)
├── package.json      # Zależności npm
├── .gitignore        # Ignorowane pliki
└── README.md         # Ta dokumentacja
```

### ❌ Pliki które możesz usunąć z GitHub (jeśli są):
- `node_modules/` - instalowane automatycznie
- `.env` - NIGDY nie commituj! (dane wrażliwe)
- `package-lock.json` - opcjonalnie
- `yarn.lock` - opcjonalnie
- Inne pliki testowe/tymczasowe

---

## 🚀 Szybki start

### 1. Sklonuj repo
```bash
git clone https://github.com/TWOJ-USER/slack-codecks-bot.git
```

### 2. Deploy na Render.com
- New → Web Service → Connect GitHub repo
- Environment: Node
- Build: `npm install`
- Start: `npm start`

### 3. Skonfiguruj Environment Variables (poniżej)

### 4. Skonfiguruj Slack App (poniżej)

---

## ⚙️ Environment Variables (Render)

W Render Dashboard → Environment dodaj te zmienne:

| Zmienna | Wartość | Skąd wziąć? |
|---------|---------|-------------|
| `SLACK_BOT_TOKEN` | `xoxb-...` | [Jak zdobyć →](#slack_bot_token) |
| `SLACK_SIGNING_SECRET` | `abc123...` | [Jak zdobyć →](#slack_signing_secret) |
| `CODECKS_TOKEN` | `R6U1i...` | [Jak zdobyć →](#codecks_token) |
| `CODECKS_SUBDOMAIN` | `ten-week` | [Jak zdobyć →](#codecks_subdomain) |
| `DEFAULT_DECK_ID` | `0a456bc4-870d-...` | [Jak zdobyć →](#default_deck_id) |
| `ALLOWED_CHANNELS` | `C0ACGF89VRV,C123...` | [Jak zdobyć →](#allowed_channels) |
| `USER_MAPPING` | `{"tobiasz":"uuid..."}` | [Jak zdobyć →](#user_mapping) |
| `DECK_MAPPING` | `{"design":"uuid..."}` | [Jak zdobyć →](#deck_mapping) |
| `PORT` | `3000` | Zostaw domyślnie |

---

## 🔑 Skąd brać dane?

### SLACK_BOT_TOKEN

1. Wejdź: https://api.slack.com/apps
2. Kliknij swoją aplikację (lub stwórz nową)
3. Lewe menu → **OAuth & Permissions**
4. Sekcja **Bot Token Scopes** - dodaj:
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `reactions:write`
5. Kliknij **Install to Workspace** (góra strony)
6. Skopiuj **Bot User OAuth Token** (`xoxb-...`)

---

### SLACK_SIGNING_SECRET

1. https://api.slack.com/apps → Twoja aplikacja
2. Lewe menu → **Basic Information**
3. Sekcja **App Credentials**
4. Skopiuj **Signing Secret**

---

### CODECKS_TOKEN

1. Zaloguj się na https://TWOJ-SUBDOMAIN.codecks.io
2. Otwórz DevTools: **F12**
3. Zakładka **Application** (Chrome) lub **Storage** (Firefox)
4. Lewe menu → **Cookies** → `api.codecks.io`
5. Znajdź cookie o nazwie **`at`**
6. Skopiuj jego **Value**

⚠️ Token wygasa po wylogowaniu! Jeśli bot przestanie działać - odśwież token.

---

### CODECKS_SUBDOMAIN

Twój subdomain to część URL przed `.codecks.io`:

```
https://TEN-WEEK.codecks.io
         ^^^^^^^^
         to jest subdomain
```

Przykład: `ten-week`

---

### DEFAULT_DECK_ID

UUID decka znajdziesz przez Network tab:

1. Otwórz swój deck w Codecks (np. `https://ten-week.codecks.io/decks/3-code`)
2. **F12** → zakładka **Network**
3. **F5** (odśwież stronę)
4. Kliknij na request `api.codecks.io`
5. Zakładka **Response**
6. **Ctrl+F** → szukaj: `"deck"`
7. Znajdź UUID w formacie: `"id": "0a456bc4-870d-11f0-8179-5b0e5e00b26f"`
8. Skopiuj UUID (bez cudzysłowów)

---

### ALLOWED_CHANNELS

ID kanałów Slack gdzie bot ma działać:

1. Na Slacku kliknij **nazwę kanału** (na górze)
2. Przewiń na dół okna
3. Skopiuj **Channel ID** (np. `C0ACGF89VRV`)

Wiele kanałów oddziel przecinkami (BEZ spacji):
```
C0ACGF89VRV,C1234567890,C0987654321
```

💡 Jeśli zostawisz puste - bot działa na WSZYSTKICH kanałach gdzie jest zaproszony.

---

### USER_MAPPING

Mapowanie imion na UUID użytkowników Codecks.

**Format:** JSON w jednej linii
```json
{"tobiasz":"e0848851-870c-11f0-8179-d76408cd0e09","anna":"inny-uuid"}
```

**Jak znaleźć UUID użytkownika:**

1. Otwórz Codecks → **F12** → **Network**
2. Odśwież stronę (**F5**)
3. Kliknij na `api.codecks.io` request
4. **Response** → **Ctrl+F** → szukaj: `userId` lub `user`
5. Znajdź UUID użytkownika

💡 Klucze są case-insensitive (małe/duże litery nie mają znaczenia)

---

### DECK_MAPPING

Mapowanie nazw decków na UUID. Obsługuje **Space/Deck** lub sam **Deck**.

**Format:** JSON w jednej linii
```json
{"mt/backlog":"uuid-1","mt/code":"uuid-2","design":"uuid-3"}
```

**Przykłady użycia w Slack:**
| W wiadomości | Szuka w DECK_MAPPING |
|--------------|---------------------|
| `[Deck: MT/Backlog]` | `"mt/backlog"` |
| `[Deck: MT/Code]` | `"mt/code"` |
| `[Deck: Design]` | `"design"` |

**Jak znaleźć UUID decka:** tak samo jak DEFAULT_DECK_ID (Network tab)

💡 Nazwy są case-insensitive (`MT/Backlog` = `mt/backlog` = `MT/BACKLOG`)

---

## 📱 Konfiguracja Slack App

### 1. Utwórz aplikację
1. https://api.slack.com/apps → **Create New App**
2. **From scratch**
3. Nazwa: `Codecks Bot`
4. Workspace: twój workspace

### 2. Uprawnienia (OAuth & Permissions)
Dodaj **Bot Token Scopes**:
- `channels:history` - czytanie wiadomości
- `channels:read` - lista kanałów
- `chat:write` - wysyłanie wiadomości
- `reactions:write` - dodawanie reakcji emoji

### 3. Event Subscriptions
1. **Event Subscriptions** → włącz **Enable Events**
2. **Request URL**: 
   ```
   https://TWOJA-NAZWA.onrender.com/slack/events
   ```
3. Poczekaj na **Verified ✓**
4. **Subscribe to bot events** → dodaj: `message.channels`
5. **Save Changes**

### 4. Zainstaluj aplikację
1. **Install App** → **Install to Workspace**
2. **Allow**

### 5. Zaproś bota na kanał
Na kanale Slack napisz:
```
/invite @Codecks Bot
```

---

## 💬 Format wiadomości

### Podstawowy format:

```
[Create]

Nazwa Taska (Owner)
• Opis linia 1
• Opis linia 2
• [ ] Checkbox 1
• [] Checkbox 2
   • Wcięcie w tekście

Drugi Task (Inna Osoba)
• Opis tego taska
```

### Z wyborem decka:

```
[Create] [Deck: Design]

Nazwa Taska (Tobiasz)
• Opis
```

### Zasady:

| Element | Jak pisać | Znaczenie |
|---------|-----------|-----------|
| `[Create]` | Na początku | Uruchamia tworzenie tasków |
| `[Deck: nazwa]` | Po [Create] | Wybiera deck (opcjonalne) |
| `[Deck: Space/Deck]` | Po [Create] | Wybiera deck w Space |
| `Nazwa taska` | Bez bullet | Tytuł nowej karty |
| `(Owner)` | Przy nazwie | Przypisuje osobę |
| `• tekst` | Z bullet | Linia opisu |
| `• [ ]` lub `• []` | Z bullet | Checkbox |
| `   • tekst` | Wcięty bullet | Wcięcie w tekście |
| Pusta linia | Między taskami | Separator tasków |

### Akceptowane bullet points:
- `•` (formatowanie Slacka)
- `-` (myślnik)
- `*` (gwiazdka)

---

## 🤖 Komendy

| Komenda | Opis |
|---------|------|
| `!help` | Pokazuje przykład użycia |
| `!commands` | Lista dostępnych komend |

---

## 📋 Przykłady

### Prosty task:
```
[Create]

Napraw bug z logowaniem
• Użytkownicy nie mogą się zalogować przez Google
```

### Task z właścicielem:
```
[Create]

Zaprojektuj nowe menu (Anna)
• Styl minimalistyczny
• Responsywne
```

### Wiele tasków:
```
[Create]

System walki (Tobiasz)
• Multiplayer support
• Dodaj animacje
• [ ] Idle animation
• [ ] Attack animation

UI Design (Anna)
• Zaprojektuj główne menu
   • Logo na środku
   • Przyciski na dole
• [ ] Mobile version

Bug fixes
• Napraw crash przy starcie
```

### Z wyborem decka:
```
[Create] [Deck: Bugs]

Crash na iOS
• Aplikacja crashuje przy otwieraniu kamery
• Dotyczy iOS 17+
```

### Z wyborem Space/Deck:
```
[Create] [Deck: MT/Backlog]

Nowy feature (Tobiasz)
• Opis feature'a
   • Szczegóły implementacji
• [ ] Code review
• [ ] Deploy
```
`MT` = Space, `Backlog` = Deck w tym Space

---

## 🔧 Troubleshooting

### Bot nie reaguje na wiadomości

1. **Sprawdź logi w Render** (Dashboard → Logs)
2. **Event Subscriptions**:
   - Czy Request URL jest poprawny?
   - Czy status to "Verified"?
   - Czy dodano `message.channels`?
3. **Reinstall App** po zmianie uprawnień
4. **Czy bot jest zaproszony** na kanał? (`/invite @Bot`)
5. **Czy kanał jest w ALLOWED_CHANNELS**?

### Błąd: "missing_scope"
- Dodaj brakujące uprawnienie w **OAuth & Permissions**
- **Reinstall to Workspace**

### Błąd: "field 'deckId' not a valid uuid"
- DEFAULT_DECK_ID musi być UUID (nie slug!)
- Format: `0a456bc4-870d-11f0-8179-5b0e5e00b26f`
- NIE: `3-code` (to slug z URL)

### Błąd: "Codecks API Error (401)"
- Token wygasł - odśwież CODECKS_TOKEN

### Karta się tworzy ale bez właściciela
- Sprawdź USER_MAPPING - czy imię się zgadza?
- Imiona są case-insensitive ale muszą być takie same

### Bot śpi (Render free tier)
- Na darmowym planie serwer zasypia po 15 min nieaktywności
- Slack automatycznie "obudzi" go przy następnej wiadomości
- Pierwsza odpowiedź może trwać ~30 sekund

---

## 🌐 Endpointy

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/` | GET | Strona główna z dokumentacją |
| `/health` | GET | Health check (status, wersja) |
| `/slack/events` | POST | Webhook dla Slack Events API |

---

## 📦 Zależności

```json
{
  "@slack/web-api": "^6.9.0",
  "express": "^4.18.2",
  "dotenv": "^16.3.1"
}
```

---

## 🔒 Bezpieczeństwo

- ⚠️ **NIGDY** nie commituj `.env` ani prawdziwych tokenów!
- Wszystkie wrażliwe dane trzymaj w **Environment Variables** w Render
- Bot weryfikuje podpis Slack (ochrona przed fałszywymi requestami)
- Token Codecks wygasa - odświeżaj regularnie

---

## 📝 Changelog

### v3.2
- Obsługa `[Deck: Space/Deck]` - wybór decka w Space
- Zaktualizowane `!help` i `!commands`

### v3.1
- Naprawione wcięcia (nie tworzą nowego taska)

### v3.0
- Nowa architektura wiadomości (tytuł bez bullet)
- Obsługa `[Deck: nazwa]` - wybór decka
- DECK_MAPPING w konfiguracji
- Pusta linia jako separator tasków
- Wcięcia w tekście

### v2.0
- Wielopoziomowa struktura (opis + checkboxy)
- Komendy `!help` i `!commands`
- Trigger `[Create]`

### v1.0
- Podstawowa integracja
- Format `- Task (Owner)`

---

## 🤝 Autor

Bot stworzony dla integracji Slack ↔ Codecks.

---

## 📄 Licencja

MIT License - używaj jak chcesz!
