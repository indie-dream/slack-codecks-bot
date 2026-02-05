#!/usr/bin/env node

/**
 * Debug skrypt do testowania API Codecks
 * 
 * Użycie:
 *   node scripts/debug-api.js
 */

require('dotenv').config();
const { CodecksClient } = require('../src/codecks');

async function main() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║           🔍 DEBUG API CODECKS                               ║
╚══════════════════════════════════════════════════════════════╝
`);

    if (!process.env.CODECKS_TOKEN || !process.env.CODECKS_SUBDOMAIN) {
        console.log('❌ Brak CODECKS_TOKEN lub CODECKS_SUBDOMAIN w .env');
        return;
    }

    const client = new CodecksClient(
        process.env.CODECKS_TOKEN,
        process.env.CODECKS_SUBDOMAIN
    );

    await client.debugApi();
    
    // Dodatkowy test: pełne pobranie danych
    console.log('📊 Test pełnego pobrania danych:\n');
    
    try {
        console.log('Pobieram projects...');
        const projects = await client.listProjects();
        console.log(`✅ Projects: ${projects.length}`);
        if (projects.length > 0) {
            console.log('   Przykład:', projects[0]);
        }
    } catch (e) {
        console.log('❌ Projects error:', e.message);
    }
    
    try {
        console.log('\nPobieram decks...');
        const decks = await client.listDecksWithSpaces();
        console.log(`✅ Decks: ${decks.length}`);
        if (decks.length > 0) {
            console.log('   Przykład:', decks[0]);
        }
    } catch (e) {
        console.log('❌ Decks error:', e.message);
    }
    
    try {
        console.log('\nPobieram users...');
        const users = await client.listUsers();
        console.log(`✅ Users: ${users.length}`);
        if (users.length > 0) {
            console.log('   Przykład:', users[0]);
        }
    } catch (e) {
        console.log('❌ Users error:', e.message);
    }
}

main().catch(console.error);
