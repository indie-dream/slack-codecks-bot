/**
 * Parser wiadomości Slack v5.0
 * 
 * JEDYNY FORMAT (bullet-as-title):
 * 
 * [Create] [Deck: Space/Deck]
 * • Nazwa Taska (Owner)
 *    • Opis linia 1
 *    • [ ] Checkbox
 *       • To dodaje "- " w Codecks description
 *       • [ ] Checkbox z głębszego poziomu też działa
 * • Następny Task (Owner2)
 *    • Opis
 * 
 * WIELE BLOKÓW:
 * [Create] [Deck: Art]
 * • Task graficzny
 * 
 * [Create] [Deck: Code]  
 * • Task programistyczny
 * 
 * POZIOMY WCIĘĆ:
 *   Poziom 0 (bullet bez wcięcia)     → Nowy task (tytuł)
 *   Poziom 1 (1x wcięcie)             → Opis / checkbox
 *   Poziom 2+ (2x+ wcięcie)           → "- tekst" w opisie / checkbox
 */

// Wszystkie znaki bullet jakie Slack może wysłać
const BULLET_CHARS = '•◦\\-\\*‣●○▪▸';
const bulletRegex = new RegExp(`^(\\s*)([${BULLET_CHARS}])\\s+(.*)$`);
const assigneeRegex = /\(([^)]+)\)\s*$/;
const checkboxRegex = /^\[([xX\s]?)\]\s*(.*)$/;

/**
 * Określa poziom wcięcia bulleta.
 * Slack jest nieprzewidywalny z whitespace, więc normalizujemy:
 *   0-1 spacji  → poziom 0 (tytuł taska)
 *   2-4 spacji  → poziom 1 (opis)
 *   5+ spacji   → poziom 2 (sub-bullet, "- " w opisie)
 */
function getIndentLevel(indentLength) {
    if (indentLength <= 1) return 0;
    if (indentLength <= 4) return 1;
    return 2;
}

/**
 * Główna funkcja parsująca - zwraca tablicę bloków
 */
function parseTaskMessage(message) {
    if (!message || typeof message !== 'string') {
        return { tasks: [], deckPath: null, blocks: [] };
    }
    
    if (!message.includes('[Create]')) {
        return { tasks: [], deckPath: null, blocks: [] };
    }
    
    // Podziel na bloki [Create]
    const blocks = splitIntoCreateBlocks(message);
    
    const allTasks = [];
    let firstDeckPath = null;
    
    for (const block of blocks) {
        const { tasks, deckPath } = parseCreateBlock(block);
        
        if (firstDeckPath === null && deckPath) {
            firstDeckPath = deckPath;
        }
        
        for (const task of tasks) {
            task.deckPath = deckPath;
            allTasks.push(task);
        }
    }
    
    return { 
        tasks: allTasks, 
        deckPath: firstDeckPath,
        blocks: blocks.map(b => parseCreateBlock(b))
    };
}

/**
 * Dzieli wiadomość na bloki [Create]
 */
function splitIntoCreateBlocks(message) {
    const blocks = [];
    const lines = message.split('\n');
    
    let currentBlock = [];
    let inBlock = false;
    
    for (const line of lines) {
        if (line.includes('[Create]')) {
            if (currentBlock.length > 0) {
                blocks.push(currentBlock.join('\n'));
            }
            currentBlock = [line];
            inBlock = true;
        } else if (inBlock) {
            currentBlock.push(line);
        }
    }
    
    if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
    }
    
    return blocks;
}

/**
 * Parsuje pojedynczy blok [Create]
 * Tylko format bullet-as-title.
 */
function parseCreateBlock(blockText) {
    const lines = blockText.split('\n');
    
    // Wyodrębnij deck path
    let deckPath = null;
    const deckMatch = blockText.match(/\[Deck:\s*([^\]]+)\]/i);
    if (deckMatch) {
        deckPath = deckMatch[1].trim();
    }
    
    const tasks = [];
    let currentTask = null;
    
    // Parsuj linie (pomijamy pierwszą - to linia [Create])
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        
        if (trimmed === '') continue;
        
        const bulletMatch = line.match(bulletRegex);
        
        if (!bulletMatch) {
            // Linia bez bulleta - ignoruj (meta linie, śmieci)
            console.log(`⚠️ Parser: ignoruję linię bez bulleta: "${trimmed}"`);
            continue;
        }
        
        const indent = bulletMatch[1].length;
        const content = bulletMatch[3].trim();
        const level = getIndentLevel(indent);
        
        if (level === 0) {
            // ═══════════════════════════════════════
            // POZIOM 0: Nowy task (tytuł)
            // ═══════════════════════════════════════
            
            // Zapisz poprzedni task
            if (currentTask) {
                tasks.push(currentTask);
            }
            
            let titleText = content;
            let assigneeName = null;
            
            // Wyciągnij (Owner) z końca
            const aMatch = titleText.match(assigneeRegex);
            if (aMatch) {
                assigneeName = aMatch[1].trim();
                titleText = titleText.replace(assigneeRegex, '').trim();
            }
            
            currentTask = {
                title: titleText,
                assigneeName: assigneeName,
                description: [],
                checkboxes: []
            };
            
        } else if (level === 1 && currentTask) {
            // ═══════════════════════════════════════
            // POZIOM 1: Opis lub checkbox
            // ═══════════════════════════════════════
            
            const cbMatch = content.match(checkboxRegex);
            if (cbMatch) {
                currentTask.checkboxes.push({
                    text: cbMatch[2].trim(),
                    checked: cbMatch[1].toLowerCase() === 'x'
                });
            } else {
                currentTask.description.push(content);
            }
            
        } else if (level >= 2 && currentTask) {
            // ═══════════════════════════════════════
            // POZIOM 2+: "- tekst" w opisie lub checkbox
            // ═══════════════════════════════════════
            
            const cbMatch = content.match(checkboxRegex);
            if (cbMatch) {
                currentTask.checkboxes.push({
                    text: cbMatch[2].trim(),
                    checked: cbMatch[1].toLowerCase() === 'x'
                });
            } else {
                currentTask.description.push('- ' + content);
            }
        }
    }
    
    // Dodaj ostatni task
    if (currentTask) {
        tasks.push(currentTask);
    }
    
    return { tasks, deckPath };
}

