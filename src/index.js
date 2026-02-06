/**
 * Slack → Codecks Integration Bot v4.0
 * 
 * Dynamiczne mappingi - pobierane z API przy starcie:
 * - SPACE_MAPPING, DECK_MAPPING, USER_MAPPING to teraz tylko aliasy (skróty → pełne nazwy)
 * - Pusty mapping {} = szuka bezpośrednio po nazwie ze Slacka
 * - Cache: nazwa → UUID (pobierany z Codecks API)
 */

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { WebClient } = require('@slack/web-api');
const { 
    parseTaskMessage, 
    buildCardContent, 
    isCommand, 
    getCommandResponse,
    hasCreateCommand 
} = require('./parser');
const { CodecksClient } = require('./codecks');
const { mappingCache } = require('./cache');
const configFile = require('../config.json');

// Merge config: environment variables override config.json
const config = {
    ...configFile,
    defaultDeckId: process.env.DEFAULT_DECK_ID || configFile.defaultDeckId || null,
    defaultDeckName: process.env.DEFAULT_DECK_NAME || configFile.defaultDeckName || null,
    defaultSpaceId: process.env.DEFAULT_SPACE_ID || configFile.defaultSpaceId || null,
    allowedChannels: process.env.ALLOWED_CHANNELS 
        ? process.env.ALLOWED_CHANNELS.split(',') 
        : configFile.allowedChannels || [],
    
    // NOWE: Aliasy (skróty → pełne nazwy, NIE UUID!)
    spaceMapping: process.env.SPACE_MAPPING 
        ? JSON.parse(process.env.SPACE_MAPPING) 
        : configFile.spaceMapping || {},
    deckMapping: process.env.DECK_MAPPING
        ? JSON.parse(process.env.DECK_MAPPING)
        : configFile.deckMapping || {},
    userMapping: process.env.USER_MAPPING 
        ? JSON.parse(process.env.USER_MAPPING) 
        : configFile.userMapping || {}
};

const app = express();
const PORT = process.env.PORT || 3000;

// Slack Web Client
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

// Codecks Client
const codecksClient = new CodecksClient(
    process.env.CODECKS_TOKEN,
    process.env.CODECKS_SUBDOMAIN
);

// Deduplikacja eventów
const processedEvents = new Set();

// Middleware do weryfikacji Slack
app.use('/slack/events', express.raw({ type: 'application/json' }));

// JSON middleware dla innych endpointów
app.use(express.json());

/**
 * Weryfikuje podpis Slack
 */
function verifySlackSignature(req) {
    const timestamp = req.headers['x-slack-request-timestamp'];
    const signature = req.headers['x-slack-signature'];
    
    if (!timestamp || !signature) return false;
    
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
    if (timestamp < fiveMinutesAgo) return false;
    
    const sigBasestring = `v0:${timestamp}:${req.body}`;
    const mySignature = 'v0=' + crypto
        .createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
        .update(sigBasestring)
        .digest('hex');
    
    try {
        return crypto.timingSafeEqual(
            Buffer.from(mySignature),
            Buffer.from(signature)
        );
    } catch {
        return false;
    }
}

/**
 * Główny endpoint Slack Events API
 */
app.post('/slack/events', async (req, res) => {
    if (!verifySlackSignature(req)) {
        console.error('❌ Nieprawidłowy podpis Slack');
        return res.status(401).send('Unauthorized');
    }
    
    const payload = JSON.parse(req.body);
    
    // URL Verification
    if (payload.type === 'url_verification') {
        console.log('✅ URL Verification OK');
        return res.json({ challenge: payload.challenge });
    }
    
    // Odpowiadamy natychmiast
    res.status(200).send('OK');
    
    if (payload.type === 'event_callback') {
        await handleEvent(payload.event);
    }
});

/**
 * Obsługa eventu wiadomości
 */
