#!/usr/bin/env node

/**
 * Skrypt pomocniczy do konfiguracji integracji Slack-Codecks
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

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

async function main() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║         🔧 SETUP SLACK-CODECKS INTEGRATION                   ║
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
        
        const account = await client.getAccountInfo();
        console.log(`✅ Połączono z organizacją: ${account.name}\n`);

        // Pobranie decków
        console.log('📚 Dostępne decki:');
        console.log('─'.repeat(60));
        
        const decks = await client.getDecks();
        decks.forEach((deck, i) => {
            console.log(`   ${i + 1}. ${deck.title}`);
            console.log(`      ID: ${deck.id}`);
            console.log(`      Karty: ${deck.cardCount || 0}`);
            console.log('');
        });

        // Pobranie użytkowników
        console.log('👥 Użytkownicy:');
        console.log('─'.repeat(60));
        
        const users = await client.getUsers();
        users.forEach((user, i) => {
            console.log(`   ${i + 1}. ${user.fullName || user.username}`);
            console.log(`      ID: ${user.id}`);
            if (user.email) console.log(`      Email: ${user.email}`);
            console.log('');
        });

        // Generowanie sugerowanego mapowania
        console.log('🗺️  Sugerowane mapowanie użytkowników (do config.json):');
        console.log('─'.repeat(60));
        
        const mapping = await client.generateUserMapping();
        
        // Formatowanie jako JSON
        const mappingFormatted = JSON.stringify(mapping, null, 4)
            .split('\n')
            .map(line => '   ' + line)
            .join('\n');
        
        console.log(mappingFormatted);
        console.log('');

        // Zapisanie mapowania do pliku
        const saveMapping = await question('Czy zapisać mapowanie do pliku user-mapping.json? (y/n): ');
        if (saveMapping.toLowerCase() === 'y') {
            const mappingPath = path.join(__dirname, '..', 'user-mapping.json');
            fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
            console.log(`✅ Zapisano do: ${mappingPath}\n`);
        }

        // Podsumowanie
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    📋 CO DALEJ?                              ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  1. Skopiuj ID wybranego decka do config.json               ║
║     → "defaultDeckId": "TWOJ_DECK_ID"                       ║
║                                                              ║
║  2. Skopiuj mapowanie użytkowników do config.json           ║
║     → "userMapping": { ... }                                 ║
║                                                              ║
║  3. Uruchom serwer:                                          ║
║     → npm start                                              ║
║                                                              ║
║  4. Skonfiguruj Request URL w Slack App:                     ║
║     → https://twoja-domena.com/slack/events                  ║
║                                                              ║
║  5. Zaproś bota na kanał Slack:                              ║
║     → /invite @NazwaBota                                     ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

    } catch (error) {
        console.error('❌ Błąd połączenia z Codecks:', error.message);
        console.log('\n   Sprawdź CODECKS_TOKEN i CODECKS_SUBDOMAIN w .env\n');
    }

    rl.close();
}

main().catch(console.error);