/**
 * Buduje content karty dla Codecks
 */
function buildCardContent(task) {
    let content = '';
    
    // Description
    if (task.description && task.description.length > 0) {
        content += task.description.join('\n');
    }
    
    // Checkboxy
    if (task.checkboxes && task.checkboxes.length > 0) {
        if (content) content += '\n';
        for (const checkbox of task.checkboxes) {
            const mark = checkbox.checked ? 'x' : ' ';
            content += `\n- [${mark}] ${checkbox.text}`;
        }
    }
    
    return content;
}

/**
 * Normalizuje string do porównywania
 */
function normalizeString(str) {
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ł/g, 'l')
        .replace(/Ł/g, 'L')
        .trim();
}

/**
 * Sprawdza czy wiadomość zawiera komendę
 */
function isCommand(message) {
    if (!message || typeof message !== 'string') {
        return false;
    }
    const trimmed = message.trim().toLowerCase();
    return trimmed === '!help' || 
           trimmed === '!commands' || 
           trimmed === '!status' ||
           trimmed === '!refresh';
}

/**
 * Zwraca odpowiedź na komendę
 */
function getCommandResponse(message, cacheStats = null) {
    const trimmed = message.trim().toLowerCase();
    
    if (trimmed === '!commands') {
        return `📋 *Dostępne komendy:*

• \`!commands\` - pokazuje tę listę
• \`!help\` - przykład użycia
• \`!status\` - status cache mappingów
• \`!refresh\` - odśwież cache

📝 *Atrybuty:*
• \`[Create]\` - tworzy taski w Codecks
• \`[Deck: nazwa]\` - wybiera deck
• \`[Deck: Space/Deck]\` - wybiera deck w konkretnym Space`;
    }
    
    if (trimmed === '!status') {
        if (cacheStats) {
            return `🔄 *Status Cache:*

• 📂 Spaces: ${cacheStats.spaces}
• 🎴 Decks: ${cacheStats.decks}
• 🛤️ Deck paths: ${cacheStats.deckPaths}
• 👥 Users: ${cacheStats.users}
• ⏰ Ostatnie odświeżenie: ${cacheStats.lastRefresh ? new Date(cacheStats.lastRefresh).toLocaleString('pl-PL') : 'nigdy'}`;
        }
        return '⚠️ Cache nie jest zainicjalizowany';
    }
    
    if (trimmed === '!help') {
        return `🤖 *Jak używać Codecks Bot v5.0:*

\`\`\`
[Create] [Deck: Space/Deck]
• Nazwa Taska (Owner)
   • Opis linia 1
   • Opis linia 2
      • To doda "- " w Codecks
      • To też "- "
   • [ ] Checkbox
• Następny Task (Owner2)
   • Inny opis
\`\`\`

*Poziomy wcięć:*
• \`• tekst\` = Nowy task (tytuł)
• \`   • tekst\` = Opis w Codecks
• \`      • tekst\` = Bullet "- tekst" w opisie
• \`   • [ ] tekst\` = Checkbox

*Wiele decków:*
\`\`\`
[Create] [Deck: Art]
• Task graficzny

[Create] [Deck: Code]
• Task programistyczny
\`\`\`

*Zasady:*
• \`(Imię)\` na końcu = Owner
• \`[ ]\` = Checkbox, \`[x]\` = zaznaczony`;
    }
    
    return null;
}

/**
 * Sprawdza czy wiadomość zawiera [Create]
 */
function hasCreateCommand(message) {
    return message && message.includes('[Create]');
}

module.exports = {
    parseTaskMessage,
    parseCreateBlock,
    splitIntoCreateBlocks,
    buildCardContent,
    normalizeString,
    isCommand,
    getCommandResponse,
    hasCreateCommand
};