async function handleEvent(event) {
    // Tylko wiadomości (nie boty, nie edycje)
    if (event.type !== 'message' || event.subtype || event.bot_id) {
        return;
    }
    
    // Deduplikacja
    const eventKey = `${event.client_msg_id || event.ts}`;
    if (processedEvents.has(eventKey)) {
        console.log('⏭️ Event już przetworzony');
        return;
    }
    processedEvents.add(eventKey);
    setTimeout(() => processedEvents.delete(eventKey), 10 * 60 * 1000);
    
    // Filtr kanałów
    if (config.allowedChannels && config.allowedChannels.length > 0) {
        if (!config.allowedChannels.includes(event.channel)) {
            return;
        }
    }
    
    const messageText = event.text || '';
    console.log('📨 Nowa wiadomość:', messageText.substring(0, 100));
    
    // DEBUG: Pokaż surowy tekst i blocks
    console.log('🔍 DEBUG RAW event.text:');
    console.log(JSON.stringify(messageText));
    if (event.blocks) {
        console.log('🔍 DEBUG event.blocks:');
        console.log(JSON.stringify(event.blocks, null, 2));
    }
    
    // Zapisz do debugowania przez endpoint /debug-message
    lastRawEvent = {
        timestamp: new Date().toISOString(),
        text: messageText,
        textJson: JSON.stringify(messageText),
        blocks: event.blocks || null,
        hasBlocks: !!event.blocks,
        charCodes: [...messageText].map(c => ({ char: c, code: c.charCodeAt(0), hex: 'U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') }))
    };
    
    // Sprawdź czy to komenda
    if (isCommand(messageText)) {
        console.log('🤖 Komenda wykryta:', messageText.trim());
        await handleCommand(event.channel, event.ts, messageText);
        return;
    }
    
    // Sprawdź czy zawiera [Create]
    if (!hasCreateCommand(messageText)) {
        console.log('ℹ️ Brak [Create] w wiadomości');
        return;
    }
    
    // Sprawdź czy cache jest zainicjalizowany
    if (!mappingCache.initialized) {
        console.log('⚠️ Cache nie zainicjalizowany - próba inicjalizacji...');
        try {
            await mappingCache.initialize(codecksClient);
        } catch (error) {
            console.error('❌ Nie można zainicjalizować cache:', error.message);
            await addReaction(event.channel, event.ts, { failed: [{ error: 'Cache error' }], success: [] });
            return;
        }
    }
    
    // Parsowanie wiadomości — blocks (rich_text) mają priorytet nad text
    const { tasks, deckPath } = parseTaskMessage(messageText, event.blocks || null);
    
    if (tasks.length === 0) {
        console.log('ℹ️ Brak tasków w wiadomości');
        return;
    }
    
    console.log(`📋 Znaleziono ${tasks.length} task(ów)${deckPath ? ` [Deck: ${deckPath}]` : ''}`);
    
    // Resolvuj assignees → UUID i deck → UUID dla każdego taska
    const tasksWithUuids = tasks.map(task => {
        // Każdy task może mieć własny deckPath (z nowego parsera v4.1)
        const taskDeckPath = task.deckPath || deckPath;
        let taskDeckId = null;
        
        if (taskDeckPath) {
            taskDeckId = resolveDeckId(taskDeckPath);
        }
        
        // Fallback do domyślnego decka
        if (!taskDeckId) {
            taskDeckId = config.defaultDeckId || resolveDefaultDeck();
        }
        
        return {
            ...task,
            deckId: taskDeckId,
            assigneeId: task.assigneeName 
                ? mappingCache.resolveUser(task.assigneeName, config.userMapping)
                : null
        };
    });
    
    // Sprawdź czy wszystkie taski mają deck
    const tasksWithoutDeck = tasksWithUuids.filter(t => !t.deckId);
    if (tasksWithoutDeck.length > 0) {
        console.error(`❌ ${tasksWithoutDeck.length} task(ów) bez deck ID`);
    }
    
    // Filtruj tylko taski z deckId
    const validTasks = tasksWithUuids.filter(t => t.deckId);
    
    if (validTasks.length === 0) {
        console.error('❌ Żaden task nie ma deck ID');
        await addReaction(event.channel, event.ts, { failed: [{ error: 'No deck' }], success: [] });
        return;
    }
    
    // Tworzenie kart (każdy task z własnym deckId)
    const results = await createCardsInCodecks(validTasks);
    
    // Reakcja
    await addReaction(event.channel, event.ts, results);
}

/**
 * Resolvuje deck path do UUID
 */
function resolveDeckId(deckPath) {
    if (!deckPath) return null;
    
    console.log(`🔍 Resolvowanie deck: "${deckPath}"`);
    
    return mappingCache.resolveDeck(
        deckPath, 
        config.deckMapping,      // Aliasy dla decków
        config.spaceMapping      // Aliasy dla spaces (dla ścieżek space/deck)
    );
}

/**
 * Resolvuje domyślny deck (jeśli skonfigurowany przez nazwę)
 */
