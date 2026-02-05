#!/usr/bin/env node

/**
 * Skrypt pomocniczy do konfiguracji integracji Slack-Codecks v4.0
 * 
 * Użycie:
 *   npm run setup
 *   lub
 *   node scripts/setup.js
 */

require('dotenv').config();
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { CodecksClient } = require('../src/codecks');
const { MappingCache } = require('../src/cache');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

async function main() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║       🔧 SETUP SLACK-CODECKS INTEGRATION v4.0                ║
║                                                              ║
║       Dynamiczne mappingi - aliasy zamiast UUID!             ║
╚══════════════════════════════════════════════════════════════╝
`);

    // Sprawdzenie czy .env istnieje
    const envPath = path.join(__dirname, '..', '.env');
    const envExamplePath = path.join(__dirname, '..', '.env.example');
    
    if (!fs.existsSync(envPath)) {
        console.log('⚠️  Plik .env nie istnieje!');
        console.log('   Skopiuj .env.example do .env i uzupełnij wartości.\n');
        
        const copy = await question('Czy skopiować .env.example do .env? (y/n): ');
        if (copy.toLowerCase() === 'y') {
            fs.copyFileSync(envExamplePath, envPath);
            console.log('✅ Skopiowano .env.example → .env');
            console.log('   Uzupełnij wartości w pliku .env i uruchom setup ponownie.\n');
            rl.close();
            return;
        }
    }

    // Sprawdzenie zmiennych środowiskowych
    const requiredVars = ['CODECKS_TOKEN', 'CODECKS_SUBDOMAIN', 'SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'];
    const missing = requiredVars.filter(v => !process.env[v]);
    
    if (missing.length > 0) {
        console.log('❌ Brakujące zmienne środowiskowe:');
        missing.forEach(v => console.log(`   - ${v}`));
        console.log('\n   Uzupełnij plik .env i uruchom setup ponownie.\n');
        rl.close();
        return;
    }

    console.log('✅ Zmienne środowiskowe OK\n');

    // Test połączenia z Codecks
    console.log('🔄 Testowanie połączenia z Codecks...');
    
    try {
        const client = new CodecksClient(
            process.env.CODECKS_TOKEN,
            process.env.CODECKS_SUBDOMAIN
        );
        
        const connected = await client.testConnection();
        if (!connected) {
            throw new Error('Nie można połączyć się z Codecks API');
        }

        // Inicjalizacja cache (pobiera wszystkie dane)
        console.log('🔄 Pobieranie danych z Codecks...\n');
        const cache = new MappingCache();
        await cache.initialize(client);

        // Pobranie spaces
        const spaces = cache.listSpaces();
        if (spaces.length > 0) {
            console.log('📂 Dostępne Spaces (projekty):');
            console.log('─'.repeat(60));
            spaces.forEach((space, i) => {
                console.log(`   ${i + 1}. ${space.name}`);
                console.log(`      UUID: ${space.id}`);
                console.log('');
            });
        }

        // Pobranie decków
        const decks = cache.listDecks();
        console.log('🎴 Dostępne Decki:');
        console.log('─'.repeat(60));
        decks.forEach((deck, i) => {
            console.log(`   ${i + 1}. ${deck.name}${deck.space ? ` (${deck.space})` : ''}`);
            console.log(`      UUID: ${deck.id}`);
            console.log('');
        });

        // Pobranie użytkowników
        const users = cache.listUsers();
        console.log('👥 Użytkownicy:');
        console.log('─'.repeat(60));
        users.forEach((user, i) => {
            console.log(`   ${i + 1}. ${user.name}`);
            console.log(`      UUID: ${user.id}`);
            console.log('');
        });

        // Generowanie przykładowych aliasów
        console.log('💡 NOWY SYSTEM v4.0 - ALIASY:');
        console.log('─'.repeat(60));
        console.log('   Mappingi to teraz ALIASY (skróty → pełne nazwy), nie UUID!');
        console.log('   Bot automatycznie pobiera UUID z API przy starcie.\n');

        // Przykładowe SPACE_MAPPING
        if (spaces.length > 0) {
            console.log('📂 Przykładowy SPACE_MAPPING:');
            const spaceMapping = {};
            spaces.slice(0, 3).forEach(space => {
                const alias = space.name.split(' ').map(w => w[0]).join('').toUpperCase();
                spaceMapping[alias] = space.name;
            });
            console.log(`   SPACE_MAPPING=${JSON.stringify(spaceMapping)}\n`);
        }

        // Przykładowe DECK_MAPPING
        console.log('🎴 Przykładowy DECK_MAPPING (lub pusty {}):');
        const deckMapping = {};
        decks.slice(0, 3).forEach(deck => {
            const alias = deck.name.substring(0, 2).toUpperCase();
            deckMapping[alias] = deck.name;
        });
        console.log(`   DECK_MAPPING=${JSON.stringify(deckMapping)}`);
        console.log(`   lub: DECK_MAPPING={} (szuka po nazwie)\n`);

        // Przykładowe USER_MAPPING
        console.log('👥 Przykładowy USER_MAPPING (lub pusty {}):');
        const userMapping = {};
        users.slice(0, 3).forEach(user => {
            const alias = user.name.split(' ')[0].substring(0, 2).toUpperCase();
            userMapping[alias] = user.name;
        });
        console.log(`   USER_MAPPING=${JSON.stringify(userMapping)}`);
        console.log(`   lub: USER_MAPPING={} (szuka po nazwie)\n`);

        // Zapisanie konfiguracji
        const saveConfig = await question('Czy wygenerować przykładowy plik .env.generated? (y/n): ');
        if (saveConfig.toLowerCase() === 'y') {
            const defaultDeck = decks.length > 0 ? decks[0].name : '';
            
            const envContent = `# Wygenerowano przez setup.js
