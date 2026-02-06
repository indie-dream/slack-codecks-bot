/**
 * Parser wiadomości Slack v5.2
 * 
 * CZYTA event.blocks (rich_text) zamiast event.text!
 * 
 * FORMAT WIADOMOŚCI:
 * 
 * [Create] [Deck: Space/Deck]
 * 
 * Tomek:                              ← Owner (plain text, nie bullet)
 * • Task 1                            ← indent 0 = nowy task
 *    • Opis linia 1                   ← indent 1 = opis
 *    • [ ] Checkbox                   ← indent 1 = checkbox
 *       • Sub-bullet                  ← indent 2 = "- " w opisie
 *    • Następna linia opisu           ← indent 1 (po indent 2 → \n\n separator)
 * • Task 2                            ← indent 0 = kolejny task Tomka
 * 
 * Tobiasz:                            ← Nowy owner
 * • Task 3                            ← indent 0 = task Tobiasza
 *    • Opis
 * 
 * OWNER FORMATY (plain text, nie w liście):
 *   "Tomek:"     → owner = "Tomek"
 *   "Tomek"      → owner = "Tomek"  (bez dwukropka też działa)
 * 
 * FORMATOWANIE W CODECKS:
 *   indent 0 → tytuł karty (pierwsza linia content)
 *   indent 1 → linia opisu
 *   indent 2 → "- tekst" w opisie
 *   Gdy po indent 2 wraca indent 1 → dodaj \n\n (pustą linię) przed
 */

const assigneeRegex = /\(([^)]+)\)\s*$/;
const checkboxRegex = /^\[([xX\s]?)\]\s*(.*)$/;
// Regex: "Imię:" lub "Imię Nazwisko:" — tekst kończący się na ":"
const ownerHeaderRegex = /^(.+?):?\s*$/;

/**
 * Wyciąga tekst z elementów rich_text_section
 */
function extractText(elements) {
    if (!elements || !Array.isArray(elements)) return '';
    
    return elements.map(el => {
        switch (el.type) {
            case 'text':
                return el.text || '';
            case 'link':
                return el.text || el.url || '';
            case 'emoji':
                return el.unicode ? String.fromCodePoint(parseInt(el.unicode, 16)) : `:${el.name}:`;
            case 'user':
                return `<@${el.user_id}>`;
            case 'channel':
                return `<#${el.channel_id}>`;
            default:
                return el.text || '';
        }
    }).join('');
}

/**
 * Główna funkcja parsująca — przyjmuje event.text i event.blocks
 */
function parseTaskMessage(text, blocks) {
    const messageText = text || '';
    if (!messageText.includes('[Create]')) {
        return { tasks: [], deckPath: null, blocks: [] };
    }
    
    if (blocks && Array.isArray(blocks) && blocks.length > 0) {
        console.log('📦 Parser: używam event.blocks (rich_text)');
        return parseFromBlocks(blocks);
    }
    
    console.log('📝 Parser: fallback do event.text');
    return parseFromText(messageText);
}

// ═══════════════════════════════════════════════════════════
// PARSER Z event.blocks (GŁÓWNY)
// ═══════════════════════════════════════════════════════════

function parseFromBlocks(blocks) {
    const allTasks = [];
    let firstDeckPath = null;
    
    for (const block of blocks) {
        if (block.type !== 'rich_text') continue;
        
        const flatItems = flattenRichTextBlock(block);
        const createSections = splitByCreate(flatItems);
        
        for (const section of createSections) {
            const { tasks, deckPath } = parseCreateSection(section);
            
            if (firstDeckPath === null && deckPath) {
                firstDeckPath = deckPath;
            }
            
            for (const task of tasks) {
                task.deckPath = deckPath;
                allTasks.push(task);
            }
        }
    }
    
    return { tasks: allTasks, deckPath: firstDeckPath, blocks: [] };
}

/**
 * Spłaszcza rich_text block do listy { text, indent, isList }
 */
function flattenRichTextBlock(block) {
    const items = [];
    if (!block.elements) return items;
    
    for (const element of block.elements) {
        if (element.type === 'rich_text_section') {
            const text = extractText(element.elements);
            items.push({ text: text.trim(), indent: -1, isList: false });
            
        } else if (element.type === 'rich_text_list') {
            const indent = element.indent || 0;
            const style = element.style || 'bullet';
            
            if (!element.elements) continue;
            
            for (const listItem of element.elements) {
                if (listItem.type === 'rich_text_section') {
                    const text = extractText(listItem.elements);
                    items.push({ text: text.trim(), indent, isList: true, listStyle: style });
                }
            }
        }
    }
    
    return items;
}

/**
 * Dzieli flat items na sekcje po [Create]
 */
function splitByCreate(items) {
    const sections = [];
    let currentSection = null;
    
    for (const item of items) {
        if (item.text.includes('[Create]')) {
            if (currentSection) sections.push(currentSection);
            currentSection = { createLine: item.text, items: [] };
        } else if (currentSection) {
            currentSection.items.push(item);
        }
    }
    
    if (currentSection) sections.push(currentSection);
    return sections;
}