function resolveDefaultDeck() {
    if (config.defaultDeckName) {
        console.log(`🔍 Resolvowanie domyślnego decka: "${config.defaultDeckName}"`);
        return mappingCache.resolveDeck(
            config.defaultDeckName,
            config.deckMapping,
            config.spaceMapping
        );
    }
    return null;
}

/**
 * Obsługuje komendy !help, !commands, !status, !refresh
 */
async function handleCommand(channel, timestamp, message) {
    const trimmed = message.trim().toLowerCase();
    
    // Specjalna obsługa !refresh
    if (trimmed === '!refresh') {
        try {
            await mappingCache.refresh(codecksClient);
            await slackClient.chat.postMessage({
                channel: channel,
                thread_ts: timestamp,
                text: '✅ Cache odświeżony!\n\n' + formatCacheStats()
            });
        } catch (error) {
            await slackClient.chat.postMessage({
                channel: channel,
                thread_ts: timestamp,
                text: `❌ Błąd odświeżania cache: ${error.message}`
            });
        }
        return;
    }
    
    const response = getCommandResponse(message, mappingCache.getStats());
    
    if (response) {
        try {
            await slackClient.chat.postMessage({
                channel: channel,
                thread_ts: timestamp,
                text: response
            });
            console.log('✅ Odpowiedź na komendę wysłana');
        } catch (error) {
            console.error('❌ Błąd wysyłania odpowiedzi:', error.message);
        }
    }
}

/**
 * Formatuje statystyki cache
 */
function formatCacheStats() {
    const stats = mappingCache.getStats();
    return `📂 Spaces: ${stats.spaces}\n🎴 Decks: ${stats.decks}\n👥 Users: ${stats.users}`;
}

/**
 * Tworzy karty w Codecks
 * Każdy task ma własny deckId (task.deckId)
 */
async function createCardsInCodecks(tasks) {
    const results = { success: [], failed: [] };
    
    for (const task of tasks) {
        try {
            // Buduj pełny content (tytuł + opis + checkboxy)
            const fullContent = buildCardContent(task);
            
            const cardData = {
                content: fullContent,
                deckId: task.deckId,  // Używaj deckId z taska
                assigneeId: task.assigneeId || null,
                priority: config.defaultPriority || 'b',
                putOnHand: task.assigneeId ? true : false
            };
            
            const card = await codecksClient.createCard(cardData);
            
            results.success.push({
                title: task.title,
                assignee: task.assigneeName,
                deckPath: task.deckPath,
                cardId: card.id,
                descLines: task.description.length,
                checkboxCount: task.checkboxes.length
            });
            
            console.log(`✅ Karta: "${task.title}" → ${task.assigneeName || 'nieprzypisana'} [Deck: ${task.deckPath || 'default'}]`);
            
        } catch (error) {
            results.failed.push({ title: task.title, error: error.message });
            console.error(`❌ Błąd tworzenia karty "${task.title}":`, error.message);
        }
    }
    
    return results;
}

/**
 * Dodaje reakcję emoji
 */
async function addReaction(channel, timestamp, results) {
    try {
        const emoji = results.failed.length === 0 
            ? (config.confirmationEmoji || 'white_check_mark')
            : (config.errorEmoji || 'warning');
        
        await slackClient.reactions.add({
            channel: channel,
            timestamp: timestamp,
            name: emoji
        });
        
    } catch (error) {
        console.error('Błąd dodawania reakcji:', error.message);
    }
}

// ============================================================
// WEB ENDPOINTS (konfiguracja i debugging)
// ============================================================

/**
 * Endpoint do listowania decków z cache
 */