# Skopiuj potrzebne wartości do .env

# Domyślny deck (opcjonalnie) - używaj NAZWY, nie UUID!
DEFAULT_DECK_NAME=${defaultDeck}

# Aliasy dla spaces (skróty → pełne nazwy)
SPACE_MAPPING=${JSON.stringify(spaces.length > 0 ? 
    Object.fromEntries(spaces.slice(0, 5).map(s => [
        s.name.split(' ').map(w => w[0]).join('').toUpperCase(),
        s.name
    ])) : {})}

# Aliasy dla decków (lub pusty {} = szuka po nazwie)
DECK_MAPPING={}

# Aliasy dla userów (lub pusty {} = szuka po nazwie)  
USER_MAPPING={}

# Lista UUID dla referencji (NIE używaj w mappingach!):
# Spaces:
${spaces.map(s => `#   ${s.name}: ${s.id}`).join('\n')}
# Decks:
${decks.map(d => `#   ${d.name}${d.space ? ` (${d.space})` : ''}: ${d.id}`).join('\n')}
# Users:
${users.map(u => `#   ${u.name}: ${u.id}`).join('\n')}
`;
            
            const generatedPath = path.join(__dirname, '..', '.env.generated');
            fs.writeFileSync(generatedPath, envContent);
            console.log(`\n✅ Zapisano do: ${generatedPath}\n`);
        }

        // Podsumowanie
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    📋 CO DALEJ?                              ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  1. Ustaw DEFAULT_DECK_NAME w .env (opcjonalnie)            ║
║     → DEFAULT_DECK_NAME=Backlog                              ║
║                                                              ║
║  2. Ustaw SPACE_MAPPING jeśli chcesz skrótów:               ║
║     → SPACE_MAPPING={"MT": "MA TXA"}                        ║
║     lub zostaw puste: SPACE_MAPPING={}                       ║
║                                                              ║
║  3. DECK_MAPPING i USER_MAPPING - ustaw lub zostaw {}       ║
║     Pusty mapping = szuka bezpośrednio po nazwie            ║
║                                                              ║
║  4. Uruchom serwer:                                          ║
║     → npm start                                              ║
║                                                              ║
║  5. Skonfiguruj Request URL w Slack App:                     ║
║     → https://twoja-domena.com/slack/events                  ║
║                                                              ║
║  6. Użyj w Slack:                                            ║
║     [Create] [Deck: MT/Backlog] Task (Imię)                 ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

    } catch (error) {
        console.error('❌ Błąd:', error.message);
        console.log('\n   Sprawdź CODECKS_TOKEN i CODECKS_SUBDOMAIN w .env\n');
    }

    rl.close();
}

main().catch(console.error);