/**
 * Sprawdza czy tekst wygląda jak nagłówek ownera.
 * Np. "Tomek:", "Tobiasz", "Anna Kowalska:"
 * Musi być plain text (nie w liście) i nie zawierać [Create]/[Deck:]
 */
function isOwnerHeader(text) {
    if (!text) return false;
    // Nie może zawierać tagów
    if (text.includes('[') || text.includes(']')) return false;
    // Nie może być pusty po trimie
    const trimmed = text.trim();
    if (!trimmed) return false;
    // Nie może być za długi (max ~50 znaków na imię)
    if (trimmed.length > 50) return false;
    // Powinien wyglądać jak imię (nie zawiera specjalnych znaków poza : i spacjami)
    // Akceptujemy: litery, spacje, dwukropek na końcu, polskie znaki
    return /^[\p{L}\p{M}\s.'-]+:?\s*$/u.test(trimmed);
}

/**
 * Wyciąga imię ownera z nagłówka
 * "Tomek:" → "Tomek"
 * "Tomek"  → "Tomek"
 * "Anna Kowalska:" → "Anna Kowalska"
 */
function extractOwnerName(text) {
    return text.trim().replace(/:+\s*$/, '').trim();
}

/**
 * Parsuje jedną sekcję [Create] z flat items
 */
function parseCreateSection(section) {
    let deckPath = null;
    const deckMatch = section.createLine.match(/\[Deck:\s*([^\]]+)\]/i);
    if (deckMatch) {
        deckPath = deckMatch[1].trim();
    }
    
    const tasks = [];
    let currentTask = null;
    let currentOwner = null;   // Aktualny owner z nagłówka
    let lastIndent = -1;       // Ostatni indent (do wykrywania powrotu z indent 2 → 1)
    
    for (const item of section.items) {
        
        // ═══════════════════════════════════════
        // PLAIN TEXT (nie w liście) → sprawdź czy to owner header
        // ═══════════════════════════════════════
        if (!item.isList) {
            if (isOwnerHeader(item.text)) {
                // Zapisz poprzedni task
                if (currentTask) {
                    tasks.push(currentTask);
                    currentTask = null;
                }
                currentOwner = extractOwnerName(item.text);
                lastIndent = -1;
                console.log(`👤 Parser: Owner header: "${currentOwner}"`);
            } else if (item.text) {
                console.log(`⚠️ Parser: ignoruję tekst poza listą: "${item.text}"`);
            }
            continue;
        }
        
        const indent = item.indent;
        const content = item.text;
        if (!content) continue;
        
        if (indent === 0) {
            // ═══════════════════════════════════════
            // INDENT 0: Nowy task (tytuł)
            // ═══════════════════════════════════════
            
            if (currentTask) {
                tasks.push(currentTask);
            }
            
            let titleText = content;
            let assigneeName = currentOwner; // Domyślnie z nagłówka
            
            // Sprawdź (Owner) w samym bullecie — nadpisuje nagłówek
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
            lastIndent = 0;
            
        } else if (indent === 1 && currentTask) {
            // ═══════════════════════════════════════
            // INDENT 1: Opis lub checkbox
            // Jeśli poprzedni indent był 2+ → dodaj \n\n separator
            // ═══════════════════════════════════════
            
            if (lastIndent >= 2) {
                // Powrót z głębszego poziomu → pusta linia w opisie
                currentTask.description.push('');
            }
            
            const cbMatch = content.match(checkboxRegex);
            if (cbMatch) {
                currentTask.checkboxes.push({
                    text: cbMatch[2].trim(),
                    checked: cbMatch[1].toLowerCase() === 'x'
                });
            } else {
                currentTask.description.push(content);
            }
            lastIndent = 1;
            
        } else if (indent >= 2 && currentTask) {
            // ═══════════════════════════════════════
            // INDENT 2+: "- tekst" w opisie lub checkbox
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
            lastIndent = indent;
        }
    }
    
    if (currentTask) {
        tasks.push(currentTask);
    }
    
    return { tasks, deckPath };
}

// ═══════════════════════════════════════════════════════════
// FALLBACK PARSER Z event.text
// ═══════════════════════════════════════════════════════════