app.get('/list-decks', async (req, res) => {
    try {
        // Upewnij się że cache jest załadowany
        if (!mappingCache.initialized) {
            await mappingCache.initialize(codecksClient);
        }
        
        const decks = mappingCache.listDecks();
        
        let html = `
<!DOCTYPE html>
<html>
<head>
    <title>Codecks Decks</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #1a1a2e; color: #eee; }
        h1 { color: #00d9ff; }
        table { border-collapse: collapse; width: 100%; margin-top: 20px; }
        th, td { border: 1px solid #444; padding: 12px; text-align: left; }
        th { background: #16213e; color: #00d9ff; }
        tr:nth-child(even) { background: #1f1f3a; }
        .uuid { font-family: monospace; background: #2d2d4a; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
        .copy-btn { margin-left: 10px; cursor: pointer; background: #00d9ff; border: none; padding: 4px 8px; border-radius: 4px; }
        pre { background: #2d2d4a; padding: 15px; border-radius: 8px; overflow-x: auto; }
        a { color: #00d9ff; }
        .info { background: #16213e; padding: 15px; border-radius: 8px; margin: 15px 0; }
    </style>
</head>
<body>
    <h1>🎴 Codecks Decks (z Cache)</h1>
    <p>Znaleziono: ${decks.length} deck(ów)</p>
    <p><a href="/list-users">👥 Lista użytkowników</a> | <a href="/list-spaces">📂 Lista Spaces</a> | <a href="/">🏠 Strona główna</a></p>
    
    <div class="info">
        <strong>💡 Nowy system v4.0:</strong><br>
        Mappingi to teraz tylko aliasy (skróty → pełne nazwy).<br>
        UUID są automatycznie pobierane z cache przy starcie bota.
    </div>
    
    <table>
        <tr>
            <th>Nazwa</th>
            <th>Space</th>
            <th>UUID (z cache)</th>
        </tr>`;
        
        for (const deck of decks) {
            html += `
        <tr>
            <td><strong>${deck.name || 'Bez nazwy'}</strong></td>
            <td>${deck.space || '-'}</td>
            <td>
                <span class="uuid">${deck.id}</span>
                <button class="copy-btn" onclick="navigator.clipboard.writeText('${deck.id}')">📋</button>
            </td>
        </tr>`;
        }
        
        // Przykład DECK_MAPPING (aliasy)
        const exampleMapping = {};
        let count = 0;
        for (const deck of decks) {
            if (deck.space && count < 3) {
                const alias = deck.name.substring(0, 3).toUpperCase();
                exampleMapping[alias] = deck.name;
                count++;
            }
        }
        
        html += `
    </table>
    
    <h2>📋 Przykład DECK_MAPPING (aliasy, nie UUID!):</h2>
    <pre>${JSON.stringify(exampleMapping, null, 2)}</pre>
    <p>DECK_MAPPING to teraz aliasy: <code>{"skrót": "pełna nazwa"}</code></p>
    <p>UUID są pobierane automatycznie z cache.</p>
    
    <h2>📋 Jeśli chcesz puste mapowanie (szuka po nazwie):</h2>
    <pre>{}</pre>
</body>
</html>`;
        
        res.send(html);
        
    } catch (error) {
        console.error('❌ Błąd pobierania decków:', error.message);
        res.status(500).send(`<h1>❌ Błąd</h1><p>${error.message}</p><p><a href="/">Powrót</a></p>`);
    }
});

/**
 * Endpoint do listowania użytkowników z cache
 */
app.get('/list-users', async (req, res) => {
    try {
        if (!mappingCache.initialized) {
            await mappingCache.initialize(codecksClient);
        }
        
        const users = mappingCache.listUsers();
        
        let html = `
<!DOCTYPE html>
<html>
<head>
    <title>Codecks Users</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #1a1a2e; color: #eee; }
        h1 { color: #00d9ff; }
        table { border-collapse: collapse; width: 100%; margin-top: 20px; }
        th, td { border: 1px solid #444; padding: 12px; text-align: left; }
        th { background: #16213e; color: #00d9ff; }
        tr:nth-child(even) { background: #1f1f3a; }
        .uuid { font-family: monospace; background: #2d2d4a; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
        pre { background: #2d2d4a; padding: 15px; border-radius: 8px; overflow-x: auto; }
        a { color: #00d9ff; }
        .info { background: #16213e; padding: 15px; border-radius: 8px; margin: 15px 0; }
    </style>
</head>
<body>
    <h1>👥 Codecks Users (z Cache)</h1>
    <p>Znaleziono: ${users.length} użytkownik(ów)</p>
    <p><a href="/list-decks">🎴 Lista decków</a> | <a href="/list-spaces">📂 Lista Spaces</a> | <a href="/">🏠 Strona główna</a></p>
    
    <div class="info">
        <strong>💡 Nowy system v4.0:</strong><br>
        USER_MAPPING to teraz aliasy. Pusty <code>{}</code> = szuka po nazwie ze Slacka.
    </div>
    
    <table>
        <tr>
            <th>Nazwa</th>
            <th>UUID (z cache)</th>
        </tr>`;
        
        for (const user of users) {
            html += `
        <tr>
            <td><strong>${user.name || 'Bez nazwy'}</strong></td>
            <td><span class="uuid">${user.id}</span></td>
        </tr>`;
        }
        
        html += `
    </table>
    
    <h2>📋 Przykład USER_MAPPING (aliasy):</h2>
    <pre>{"TB": "Tobiasz", "AK": "Anna Kowalska"}</pre>
    <p>Lub pusty (szuka po nazwie): <code>{}</code></p>
</body>
</html>`;
        
        res.send(html);
        
    } catch (error) {
        console.error('❌ Błąd pobierania użytkowników:', error.message);
        res.status(500).send(`<h1>❌ Błąd</h1><p>${error.message}</p><p><a href="/">Powrót</a></p>`);
    }
});

