/**
 * Parser wiadomości Slack
 * Wyodrębnia taski na podstawie separatora "-" i przypisań "(Imię Nazwisko)"
 */

/**
 * Parsuje wiadomość Slack i wyodrębnia listę tasków
 * 
 * @param {string} message - Treść wiadomości
 * @param {Object} userMapping - Mapowanie imion na ID użytkowników Codecks
 * @returns {Array} Lista tasków
 * 
 * @example
 * const tasks = parseTaskMessage(
 *   "- Stwórz system walki (Janek X)\n- Napraw bug",
 *   { "janek x": "user_123" }
 * );
 * // Zwraca:
 * // [
 * //   { title: "Stwórz system walki", assigneeId: "user_123", assigneeName: "Janek X" },
 * //   { title: "Napraw bug", assigneeId: null, assigneeName: null }
 * // ]
 */
function parseTaskMessage(message, userMapping = {}) {
    if (!message || typeof message !== 'string') {
        return [];
    }
    
    const tasks = [];
    const lines = message.split('\n');
    
    // Regex do wyodrębnienia przypisania osoby: (Imię Nazwisko) lub (Imię N)
    const assigneeRegex = /\(([^)]+)\)\s*$/;
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Sprawdzamy czy linia zaczyna się od "-" (separator tasków)
        if (!trimmedLine.startsWith('-')) {
            continue;
        }
        
        // Usuwamy separator i białe znaki
        let taskContent = trimmedLine.slice(1).trim();
        
        // Pomijamy puste taski
        if (!taskContent) {
            continue;
        }
        
        // Wyodrębniamy osobę przypisaną (jeśli istnieje)
        let assigneeId = null;
        let assigneeName = null;
        
        const assigneeMatch = taskContent.match(assigneeRegex);
        
        if (assigneeMatch) {
            const rawName = assigneeMatch[1].trim();
            assigneeName = rawName;
            
            // Szukamy w mapowaniu (case-insensitive)
            const normalizedName = normalizeString(rawName);
            
            for (const [key, userId] of Object.entries(userMapping)) {
                if (normalizeString(key) === normalizedName) {
                    assigneeId = userId;
                    break;
                }
            }
            
            // Usuwamy przypisanie z tytułu
            taskContent = taskContent.replace(assigneeRegex, '').trim();
        }
        
        tasks.push({
            title: taskContent,
            assigneeId: assigneeId,
            assigneeName: assigneeName,
            rawLine: trimmedLine
        });
    }
    
    return tasks;
}

/**
 * Normalizuje string do porównywania (lowercase, bez polskich znaków)
 * 
 * @param {string} str - String do normalizacji
 * @returns {string} Znormalizowany string
 */
function normalizeString(str) {
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Usuwa akcenty
        .replace(/ł/g, 'l')
        .replace(/Ł/g, 'L')
        .trim();
}

/**
 * Sprawdza czy wiadomość zawiera jakiekolwiek taski
 * 
 * @param {string} message - Treść wiadomości
 * @returns {boolean}
 */
function hasTasksInMessage(message) {
    if (!message || typeof message !== 'string') {
        return false;
    }
    
    const lines = message.split('\n');
    return lines.some(line => line.trim().startsWith('-'));
}

/**
 * Wyodrębnia tylko tytuły tasków (bez parsowania assignee)
 * 
 * @param {string} message - Treść wiadomości
 * @returns {Array<string>} Lista tytułów
 */
function extractTaskTitles(message) {
    const tasks = parseTaskMessage(message, {});
    return tasks.map(task => task.title);
}

/**
 * Formatuje task do wyświetlenia
 * 
 * @param {Object} task - Obiekt taska
 * @returns {string}
 */
function formatTaskForDisplay(task) {
    const assignee = task.assigneeName 
        ? `→ ${task.assigneeName}` 
        : '→ nieprzypisany';
    
    return `• ${task.title} ${assignee}`;
}

/**
 * Waliduje konfigurację mapowania użytkowników
 * 
 * @param {Object} userMapping - Mapowanie do walidacji
 * @returns {Object} Wynik walidacji { valid: boolean, errors: string[] }
 */
function validateUserMapping(userMapping) {
    const errors = [];
    
    if (!userMapping || typeof userMapping !== 'object') {
        return { valid: false, errors: ['userMapping musi być obiektem'] };
    }
    
    for (const [name, userId] of Object.entries(userMapping)) {
        if (typeof name !== 'string' || name.trim() === '') {
            errors.push(`Nieprawidłowa nazwa użytkownika: "${name}"`);
        }
        if (typeof userId !== 'string' || userId.trim() === '') {
            errors.push(`Nieprawidłowy userId dla "${name}"`);
        }
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

// === TESTY ===

/**
 * Uruchamia testy parsera (do celów debugowania)
 */
function runParserTests() {
    console.log('🧪 Uruchamianie testów parsera...\n');
    
    const userMapping = {
        'janek x': 'user_001',
        'janek': 'user_001',
        'paweł m': 'user_002',
        'pawel m': 'user_002',
        'anna kowalska': 'user_003'
    };
    
    const testCases = [
        {
            name: 'Podstawowy task z osobą',
            input: '- Stwórz system walki (Janek X)',
            expected: 1
        },
        {
            name: 'Task bez osoby',
            input: '- Napraw bug z kolizjami',
            expected: 1
        },
        {
            name: 'Wiele tasków',
            input: `- Task 1 (Janek X)
- Task 2 (Paweł M)
- Task 3`,
            expected: 3
        },
        {
            name: 'Linie bez separatora (ignorowane)',
            input: `To jest komentarz
- To jest task
Kolejny komentarz`,
            expected: 1
        },
        {
            name: 'Pusta wiadomość',
            input: '',
            expected: 0
        },
        {
            name: 'Polskie znaki w nazwisku',
            input: '- Przygotuj assets (Paweł M)',
            expected: 1
        },
        {
            name: 'Nieznany użytkownik',
            input: '- Task (Nieznany User)',
            expected: 1
        }
    ];
    
    let passed = 0;
    let failed = 0;
    
    for (const test of testCases) {
        const result = parseTaskMessage(test.input, userMapping);
        const success = result.length === test.expected;
        
        if (success) {
            console.log(`✅ ${test.name}`);
            passed++;
        } else {
            console.log(`❌ ${test.name}`);
            console.log(`   Oczekiwano: ${test.expected}, Otrzymano: ${result.length}`);
            console.log(`   Wynik:`, result);
            failed++;
        }
    }
    
    console.log(`\n📊 Wyniki: ${passed}/${passed + failed} testów zaliczonych`);
    
    return { passed, failed };
}

// Eksport funkcji
module.exports = {
    parseTaskMessage,
    hasTasksInMessage,
    extractTaskTitles,
    formatTaskForDisplay,
    validateUserMapping,
    normalizeString,
    runParserTests
};

// Uruchom testy jeśli plik wykonywany bezpośrednio
if (require.main === module) {
    runParserTests();
}
