/**
 * Test suite dla Slack-Codecks Bot v4.0
 * Uruchom: node test/test.js
 */

const { parseTaskMessage, buildCardContent } = require('../src/parser');
const { MappingCache } = require('../src/cache');

console.log('🧪 Uruchamianie testów Slack-Codecks Bot v4.0\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (error) {
        console.log(`❌ ${name}`);
        console.log(`   Error: ${error.message}`);
        failed++;
    }
}

function assertEqual(actual, expected, message = '') {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${message}\n   Expected: ${JSON.stringify(expected)}\n   Actual: ${JSON.stringify(actual)}`);
    }
}

// ============================================================
// PARSER TESTS
// ============================================================

console.log('📝 Parser Tests:\n');

test('Parser: podstawowa wiadomość z [Create]', () => {
    const message = '[Create] Test Task (Tobiasz)\n• Opis 1\n• Opis 2';
    const result = parseTaskMessage(message);
    
    assertEqual(result.tasks.length, 1, 'Powinien być 1 task');
    assertEqual(result.tasks[0].title, 'Test Task', 'Tytuł');
    assertEqual(result.tasks[0].assigneeName, 'Tobiasz', 'Assignee name');
    assertEqual(result.tasks[0].description.length, 2, 'Opis');
});

test('Parser: wiadomość bez [Create]', () => {
    const message = 'Zwykła wiadomość bez Create';
    const result = parseTaskMessage(message);
    
    assertEqual(result.tasks.length, 0, 'Nie powinno być tasków');
});

test('Parser: deck path extraction', () => {
    const message = '[Create] [Deck: MT/Backlog] Task';
    const result = parseTaskMessage(message);
    
    assertEqual(result.deckPath, 'MT/Backlog', 'Deck path');
    assertEqual(result.tasks[0].title, 'Task', 'Tytuł');
});

test('Parser: wiele tasków', () => {
    const message = `[Create] [Deck: Backlog]

Task 1 (Owner1)
• Opis 1

Task 2 (Owner2)
• Opis 2`;
    
    const result = parseTaskMessage(message);
    
    assertEqual(result.tasks.length, 2, 'Powinny być 2 taski');
    assertEqual(result.tasks[0].title, 'Task 1', 'Tytuł task 1');
    assertEqual(result.tasks[1].title, 'Task 2', 'Tytuł task 2');
});

test('Parser: checkboxy', () => {
    const message = `[Create] Task
• Opis
• [ ] Checkbox 1
• [x] Checkbox 2 (zaznaczony)
• [] Checkbox 3`;
    
    const result = parseTaskMessage(message);
    
    assertEqual(result.tasks[0].checkboxes.length, 3, '3 checkboxy');
    assertEqual(result.tasks[0].checkboxes[0].checked, false, 'Checkbox 1 niezaznaczony');
    assertEqual(result.tasks[0].checkboxes[1].checked, true, 'Checkbox 2 zaznaczony');
});

test('Parser: wcięte bullet points', () => {
    const message = `[Create] Task
• Normalny opis
   • Wcięty opis`;
    
    const result = parseTaskMessage(message);
    
    assertEqual(result.tasks[0].description.length, 2, '2 linie opisu');
    assertEqual(result.tasks[0].description[1].includes('•'), true, 'Wcięcie zachowane');
});

// ============================================================
// CACHE TESTS
// ============================================================

console.log('\n💾 Cache Tests:\n');

test('Cache: normalize string', () => {
    const cache = new MappingCache();
    
    assertEqual(cache.normalize('MA TXA'), 'ma txa', 'Lowercase');
    assertEqual(cache.normalize('Zażółć'), 'zazolc', 'Polish chars');
    assertEqual(cache.normalize('  Spacje  '), 'spacje', 'Trim');
});

test('Cache: resolve alias', () => {
    const cache = new MappingCache();
    
    const aliasMapping = {
        'MT': 'MA TXA',
        'BL': 'Backlog'
    };
    
    assertEqual(cache.resolveAlias('MT', aliasMapping), 'MA TXA', 'Alias MT');
    assertEqual(cache.resolveAlias('Unknown', aliasMapping), 'Unknown', 'Brak aliasu');
    assertEqual(cache.resolveAlias('mt', aliasMapping), 'MA TXA', 'Case insensitive');
});

test('Cache: mock space resolution', () => {
    const cache = new MappingCache();
    
    // Symulacja załadowanego cache
    cache.spaces.set('ma txa', 'uuid-space-1');
    cache.spaceNames.set('uuid-space-1', 'MA TXA');
    
    const result = cache.resolveSpace('MA TXA', {});
    assertEqual(result, 'uuid-space-1', 'Bezpośrednie szukanie');
    
    const result2 = cache.resolveSpace('MT', { 'MT': 'MA TXA' });
    assertEqual(result2, 'uuid-space-1', 'Przez alias');
});

test('Cache: mock deck resolution with path', () => {
    const cache = new MappingCache();
    
    // Symulacja załadowanego cache
    cache.spaces.set('ma txa', 'uuid-space-1');
    cache.spaceNames.set('uuid-space-1', 'MA TXA');
    
    cache.decks.set('backlog', { id: 'uuid-deck-1', spaceId: 'uuid-space-1', spaceName: 'MA TXA' });
    cache.deckNames.set('uuid-deck-1', 'Backlog');
    cache.deckPaths.set('ma txa/backlog', 'uuid-deck-1');
    
    // Test pełnej ścieżki
    const result = cache.resolveDeck('MA TXA/Backlog', {}, {});
    assertEqual(result, 'uuid-deck-1', 'Pełna ścieżka');
    
    // Test z aliasem space
    const result2 = cache.resolveDeck('MT/Backlog', {}, { 'MT': 'MA TXA' });
    assertEqual(result2, 'uuid-deck-1', 'Z aliasem space');
    
    // Test samej nazwy
    const result3 = cache.resolveDeck('Backlog', {}, {});
    assertEqual(result3, 'uuid-deck-1', 'Sama nazwa');
});

test('Cache: mock user resolution', () => {
    const cache = new MappingCache();
    
    // Symulacja załadowanego cache
    cache.users.set('tobiasz', 'uuid-user-1');
    cache.users.set('tobiasz nowak', 'uuid-user-1');
    cache.userNames.set('uuid-user-1', 'Tobiasz Nowak');
    
    const result = cache.resolveUser('Tobiasz', {});
    assertEqual(result, 'uuid-user-1', 'Bezpośrednie szukanie');
    
    const result2 = cache.resolveUser('TB', { 'TB': 'Tobiasz' });
    assertEqual(result2, 'uuid-user-1', 'Przez alias');
});

test('Cache: getStats', () => {
    const cache = new MappingCache();
    cache.spaces.set('test', 'id1');
    cache.decks.set('test', { id: 'id2' });
    cache.users.set('test', 'id3');
    
    const stats = cache.getStats();
    
    assertEqual(stats.spaces, 1, 'Spaces count');
    assertEqual(stats.decks, 1, 'Decks count');
    assertEqual(stats.users, 1, 'Users count');
    assertEqual(stats.initialized, false, 'Not initialized');
});

// ============================================================
// CARD CONTENT BUILDER TESTS
// ============================================================

console.log('\n📄 Card Content Builder Tests:\n');

test('buildCardContent: podstawowy task', () => {
    const task = {
        title: 'Test Task',
        description: ['Opis 1', 'Opis 2'],
        checkboxes: []
    };
    
    const content = buildCardContent(task);
    
    assertEqual(content.includes('Test Task'), true, 'Tytuł');
    assertEqual(content.includes('Opis 1'), true, 'Opis 1');
    assertEqual(content.includes('Opis 2'), true, 'Opis 2');
});

test('buildCardContent: z checkboxami', () => {
    const task = {
        title: 'Task',
        description: [],
        checkboxes: [
            { text: 'Do zrobienia', checked: false },
            { text: 'Zrobione', checked: true }
        ]
    };
    
    const content = buildCardContent(task);
    
    assertEqual(content.includes('- [ ] Do zrobienia'), true, 'Niezaznaczony checkbox');
    assertEqual(content.includes('- [x] Zrobione'), true, 'Zaznaczony checkbox');
});

// ============================================================
// INTEGRATION TESTS (symulacja pełnego flow)
// ============================================================

console.log('\n🔄 Integration Tests:\n');

test('Full flow: MT/Backlog (Tobiasz)', () => {
    // Symulacja wiadomości Slack
    const message = `[Create] [Deck: MT/Backlog]

Implement login feature (Tobiasz)
• Use OAuth2
• Add remember me option
   • Store token securely
• [ ] Write tests
• [ ] Update docs`;

    // Parse
    const { tasks, deckPath } = parseTaskMessage(message);
    
    assertEqual(deckPath, 'MT/Backlog', 'Deck path extracted');
    assertEqual(tasks.length, 1, 'One task');
    assertEqual(tasks[0].title, 'Implement login feature', 'Title');
    assertEqual(tasks[0].assigneeName, 'Tobiasz', 'Assignee');
    assertEqual(tasks[0].description.length, 3, 'Description lines');
    assertEqual(tasks[0].checkboxes.length, 2, 'Checkboxes');
    
    // Mock cache resolution
    const cache = new MappingCache();
    cache.spaces.set('ma txa', 'space-uuid');
    cache.spaceNames.set('space-uuid', 'MA TXA');
    cache.deckPaths.set('ma txa/backlog', 'deck-uuid');
    cache.users.set('tobiasz', 'user-uuid');
    
    const spaceMapping = { 'MT': 'MA TXA' };
    const deckMapping = {};
    const userMapping = {};
    
    const deckId = cache.resolveDeck(deckPath, deckMapping, spaceMapping);
    const userId = cache.resolveUser(tasks[0].assigneeName, userMapping);
    
    assertEqual(deckId, 'deck-uuid', 'Deck resolved');
    assertEqual(userId, 'user-uuid', 'User resolved');
});

// ============================================================
// SUMMARY
// ============================================================

console.log('\n' + '='.repeat(50));
console.log(`📊 Wyniki: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
    process.exit(1);
}