/**
 * Endpoint do listowania spaces z cache
 */
app.get('/list-spaces', async (req, res) => {
    try {
        if (!mappingCache.initialized) {
            await mappingCache.initialize(codecksClient);
        }
        
        const spaces = mappingCache.listSpaces();
        
        let html = `
<!DOCTYPE html>
<html>
<head>
    <title>Codecks Spaces</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #1a1a2e; color: #eee; }
        h1 { color: #00d9ff; }
        table { border-collapse: collapse; width: 100%; margin-top: 20px; }
        th, td { border: 1px solid #444; padding: 12px; text-align: left; }
        th { background: #16213e; color: #00d9ff; }
        tr:nth-child(even) { background: #1f1f3a; }
        .uuid { font-family: monospace; background: #2d2d4a; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
        pre { background: #2d2d4a; padding: 15px; border-radius: 8px; overflow-x: auto; }
        a { color: #00d9ff; }
        .info { background: #16213e; padding: 15px; border-radius: 8px; margin: 15px 0; }
    </style>
</head>
<body>
    <h1>📂 Codecks Spaces (z Cache)</h1>
    <p>Znaleziono: ${spaces.length} space(ów)</p>
    <p><a href="/list-decks">🎴 Lista decków</a> | <a href="/list-users">👥 Lista użytkowników</a> | <a href="/">🏠 Strona główna</a></p>
    
    <div class="info">
        <strong>💡 SPACE_MAPPING:</strong><br>
        Używaj skrótów do space'ów w ścieżkach deck: <code>[Deck: MT/Backlog]</code><br>
        gdzie MT to alias dla "MA TXA"
    </div>
    
    <table>
        <tr>
            <th>Nazwa Space</th>
            <th>UUID (z cache)</th>
        </tr>`;
        
        for (const space of spaces) {
            html += `
        <tr>
            <td><strong>${space.name || 'Bez nazwy'}</strong></td>
            <td><span class="uuid">${space.id}</span></td>
        </tr>`;
        }
        
        // Przykład SPACE_MAPPING
        const exampleMapping = {};
        for (const space of spaces.slice(0, 3)) {
            if (space.name) {
                const alias = space.name.split(' ').map(w => w[0]).join('').toUpperCase();
                exampleMapping[alias] = space.name;
            }
        }
        
        html += `
    </table>
    
    <h2>📋 Przykład SPACE_MAPPING (aliasy):</h2>
    <pre>${JSON.stringify(exampleMapping, null, 2)}</pre>
    <p>Użycie: <code>[Deck: MT/Backlog]</code> → MT zamienia na "MA TXA" → szuka w cache</p>
</body>
</html>`;
        
        res.send(html);
        
    } catch (error) {
        console.error('❌ Błąd pobierania spaces:', error.message);
        res.status(500).send(`<h1>❌ Błąd</h1><p>${error.message}</p><p><a href="/">Powrót</a></p>`);
    }
});

/**
 * DEBUG ENDPOINT - testuje API Codecks bezpośrednio
 * Otwórz w przeglądarce: /debug-api
 */