const BULLET_CHARS = '•◦\\-\\*‣●○▪▸';
const bulletRegex = new RegExp(`^(\\s*)([${BULLET_CHARS}])\\s+(.*)$`);
const textOwnerRegex = /^([\p{L}\p{M}\s.'-]+):?\s*$/u;

function parseFromText(message) {
    const blocks = splitIntoCreateBlocks(message);
    const allTasks = [];
    let firstDeckPath = null;
    
    for (const block of blocks) {
        const { tasks, deckPath } = parseCreateBlockText(block);
        if (firstDeckPath === null && deckPath) firstDeckPath = deckPath;
        for (const task of tasks) {
            task.deckPath = deckPath;
            allTasks.push(task);
        }
    }
    
    return { tasks: allTasks, deckPath: firstDeckPath, blocks: [] };
}

function splitIntoCreateBlocks(message) {
    const blocks = [];
    const lines = message.split('\n');
    let currentBlock = [];
    let inBlock = false;
    
    for (const line of lines) {
        if (line.includes('[Create]')) {
            if (currentBlock.length > 0) blocks.push(currentBlock.join('\n'));
            currentBlock = [line];
            inBlock = true;
        } else if (inBlock) {
            currentBlock.push(line);
        }
    }
    if (currentBlock.length > 0) blocks.push(currentBlock.join('\n'));
    return blocks;
}

function parseCreateBlockText(blockText) {
    const lines = blockText.split('\n');
    
    let deckPath = null;
    const deckMatch = blockText.match(/\[Deck:\s*([^\]]+)\]/i);
    if (deckMatch) deckPath = deckMatch[1].trim();
    
    const tasks = [];
    let currentTask = null;
    let currentOwner = null;
    let lastIndent = -1;
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed === '') continue;
        
        const bulletMatch = line.match(bulletRegex);
        
        if (!bulletMatch) {
            // Sprawdź czy to owner header
            if (textOwnerRegex.test(trimmed) && !trimmed.includes('[')) {
                if (currentTask) { tasks.push(currentTask); currentTask = null; }
                currentOwner = trimmed.replace(/:+\s*$/, '').trim();
                lastIndent = -1;
                console.log(`👤 Parser (text): Owner header: "${currentOwner}"`);
            } else {
                console.log(`⚠️ Parser (text fallback): ignoruję linię: "${trimmed}"`);
            }
            continue;
        }
        
        const indent = bulletMatch[1].length;
        const content = bulletMatch[3].trim();
        const level = indent <= 1 ? 0 : indent <= 4 ? 1 : 2;
        
        if (level === 0) {
            if (currentTask) tasks.push(currentTask);
            
            let titleText = content;
            let assigneeName = currentOwner;
            const aMatch = titleText.match(assigneeRegex);
            if (aMatch) {
                assigneeName = aMatch[1].trim();
                titleText = titleText.replace(assigneeRegex, '').trim();
            }
            currentTask = { title: titleText, assigneeName, description: [], checkboxes: [] };
            lastIndent = 0;
            
        } else if (level === 1 && currentTask) {
            if (lastIndent >= 2) currentTask.description.push('');
            
            const cbMatch = content.match(checkboxRegex);
            if (cbMatch) {
                currentTask.checkboxes.push({ text: cbMatch[2].trim(), checked: cbMatch[1].toLowerCase() === 'x' });
            } else {
                currentTask.description.push(content);
            }
            lastIndent = 1;
            
        } else if (level >= 2 && currentTask) {
            const cbMatch = content.match(checkboxRegex);
            if (cbMatch) {
                currentTask.checkboxes.push({ text: cbMatch[2].trim(), checked: cbMatch[1].toLowerCase() === 'x' });
            } else {
                currentTask.description.push('- ' + content);
            }
            lastIndent = level;
        }
    }
    
    if (currentTask) tasks.push(currentTask);
    return { tasks, deckPath };
}

// ═══════════════════════════════════════════════════════════
// WSPÓLNE FUNKCJE
// ═══════════════════════════════════════════════════════════

/**
 * Buduje content karty dla Codecks
 * Codecks bierze PIERWSZĄ LINIĘ jako tytuł!
 */
function buildCardContent(task) {
    let content = task.title;
    
    if (task.description && task.description.length > 0) {
        content += '\n\n' + task.description.join('\n');
    }
    
    if (task.checkboxes && task.checkboxes.length > 0) {
        content += '\n';
        for (const checkbox of task.checkboxes) {
            const mark = checkbox.checked ? 'x' : ' ';
            content += `\n- [${mark}] ${checkbox.text}`;
        }
    }
    
    return content;
}

function normalizeString(str) {
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ł/g, 'l')
        .replace(/Ł/g, 'L')
        .trim();
}

function isCommand(message) {
    if (!message || typeof message !== 'string') return false;
    const trimmed = message.trim().toLowerCase();
    return trimmed === '!help' || trimmed === '!commands' || trimmed === '!status' || trimmed === '!refresh';
}

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
        return `🤖 *Jak używać Codecks Bot v5.2:*

\`\`\`
[Create] [Deck: Space/Deck]

Tomek:
• Task 1
   • Opis linia 1
   • [ ] Checkbox
      • Sub-bullet (→ "- " w Codecks)
   • Następna linia
• Task 2

Tobiasz:
• Task 3
   • Inny opis
\`\`\`

*Owner:* Tekst przed bulletami = owner tasków pod spodem
*Poziomy wcięć:*
• \`• tekst\` = Nowy task (tytuł)
• \`   • tekst\` = Opis w Codecks
• \`      • tekst\` = Bullet "- tekst" w opisie
• \`   • [ ] tekst\` = Checkbox`;
    }
    
    return null;
}

function hasCreateCommand(message) {
    return message && message.includes('[Create]');
}

module.exports = {
    parseTaskMessage,
    parseFromBlocks,
    parseFromText,
    buildCardContent,
    normalizeString,
    isCommand,
    getCommandResponse,
    hasCreateCommand,
    flattenRichTextBlock,
    extractText,
    splitByCreate,
    parseCreateSection,
    isOwnerHeader,
    extractOwnerName
};
