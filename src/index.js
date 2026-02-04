/**
 * Slack → Codecks Integration Bot v2.0
 * Obsługuje wielopoziomowe taski z description i checkboxami
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
    
    const messageText = event.text || '';
    console.log('📨 Nowa wiadomość:', messageText.substring(0, 100));
    
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
    
    // Parsowanie
    const tasks = parseTaskMessage(messageText, config.userMapping);
    
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
 * Obsługuje komendy !help i !commands
 */
async function handleCommand(channel, timestamp, message) {
    const response = getCommandResponse(message);
    
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
 * Tworzy karty w Codecks
 */
async function createCardsInCodecks(tasks) {
    const results = { success: [], failed: [] };
    
    for (const task of tasks) {
        try {
            // Buduj pełny content (tytuł + opis + checkboxy)
            const fullContent = buildCardContent(task);
            
            const cardData = {
                content: fullContent,
                deckId: config.defaultDeckId,
                assigneeId: task.assigneeId || null,
                priority: config.defaultPriority || 'b',
                putOnHand: task.assigneeId ? true : false
            };
            
            const card = await codecksClient.createCard(cardData);
            
            results.success.push({
                title: task.title,
                assignee: task.assigneeName,
                cardId: card.id,
                hasDescription: task.description.length > 0,
                checkboxCount: task.checkboxes.length
            });
            
            console.log(`✅ Karta: "${task.title}" → ${task.assigneeName || 'nieprzypisana'} (${task.description.length} opis, ${task.checkboxes.length} checkbox)`);
            
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
 * Health check
 */
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        version: '2.0',
        timestamp: new Date().toISOString(),
        defaultDeckId: config.defaultDeckId
    });
});

/**
 * Główna strona
 */
app.get('/', (req, res) => {
    res.send(`
        <h1>🤖 Slack-Codecks Bot v2.0</h1>
        <p>Bot obsługuje wielopoziomowe taski z description i checkboxami!</p>
        <h2>Komendy:</h2>
        <ul>
            <li><code>!help</code> - przykład użycia</li>
            <li><code>!commands</code> - lista komend</li>
        </ul>
        <h2>Format:</h2>
        <pre>
[Create]
• Nazwa taska (Owner)
   • Opis linijka
      • [ ] Checkbox
        </pre>
        <p><a href="/health">Health Check</a></p>
    `);
});

// Start
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║      🚀 Slack → Codecks Bot v2.0 uruchomiony!            ║
╠══════════════════════════════════════════════════════════╣
║  Port:           ${PORT}                                        ║
║  Slack Events:   /slack/events                           ║
║  Health Check:   /health                                 ║
║  Komendy:        !help, !commands                        ║
╚══════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