app.get('/debug-api', async (req, res) => {
    const results = [];
    
    async function testQuery(name, query) {
        try {
            const response = await fetch('https://api.codecks.io/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Auth-Token': process.env.CODECKS_TOKEN,
                    'X-Account': process.env.CODECKS_SUBDOMAIN
                },
                body: JSON.stringify({ query })
            });
            
            const text = await response.text();
            
            if (!response.ok) {
                results.push({ name, status: '❌', code: response.status, response: text.substring(0, 200) });
            } else {
                const data = JSON.parse(text);
                const preview = JSON.stringify(data).substring(0, 300);
                results.push({ name, status: '✅', code: response.status, response: preview });
            }
        } catch (error) {
            results.push({ name, status: '❌', code: 'ERR', response: error.message });
        }
    }
    
    // Uruchom testy
    await testQuery('1. Account (podstawowy test)', {
        "_root": [{ "account": ["id", "name"] }]
    });
    
    await testQuery('2. Projects (id, name)', {
        "_root": [{ "account": [{ "projects": ["id", "name"] }] }]
    });
    
    await testQuery('3. Projects (tylko id)', {
        "_root": [{ "account": [{ "projects": ["id"] }] }]
    });
    
    await testQuery('4. Decks (id, title)', {
        "_root": [{ "account": [{ "decks": ["id", "title"] }] }]
    });
    
    await testQuery('5. Decks (tylko id)', {
        "_root": [{ "account": [{ "decks": ["id"] }] }]
    });
    
    await testQuery('6. Users (id, name)', {
        "_root": [{ "account": [{ "users": ["id", "name"] }] }]
    });
    
    await testQuery('7. Users (tylko id)', {
        "_root": [{ "account": [{ "users": ["id"] }] }]
    });
    
    await testQuery('8. Roles', {
        "_root": [{ "account": [{ "roles": ["role", {"user": ["id", "name"]}] }] }]
    });
    
    await testQuery('9. Cards (limit 1)', {
        "_root": [{ "account": [{ 'cards({"$limit": 1})': ["id", "title"] }] }]
    });
    
    await testQuery('10. anyDecks', {
        "_root": [{ "account": [{ "anyDecks": ["id", "title"] }] }]
    });
    
    // Generuj HTML
    let html = `
<!DOCTYPE html>
<html>
<head>
    <title>Debug API Codecks</title>
    <style>
        body { font-family: monospace; padding: 20px; background: #1a1a2e; color: #eee; }
        h1 { color: #00d9ff; }
        .test { margin: 15px 0; padding: 15px; background: #16213e; border-radius: 8px; }
        .ok { border-left: 4px solid #4ade80; }
        .err { border-left: 4px solid #f87171; }
        .name { font-weight: bold; color: #00d9ff; }
        .response { margin-top: 10px; padding: 10px; background: #2d2d4a; border-radius: 4px; 
                    overflow-x: auto; white-space: pre-wrap; word-break: break-all; font-size: 12px; }
        a { color: #00d9ff; }
        .config { background: #2d2d4a; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
    </style>
</head>
<body>
    <h1>🔍 Debug API Codecks</h1>
    
    <div class="config">
        <strong>Konfiguracja:</strong><br>
        SUBDOMAIN: ${process.env.CODECKS_SUBDOMAIN || '❌ BRAK'}<br>
        TOKEN: ${process.env.CODECKS_TOKEN ? process.env.CODECKS_TOKEN.substring(0, 15) + '...' : '❌ BRAK'}
    </div>
    
    <p><a href="/">← Powrót</a></p>
`;
    
    for (const r of results) {
        const cssClass = r.status === '✅' ? 'ok' : 'err';
        html += `
    <div class="test ${cssClass}">
        <div class="name">${r.status} ${r.name}</div>
        <div>HTTP: ${r.code}</div>
        <div class="response">${r.response}</div>
    </div>`;
    }
    
    html += `
    <p style="margin-top: 30px;"><a href="/">← Powrót</a> | <a href="/debug-api">🔄 Odśwież</a></p>
</body>
</html>`;
    
    res.send(html);
});

// Przechowuj ostatni event do debugowania
let lastRawEvent = null;

/**
 * Debug: pokaż surowy event z ostatniej wiadomości
 */
