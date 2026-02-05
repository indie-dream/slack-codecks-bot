/**
 * Parser wiadomości Slack v5.1
 * 
 * CZYTA event.blocks (rich_text) zamiast event.text!
 * 
 * Slack w event.text SPŁASZCZA wcięcia list — wszystkie bullety są na poziomie 0.
 * Natomiast event.blocks zawiera rich_text_list z polem "indent" (0, 1, 2, ...)
 * które poprawnie odzwierciedla nesting.
 * 
 * STRUKTURA SLACK event.blocks:
 * [{
 *   type: "rich_text",
 *   elements: [
 *     { type: "rich_text_section", elements: [{ type: "text", text: "[Create] [Deck: X]" }] },
 *     { type: "rich_text_list", style: "bullet", indent: 0, elements: [
 *       { type: "rich_text_section", elements: [{ type: "text", text: "Task name (Owner)" }] }
 *     ]},
 *     { type: "rich_text_list", style: "bullet", indent: 1, elements: [
 *       { type: "rich_text_section", elements: [{ type: "text", text: "Description line" }] }
 *     ]},
 *     { type: "rich_text_list", style: "bullet", indent: 2, elements: [
 *       { type: "rich_text_section", elements: [{ type: "text", text: "Sub-bullet → '- ' in Codecks" }] }
 *     ]}
 *   ]
 * }]
 * 
 * MAPPING:
 *   indent 0 → Nowy task (tytuł)
 *   indent 1 → Opis / checkbox
 *   indent 2+ → "- tekst" w opisie / checkbox
 */

const assigneeRegex = /\(([^)]+)\)\s*$/;
const checkboxRegex = /^\[([xX\s]?)\]\s*(.*)$/;

/**
 * Wyciąga tekst z elementów rich_text_section
 * Obsługuje: text, link, emoji, user, channel
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
 * Główna funkcja parsująca — przyjmuje event.blocks i event.text
 * Priorytet: blocks (rich_text) > text (fallback)
 */
function parseTaskMessage(text, blocks) {
    // Sprawdź czy wiadomość zawiera [Create]
    const messageText = text || '';
    if (!messageText.includes('[Create]')) {
        return { tasks: [], deckPath: null, blocks: [] };
    }
    
    // Preferuj blocks jeśli dostępne
    if (blocks && Array.isArray(blocks) && blocks.length > 0) {
        console.log('📦 Parser: używam event.blocks (rich_text)');
        return parseFromBlocks(blocks);
    }
    
    // Fallback do event.text
    console.log('📝 Parser: fallback do event.text');
    return parseFromText(messageText);
}

// ═══════════════════════════════════════════════════════════
// PARSER Z event.blocks (GŁÓWNY)
// ═══════════════════════════════════════════════════════════

/**
 * Parsuje rich_text blocks ze Slacka
 */
function parseFromBlocks(blocks) {
    const allTasks = [];
    let firstDeckPath = null;
    
    for (const block of blocks) {
        if (block.type !== 'rich_text') continue;
        
        // Zbierz elementy bloku w płaską listę z indent info
        const flatItems = flattenRichTextBlock(block);
        
        // Podziel na sekcje [Create]
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
    
    return {
        tasks: allTasks,
        deckPath: firstDeckPath,
        blocks: []
    };
}

/**
 * Spłaszcza rich_text block do listy { text, indent, isList }
 */
function flattenRichTextBlock(block) {
    const items = [];
    
    if (!block.elements) return items;
    
    for (const element of block.elements) {
        if (element.type === 'rich_text_section') {
            // Zwykły tekst (nie w liście)
            const text = extractText(element.elements);
            items.push({ text: text.trim(), indent: -1, isList: false });
            
        } else if (element.type === 'rich_text_list') {
            const indent = element.indent || 0;
            const style = element.style || 'bullet'; // bullet, ordered, checked, unchecked
            
            if (!element.elements) continue;
            
            for (const listItem of element.elements) {
                if (listItem.type === 'rich_text_section') {
                    const text = extractText(listItem.elements);
                    items.push({ 
                        text: text.trim(), 
                        indent: indent, 
                        isList: true,
                        listStyle: style
                    });
                }
            }
        }
        // Ignoruj rich_text_preformatted, rich_text_quote itp.
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
            if (currentSection) {
                sections.push(currentSection);
            }
            currentSection = { createLine: item.text, items: [] };
        } else if (currentSection) {
            currentSection.items.push(item);
        }
    }
    
    if (currentSection) {
        sections.push(currentSection);
    }
    
    return sections;
}

