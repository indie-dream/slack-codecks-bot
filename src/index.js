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

// Łączymy config.json z environment variables (ENV ma priorytet)
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

// Slack Web Client (do wysyłania reakcji/wiadomości)
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

// Codecks Client
const codecksClient = new CodecksClient(
    process.env.CODECKS_TOKEN,
    process.env.CODECKS_SUBDOMAIN
);

// Set do deduplikacji eventów (Slack może wysyłać retry)
const processedEvents = new Set();

// Middleware do weryfikacji podpisu Slack
app.use('/slack/events', express.raw({ type: 'application/json' }));

/**
 * Weryfikuje podpis requestu od Slack
 */
function verifySlackSignature(req) {
    const timestamp = req.headers['x-slack-request-timestamp'];
    const signature = req.headers['x-slack-signature'];
    
    // Ochrona przed replay attacks (request starszy niż 5 min)
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
    if (timestamp < fiveMinutesAgo) {
        return false;
    }
    
    const sigBasestring = `v0:${timestamp}:${req.body}`;
    const mySignature = 'v0=' + crypto
        .createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
        .update(sigBasestring)
        .digest('hex');
    
    return crypto.timingSafeEqual(
        Buffer.from(mySignature),
        Buffer.from(signature)
    );
}

/**
 * Główny endpoint dla Slack Events API
 */
app.post('/slack/events', async (req, res) => {
    // Weryfikacja podpisu
    if (!verifySlackSignature(req)) {
        console.error('❌ Nieprawidłowy podpis Slack');
        return res.status(401).send('Unauthorized');
    }
    
    const payload = JSON.parse(req.body);
    
    // URL Verification Challenge (jednorazowo przy konfiguracji)
    if (payload.type === 'url_verification') {
        console.log('✅ URL Verification challenge');
        return res.json({ challenge: payload.challenge });
    }
    
    // Natychmiast odpowiadamy 200 OK (Slack wymaga odpowiedzi w 3s)
    res.status(200).send('OK');
    
    // Przetwarzanie eventu asynchronicznie
    if (payload.type === 'event_callback') {
        await handleEvent(payload.event);
    }
});

/**
 * Obsługa eventu wiadomości
 */
async function handleEvent(event) {
    // Filtrujemy tylko wiadomości (nie edycje, nie boty)
    if (event.type !== 'message' || event.subtype || event.bot_id) {
        return;
    }
    
    // Deduplikacja (event_id + timestamp jako klucz)
    const eventKey = `${event.client_msg_id || event.ts}`;
    if (processedEvents.has(eventKey)) {
        console.log('⏭️ Event już przetworzony:', eventKey);
        return;
    }
    processedEvents.add(eventKey);
    
    // Czyszczenie starych eventów (po 10 minutach)
    setTimeout(() => processedEvents.delete(eventKey), 10 * 60 * 1000);
    
    // Sprawdzenie czy kanał jest na liście dozwolonych
    if (config.allowedChannels && config.allowedChannels.length > 0) {
        if (!config.allowedChannels.includes(event.channel)) {
            return;
        }
    }
    
    console.log('📨 Nowa wiadomość:', event.text);
    
    // Parsowanie wiadomości na taski
    const tasks = parseTaskMessage(event.text, config.userMapping);
    
    if (tasks.length === 0) {
        console.log('ℹ️ Brak tasków w wiadomości');
        return;
    }
    
    console.log(`📋 Znaleziono ${tasks.length} task(ów)`);
    
    // Tworzenie kart w Codecks
    const results = await createCardsInCodecks(tasks);
    
    // Reakcja na wiadomość
    await addReaction(event.channel, event.ts, results);
}

/**
 * Tworzy karty w Codecks
 */
async function createCardsInCodecks(tasks) {
    const results = {
        success: [],
        failed: []
    };
    
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
            
            console.log(`✅ Utworzono kartę: "${task.title}" → ${task.assigneeName || 'nieprzypisana'}`);
            
        } catch (error) {
            results.failed.push({
                title: task.title,
                error: error.message
            });
            console.error(`❌ Błąd tworzenia karty "${task.title}":`, error.message);
        }
    }
    
    return results;
}

/**
 * Dodaje reakcję emoji do wiadomości
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
        
        // Opcjonalnie: odpowiedź w wątku z podsumowaniem
        if (config.sendSummaryReply) {
            const summaryLines = [
                `📋 *Utworzono ${results.success.length} task(ów)*`
            ];
            
            results.success.forEach(task => {
                const assignee = task.assignee ? `👤 ${task.assignee}` : '👤 _nieprzypisany_';
                summaryLines.push(`• ${task.title} → ${assignee}`);
            });
            
            if (results.failed.length > 0) {
                summaryLines.push(`\n⚠️ *Błędy (${results.failed.length}):*`);
                results.failed.forEach(task => {
                    summaryLines.push(`• ${task.title}: ${task.error}`);
                });
            }
            
            await slackClient.chat.postMessage({
                channel: channel,
                thread_ts: timestamp,
                text: summaryLines.join('\n')
            });
        }
        
    } catch (error) {
        console.error('Błąd dodawania reakcji:', error.message);
    }
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

/**
 * Endpoint do testowania parsera (dev only)
 */
app.post('/test/parse', express.json(), (req, res) => {
    const { message } = req.body;
    const tasks = parseTaskMessage(message, config.userMapping);
    res.json({ tasks });
});

// Start serwera
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║          🚀 Slack → Codecks Bot uruchomiony!                 ║
╠══════════════════════════════════════════════════════════════╣
║  Port:           ${PORT.toString().padEnd(42)}║
║  Slack Events:   /slack/events                               ║
║  Health Check:   /health                                     ║
║  Default Deck:   ${(config.defaultDeckId || 'nie ustawiono').padEnd(42)}║
╚══════════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