app.get('/debug-message', (req, res) => {
    if (!lastRawEvent) {
        return res.send('<html><body style="background:#1a1a2e;color:#eee;font-family:monospace;padding:20px"><h1>🔍 Debug Message</h1><p>Brak zapisanych eventów. Wyślij wiadomość na Slacku i odśwież.</p><a href="/" style="color:#00d9ff">← Powrót</a></body></html>');
    }
    
    // Pokaż char-by-char analysis tekstu
    let charTable = '<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:12px"><tr><th>Pos</th><th>Char</th><th>Code</th><th>Hex</th><th>Name</th></tr>';
    const charNames = {
        10: 'NEWLINE (\\n)',
        13: 'CARRIAGE RETURN (\\r)',
        32: 'SPACE',
        42: 'ASTERISK (*)',
        45: 'HYPHEN (-)',
        8226: 'BULLET (•)',
        9702: 'WHITE BULLET (◦)',
        9679: 'BLACK CIRCLE (●)',
        8227: 'TRIANGULAR BULLET (‣)',
        160: 'NON-BREAKING SPACE',
        9: 'TAB',
    };
    
    for (let i = 0; i < lastRawEvent.charCodes.length && i < 500; i++) {
        const c = lastRawEvent.charCodes[i];
        const name = charNames[c.code] || '';
        const displayChar = c.code === 10 ? '↵' : c.code === 32 ? '·' : c.code === 9 ? '→' : c.code === 160 ? '°' : c.char;
        const highlight = [10, 8226, 9702, 42, 45].includes(c.code) ? 'background:#2d4a2d' : '';
        charTable += `<tr style="${highlight}"><td>${i}</td><td>${displayChar}</td><td>${c.code}</td><td>${c.hex}</td><td>${name}</td></tr>`;
    }
    charTable += '</table>';
    
    // Pokaż tekst z widocznymi znakami specjalnymi
    const visibleText = lastRawEvent.text
        .replace(/\n/g, '<span style="color:#4ade80">↵\\n</span>\n')
        .replace(/ /g, '<span style="color:#555">·</span>')
        .replace(/\t/g, '<span style="color:#f87171">→TAB</span>');
    
    res.send(`
    <html>
    <head><title>Debug Message</title>
    <style>
        body { font-family: monospace; padding: 20px; background: #1a1a2e; color: #eee; }
        h1, h2 { color: #00d9ff; }
        .box { background: #16213e; padding: 15px; border-radius: 8px; margin: 15px 0; overflow-x: auto; }
        pre { white-space: pre-wrap; word-break: break-all; }
        a { color: #00d9ff; }
        table { color: #eee; }
        th { background: #2d2d4a; }
    </style>
    </head>
    <body>
        <h1>🔍 Debug: Ostatnia wiadomość Slack</h1>
        <p>Czas: ${lastRawEvent.timestamp}</p>
        <p>Ma blocks: ${lastRawEvent.hasBlocks ? '✅ TAK' : '❌ NIE'}</p>
        
        <h2>📝 event.text (surowy):</h2>
        <div class="box"><pre>${visibleText}</pre></div>
        
        <h2>📝 event.text (JSON escaped):</h2>
        <div class="box"><pre>${lastRawEvent.textJson}</pre></div>
        
        <h2>🔤 Analiza char-by-char (pierwsze 500 znaków):</h2>
        <div class="box">${charTable}</div>
        
        ${lastRawEvent.blocks ? `
        <h2>📦 event.blocks:</h2>
        <div class="box"><pre>${JSON.stringify(lastRawEvent.blocks, null, 2)}</pre></div>
        ` : ''}
        
        <p><a href="/">← Powrót</a> | <a href="/debug-message">🔄 Odśwież</a></p>
    </body>
    </html>
    `);
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
    const stats = mappingCache.getStats();
    res.json({ 
        status: 'ok', 
        version: '4.0',
        timestamp: new Date().toISOString(),
        cache: {
            initialized: stats.initialized,
            lastRefresh: stats.lastRefresh,
            spaces: stats.spaces,
            decks: stats.decks,
            users: stats.users
        },
        config: {
            defaultDeckId: config.defaultDeckId ? '✓' : '✗',
            defaultDeckName: config.defaultDeckName || null,
            spaceAliases: Object.keys(config.spaceMapping).length,
            deckAliases: Object.keys(config.deckMapping).length,
            userAliases: Object.keys(config.userMapping).length
        }
    });
});

/**
 * Endpoint do odświeżania cache (POST)
 */
app.post('/refresh-cache', async (req, res) => {
    try {
        await mappingCache.refresh(codecksClient);
        res.json({ 
            status: 'ok', 
            message: 'Cache odświeżony',
            stats: mappingCache.getStats()
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            message: error.message 
        });
    }
});

/**
 * Główna strona
 */