/**
 * Parsuje jedną sekcję [Create] z flat items
 */
function parseCreateSection(section) {
    // Wyodrębnij deck path z linii [Create]
    let deckPath = null;
    const deckMatch = section.createLine.match(/\[Deck:\s*([^\]]+)\]/i);
    if (deckMatch) {
        deckPath = deckMatch[1].trim();
    }
    
    const tasks = [];
    let currentTask = null;
    
    for (const item of section.items) {
        if (!item.isList) {
            // Tekst poza listą — ignoruj
            console.log(`⚠️ Parser: ignoruję tekst poza listą: "${item.text}"`);
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
            let assigneeName = null;
            
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
            
        } else if (indent === 1 && currentTask) {
            // ═══════════════════════════════════════
            // INDENT 1: Opis lub checkbox
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

// Wszystkie znaki bullet jakie Slack może wysłać
const BULLET_CHARS = '•◦\\-\\*‣●○▪▸';
const bulletRegex = new RegExp(`^(\\s*)([${BULLET_CHARS}])\\s+(.*)$`);

/**
 * Fallback: parsuje z event.text (gdy brak blocks)
 * UWAGA: Slack spłaszcza wcięcia w event.text, więc ten parser
 * może nie działać poprawnie z nested listami!
 */
function parseFromText(message) {
    const blocks = splitIntoCreateBlocks(message);
    
    const allTasks = [];
    let firstDeckPath = null;
    
    for (const block of blocks) {
        const { tasks, deckPath } = parseCreateBlockText(block);
        
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
        blocks: []
    };
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
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed === '') continue;
        
        const bulletMatch = line.match(bulletRegex);
        if (!bulletMatch) {
            console.log(`⚠️ Parser (text fallback): ignoruję linię: "${trimmed}"`);
            continue;
        }
        
        const indent = bulletMatch[1].length;
        const content = bulletMatch[3].trim();
        
        // W text fallback, bez wcięć = zawsze level 0 (nowy task)
        // To jest ograniczenie — Slack spłaszcza wcięcia
        const level = indent <= 1 ? 0 : indent <= 4 ? 1 : 2;
        
        if (level === 0) {
            if (currentTask) tasks.push(currentTask);
            
            let titleText = content;
            let assigneeName = null;
            const aMatch = titleText.match(assigneeRegex);
            if (aMatch) {
                assigneeName = aMatch[1].trim();
                titleText = titleText.replace(assigneeRegex, '').trim();
            }
            currentTask = { title: titleText, assigneeName, description: [], checkboxes: [] };
            
        } else if (level === 1 && currentTask) {
            const cbMatch = content.match(checkboxRegex);
            if (cbMatch) {
                currentTask.checkboxes.push({ text: cbMatch[2].trim(), checked: cbMatch[1].toLowerCase() === 'x' });
            } else {
                currentTask.description.push(content);
            }
        } else if (level >= 2 && currentTask) {
            const cbMatch = content.match(checkboxRegex);
            if (cbMatch) {
                currentTask.checkboxes.push({ text: cbMatch[2].trim(), checked: cbMatch[1].toLowerCase() === 'x' });
            } else {
                currentTask.description.push('- ' + content);
            }
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
 */
function buildCardContent(task) {
    let content = '';
    
    if (task.description && task.description.length > 0) {
        content += task.description.join('\n');
    }
    
    if (task.checkboxes && task.checkboxes.length > 0) {
        if (content) content += '\n';
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
        return `🤖 *Jak używać Codecks Bot v5.1:*

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
    // Eksport do testów
    flattenRichTextBlock,
    extractText,
    splitByCreate,
    parseCreateSection
};
