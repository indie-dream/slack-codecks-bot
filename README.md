# 🎮 Slack → Codecks Integration Bot

Bot automatycznie tworzy karty (taski) w Codecks na podstawie wiadomości ze Slacka.

## ✨ Funkcje

- 📝 Automatyczne tworzenie tasków z wiadomości Slack
- 👤 Przypisywanie tasków do użytkowników Codecks
- 🎯 Konfigurowalny docelowy deck
- ✅ Reakcje emoji jako potwierdzenie
- 🔄 Obsługa wielu tasków w jednej wiadomości

## 📋 Format wiadomości

```
- Stwórz Customization System (Janek X)
- Stwórz Policje w grze (Paweł M)
- Napraw bug z kolizjami
```

- `- ` na początku linii = nowy task
- `(Imię Nazwisko)` na końcu = przypisanie osoby
- Brak osoby = task nieprzypisany

## 🚀 Szybki start

### 1. Instalacja

```bash
git clone <repo-url>
cd slack-codecks-integration
npm install
```

### 2. Konfiguracja

```bash
# Skopiuj przykładowy plik środowiskowy
cp .env.example .env

# Uzupełnij wartości w .env
nano .env
```

### 3. Setup (automatyczne pobieranie ID)

```bash
npm run setup
```

### 4. Uruchomienie

```bash
npm start
```

## ⚙️ Konfiguracja

### Plik `.env`

| Zmienna | Opis |
|---------|------|
| `SLACK_BOT_TOKEN` | Token bota Slack (xoxb-...) |
| `SLACK_SIGNING_SECRET` | Secret do weryfikacji requestów |
| `CODECKS_TOKEN` | Token API Codecks |
| `CODECKS_SUBDOMAIN` | Subdomena organizacji Codecks |

### Plik `config.json`

| Parametr | Opis |
|----------|------|
| `defaultDeckId` | ID decka gdzie trafiają taski |
| `allowedChannels` | Lista kanałów do nasłuchiwania (puste = wszystkie) |
| `userMapping` | Mapowanie imion → ID użytkowników Codecks |

## 📚 Dokumentacja

Pełna dokumentacja z instrukcjami krok po kroku znajduje się w pliku:
**[DOKUMENTACJA.md](./DOKUMENTACJA.md)**

## 🧪 Testowanie

```bash
# Test parsera
npm test

# Test połączenia z Codecks
npm run test:codecks
```

## 🏗️ Struktura projektu

```
slack-codecks-integration/
├── src/
│   ├── index.js      # Główny serwer Express
│   ├── parser.js     # Parser wiadomości Slack
│   └── codecks.js    # Klient API Codecks
├── scripts/
│   └── setup.js      # Skrypt konfiguracyjny
├── config.json       # Konfiguracja aplikacji
├── .env.example      # Przykładowe zmienne środowiskowe
├── package.json
└── README.md
```

## 📄 Licencja

MIT