app.get('/', (req, res) => {
    const stats = mappingCache.getStats();
    
    res.send(`
        <html>
        <head>
            <title>Slack-Codecks Bot v4.0</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; background: #1a1a2e; color: #eee; }
                h1 { color: #00d9ff; }
                h2 { color: #7bc0d6; }
                a { color: #00d9ff; }
                pre { background: #2d2d4a; padding: 15px; border-radius: 8px; }
                ul { line-height: 2; }
                .status { background: #16213e; padding: 15px; border-radius: 8px; margin: 15px 0; }
                .ok { color: #4ade80; }
                .warn { color: #fbbf24; }
            </style>
        </head>
        <body>
            <h1>🤖 Slack-Codecks Bot v4.0</h1>
            <p><strong>Dynamiczne mappingi - aliasy zamiast UUID!</strong></p>
            
            <div class="status">
                <h3>📊 Status Cache:</h3>
                <ul>
                    <li>Status: ${stats.initialized ? '<span class="ok">✅ Zainicjalizowany</span>' : '<span class="warn">⚠️ Nie zainicjalizowany</span>'}</li>
                    <li>📂 Spaces: ${stats.spaces}</li>
                    <li>🎴 Decks: ${stats.decks}</li>
                    <li>👥 Users: ${stats.users}</li>
                    <li>⏰ Ostatnie odświeżenie: ${stats.lastRefresh ? new Date(stats.lastRefresh).toLocaleString('pl-PL') : 'nigdy'}</li>
                </ul>
            </div>
            
            <h2>📋 Przeglądaj dane z cache:</h2>
            <ul>
                <li><a href="/list-spaces">📂 Lista Spaces</a></li>
                <li><a href="/list-decks">🎴 Lista Decków</a></li>
                <li><a href="/list-users">👥 Lista Użytkowników</a></li>
            </ul>
            
            <h2>🤖 Komendy Slack:</h2>
            <ul>
                <li><code>!help</code> - przykład użycia</li>
                <li><code>!commands</code> - lista komend</li>
                <li><code>!status</code> - status cache</li>
                <li><code>!refresh</code> - odśwież cache</li>
            </ul>
            
            <h2>📝 Format wiadomości:</h2>
            <pre>
[Create] [Deck: MT/Backlog]

Nazwa Taska (Tobiasz)
• Opis linia 1
• Opis linia 2
   • Wcięcie w tekście
• [ ] Checkbox

Drugi Task (Anna)
• Opis
            </pre>
            
            <h2>💡 Nowy system aliasów v4.0:</h2>
            <pre>
SPACE_MAPPING = {"MT": "MA TXA"}
DECK_MAPPING = {}       ← pusty = szuka po nazwie
USER_MAPPING = {}

[Deck: MT/Backlog] (Tobiasz)
→ MT → alias → "MA TXA" → cache → UUID space
→ Backlog → szuka w cache decks → UUID deck  
→ Tobiasz → szuka w cache users → UUID user
            </pre>
            
            <p><a href="/health">🔧 Health Check (JSON)</a></p>
        </body>
        </html>
    `);
});

// ============================================================
// START SERWERA
// ============================================================

async function startServer() {
    console.log('🚀 Uruchamianie Slack-Codecks Bot v4.0...');
    
    // Test połączenia z Codecks
    const connected = await codecksClient.testConnection();
    
    if (connected) {
        // Inicjalizacja cache przy starcie
        try {
            await mappingCache.initialize(codecksClient);
        } catch (error) {
            console.error('⚠️ Nie można zainicjalizować cache przy starcie:', error.message);
            console.log('   Cache będzie zainicjalizowany przy pierwszym użyciu');
        }
    } else {
        console.log('⚠️ Brak połączenia z Codecks - cache będzie zainicjalizowany później');
    }
    
    // Start serwera
    app.listen(PORT, () => {
        const stats = mappingCache.getStats();
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║      🚀 Slack → Codecks Bot v4.0 uruchomiony!                ║
╠══════════════════════════════════════════════════════════════╣
║  Port:            ${PORT}                                           ║
║  Slack Events:    /slack/events                              ║
║  Health Check:    /health                                    ║
╠══════════════════════════════════════════════════════════════╣
║  📊 Cache:                                                   ║
║     Spaces:       ${String(stats.spaces).padEnd(3)} │ Space aliases:  ${String(Object.keys(config.spaceMapping).length).padEnd(3)}       ║
║     Decks:        ${String(stats.decks).padEnd(3)} │ Deck aliases:   ${String(Object.keys(config.deckMapping).length).padEnd(3)}       ║
║     Users:        ${String(stats.users).padEnd(3)} │ User aliases:   ${String(Object.keys(config.userMapping).length).padEnd(3)}       ║
╠══════════════════════════════════════════════════════════════╣
║  💡 Mappingi to teraz ALIASY (skróty → pełne nazwy)          ║
║     Pusty mapping {} = szuka bezpośrednio po nazwie          ║
╚══════════════════════════════════════════════════════════════╝
        `);
    });
}

startServer();

module.exports = app;
