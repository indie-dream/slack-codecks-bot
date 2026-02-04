/**
 * Slack → Codecks Integration Bot
 * Główny serwer aplikacji
 */

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { WebClient } = require('@slack/web-api');
const { parseTaskMessage } = require('./parser');
const { CodecksClient } = require('./codecks');
const configFile = require('../config.json');

// Merge config: environment variables override config.json
const config = {
    ...configFile,
    defaultDeckId: process.env.DEFAULT_DECK_ID || configFile.defaultDeckId,
    allowedChannels: process.env.ALLOWED_CHANNELS 
        ? process.env.ALLOWED_CHANNELS.split(',') 
        : configFile.allowedChannels,
    userMapping: process.env.USER_MAPPING 
        ? JSON.parse(process.env.USER_MAPPING) 
        : configFile.userMapping
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
    
    console.log('📨 Nowa wiadomość:', event.text);
    
    // Parsowanie
    const tasks = parseTaskMessage(event.text, config.userMapping);
    
    if (tasks.length === 0) {
        console.log('ℹ️ Brak tasków w wiadomości');
        return;
    }
    
    console.log(`📋 Znaleziono ${tasks.length} task(ów)`);
    
    // Tworzenie kart
    const results = await createCardsInCodecks(tasks);
    
    // Reakcja
    await addReaction(event.channel, event.ts, results);
}

/**
 * Tworzy karty w Codecks
 */
async function createCardsInCodecks(tasks) {
    const results = { success: [], failed: [] };
    
    for (const task of tasks) {
        try {
            const cardData = {
                content: task.title,
                deckId: config.defaultDeckId,
                assigneeId: task.assigneeId || null,
                priority: config.defaultPriority || 'b',
                putOnHand: task.assigneeId ? true : false
            };
            
            const card = await codecksClient.createCard(cardData);
            
            results.success.push({
                title: task.title,
                assignee: task.assigneeName,
                cardId: card.id
            });
            
            console.log(`✅ Karta: "${task.title}" → ${task.assigneeName || 'nieprzypisana'}`);
            
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

/**
 * 🆕 Endpoint do listowania decków z Codecks (z UUID!)
 */
app.get('/list-decks', async (req, res) => {
    try {
        console.log('📋 Pobieranie listy decków z Codecks...');
        
        const decks = await codecksClient.listDecks();
        
        // HTML response dla łatwego czytania
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
        .uuid { font-family: monospace; background: #2d2d4a; padding: 4px 8px; border-radius: 4px; }
        .copy-btn { background: #00d9ff; color: #000; border: none; padding: 6px 12px; cursor: pointer; border-radius: 4px; margin-left: 8px; }
        .copy-btn:hover { background: #00b8d4; }
        .info { background: #16213e; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
    </style>
</head>
<body>
    <h1>🎴 Codecks Decks</h1>
    <div class="info">
        <strong>Subdomain:</strong> ${process.env.CODECKS_SUBDOMAIN}<br>
        <strong>Znaleziono:</strong> ${decks.length} deck(ów)
    </div>
    <table>
        <tr>
            <th>Nazwa</th>
            <th>UUID (skopiuj do DEFAULT_DECK_ID)</th>
            <th>Slug (z URL)</th>
        </tr>`;
        
        for (const deck of decks) {
            html += `
        <tr>
            <td><strong>${deck.title || deck.name || 'Bez nazwy'}</strong></td>
            <td>
                <span class="uuid">${deck.id}</span>
                <button class="copy-btn" onclick="navigator.clipboard.writeText('${deck.id}')">📋 Kopiuj</button>
            </td>
            <td>${deck.slug || '-'}</td>
        </tr>`;
        }
        
        html += `
    </table>
    <br>
    <p>👆 Skopiuj UUID decka i wklej do Render → Environment → <code>DEFAULT_DECK_ID</code></p>
</body>
</html>`;
        
        res.send(html);
        
    } catch (error) {
        console.error('❌ Błąd pobierania decków:', error.message);
        res.status(500).send(`
            <h1>❌ Błąd</h1>
            <p>${error.message}</p>
            <p>Sprawdź czy CODECKS_TOKEN i CODECKS_SUBDOMAIN są poprawne w Render.</p>
        `);
    }
});

/**
 * 🆕 Endpoint do listowania użytkowników z Codecks (do userMapping)
 */
app.get('/list-users', async (req, res) => {
    try {
        console.log('👥 Pobieranie listy użytkowników z Codecks...');
        
        const users = await codecksClient.listUsers();
        
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
        .uuid { font-family: monospace; background: #2d2d4a; padding: 4px 8px; border-radius: 4px; }
        code { background: #2d2d4a; padding: 10px; display: block; margin: 20px 0; border-radius: 4px; white-space: pre; }
    </style>
</head>
<body>
    <h1>👥 Codecks Users</h1>
    <p>Znaleziono: ${users.length} użytkownik(ów)</p>
    <table>
        <tr>
            <th>Nazwa</th>
            <th>UUID</th>
            <th>Email</th>
        </tr>`;
        
        for (const user of users) {
            html += `
        <tr>
            <td><strong>${user.displayName || user.username || 'Bez nazwy'}</strong></td>
            <td><span class="uuid">${user.id}</span></td>
            <td>${user.email || '-'}</td>
        </tr>`;
        }
        
        // Generuj gotowy userMapping
        let mappingJson = {};
        for (const user of users) {
            const name = user.displayName || user.username;
            if (name) {
                mappingJson[name.toLowerCase()] = user.id;
            }
        }
        
        html += `
    </table>
    <h2>📋 Gotowy userMapping (do Render):</h2>
    <code>${JSON.stringify(mappingJson, null, 2)}</code>
    <p>Skopiuj powyższy JSON i wklej do Render → Environment → <code>USER_MAPPING</code></p>
</body>
</html>`;
        
        res.send(html);
        
    } catch (error) {
        console.error('❌ Błąd pobierania użytkowników:', error.message);
        res.status(500).send(`<h1>❌ Błąd</h1><p>${error.message}</p>`);
    }
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        defaultDeckId: config.defaultDeckId
    });
});

/**
 * Główna strona
 */
app.get('/', (req, res) => {
    res.send(`
        <h1>🤖 Slack-Codecks Bot</h1>
        <ul>
            <li><a href="/health">Health Check</a></li>
            <li><a href="/list-decks">📋 Lista Decków (UUID)</a></li>
            <li><a href="/list-users">👥 Lista Użytkowników</a></li>
        </ul>
    `);
});

// Start
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║        🚀 Slack → Codecks Bot uruchomiony!               ║
╠══════════════════════════════════════════════════════════╣
║  Port:           ${PORT}                                        ║
║  Slack Events:   /slack/events                           ║
║  Health Check:   /health                                 ║
║  Default Deck:   ${(config.defaultDeckId || 'nie ustawiono').substring(0, 36).padEnd(36)}  ║
╚══════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
