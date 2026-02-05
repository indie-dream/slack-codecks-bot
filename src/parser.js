/**
 * Parser wiadomości Slack v4.1
 * 
 * NOWE FUNKCJE:
 * 1. Wiele bloków [Create] w jednej wiadomości (każdy z własnym Deck)
 * 2. Bullet jako tytuł - gdy brak linii bez bullet
 * 
 * FORMAT STANDARDOWY:
 * [Create] [Deck: Space/Deck] Tytuł Taska (Owner)
 * • Opis
 * • [ ] Checkbox
 * 
 * FORMAT BULLET-AS-TITLE:
 * [Create] [Deck: Space/Deck]
 * • Tytuł Taska (Owner)
 *    • Opis (wcięcie = description)
 *       • Głębsze wcięcie = bullet w Codecks
 * 
 * WIELE BLOKÓW:
 * [Create] [Deck: Art] Task 1
 * • Opis
 * 
 * [Create] [Deck: Code] Task 2
 * • Opis
 */

/**
 * Główna funkcja parsująca - zwraca tablicę bloków
 * Każdy blok ma: { tasks: [], deckPath: string }
 */
function parseTaskMessage(message) {
    if (!message || typeof message !== 'string') {
        return { tasks: [], deckPath: null, blocks: [] };
    }
    
    // Sprawdź czy wiadomość zawiera [Create]
    if (!message.includes('[Create]')) {
        return { tasks: [], deckPath: null, blocks: [] };
    }
    
    // Podziel na bloki [Create]
    const blocks = splitIntoCreateBlocks(message);
    
    // Parsuj każdy blok osobno
    const allTasks = [];
    let firstDeckPath = null;
    
    for (const block of blocks) {
        const { tasks, deckPath } = parseCreateBlock(block);
        
        if (firstDeckPath === null && deckPath) {
            firstDeckPath = deckPath;
        }
        
        // Każdy task dostaje swój deckPath
        for (const task of tasks) {
            task.deckPath = deckPath;
            allTasks.push(task);
        }
    }
    
    // Kompatybilność wsteczna + nowe blocks
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
            // Zapisz poprzedni blok
            if (currentBlock.length > 0) {
                blocks.push(currentBlock.join('\n'));
            }
            // Rozpocznij nowy blok
            currentBlock = [line];
            inBlock = true;
        } else if (inBlock) {
            currentBlock.push(line);
        }
    }
    
    // Zapisz ostatni blok
    if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
    }
    
    return blocks;
}

/**
 * Parsuje pojedynczy blok [Create]
 */
function parseCreateBlock(blockText) {
    const lines = blockText.split('\n');
    
    // Wyodrębnij deck path
    let deckPath = null;
    const deckMatch = blockText.match(/\[Deck:\s*([^\]]+)\]/i);
    if (deckMatch) {
        deckPath = deckMatch[1].trim();
    }
    
    // Regex
    const bulletRegex = /^(\s*)([-•*])\s+(.*)$/;
    const assigneeRegex = /\(([^)]+)\)\s*$/;
    const checkboxRegex = /^\[([xX\s]?)\]\s*(.*)$/;
    const createWithTitleRegex = /\[Create\](?:\s*\[Deck:[^\]]+\])?\s+(.+)/i;
    
    const tasks = [];
    let currentTask = null;
    let hasNonBulletTitle = false;
    
    // Sprawdź czy [Create] ma tytuł w tej samej linii
    const firstLine = lines[0];
    const createMatch = firstLine.match(createWithTitleRegex);
    
    if (createMatch) {
        let titlePart = createMatch[1].trim();
        titlePart = titlePart.replace(/\[Deck:[^\]]+\]\s*/gi, '').trim();
        
        if (titlePart) {
            hasNonBulletTitle = true;
            let assigneeName = null;
            
            const assigneeMatch = titlePart.match(assigneeRegex);
            if (assigneeMatch) {
                assigneeName = assigneeMatch[1].trim();
                titlePart = titlePart.replace(assigneeRegex, '').trim();
            }
            
            currentTask = {
                title: titlePart,
                assigneeName: assigneeName,
                description: [],
                checkboxes: []
            };
        }
    }
    
    // Parsuj pozostałe linie
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        
        if (trimmedLine === '') continue;
        
        // Sprawdź czy to bullet
        const bulletMatch = line.match(bulletRegex);
        
        if (bulletMatch) {
            const indent = bulletMatch[1].length;
            let content = bulletMatch[3].trim();
            
            // Sprawdź checkbox
            const checkboxMatch = content.match(checkboxRegex);
            
            if (indent === 0 || indent <= 1) {
                // Poziom 0 - główny bullet
                
                if (!hasNonBulletTitle && !currentTask) {
                    // BULLET-AS-TITLE: pierwszy główny bullet = tytuł
                    let assigneeName = null;
                    let titleText = content;
                    
                    // Usuń checkbox jeśli jest
                    if (checkboxMatch) {
                        titleText = checkboxMatch[2].trim();
                    }
                    
                    const assigneeMatch = titleText.match(assigneeRegex);
                    if (assigneeMatch) {
                        assigneeName = assigneeMatch[1].trim();
                        titleText = titleText.replace(assigneeRegex, '').trim();
                    }
                    
                    currentTask = {
                        title: titleText,
                        assigneeName: assigneeName,
                        description: [],
                        checkboxes: []
                    };
                } else if (currentTask) {
                    // Kolejny główny bullet
                    if (checkboxMatch) {
                        // To jest checkbox
                        const isChecked = checkboxMatch[1].toLowerCase() === 'x';
                        currentTask.checkboxes.push({
                            text: checkboxMatch[2].trim(),
                            checked: isChecked
                        });
                    } else {
                        // To jest opis
                        currentTask.description.push(content);
                    }
                }
                
            } else if (indent >= 2 && indent <= 4) {
                // Poziom 1 (2-4 spacje) - description lub sub-item
                if (currentTask) {
                    if (checkboxMatch) {
                        currentTask.checkboxes.push({
                            text: checkboxMatch[2].trim(),
                            checked: checkboxMatch[1].toLowerCase() === 'x'
                        });
                    } else {
                        currentTask.description.push(content);
                    }
                }
                
            } else if (indent >= 5) {
                // Poziom 2+ (5+ spacji) - głębsze wcięcie = bullet w tekście
                if (currentTask) {
                    if (checkboxMatch) {
                        currentTask.checkboxes.push({
                            text: checkboxMatch[2].trim(),
                            checked: checkboxMatch[1].toLowerCase() === 'x'
                        });
                    } else {
                        // Zachowaj jako wcięty bullet w opisie
                        currentTask.description.push('   • ' + content);
                    }
                }
            }
            
        } else {
            // Linia bez bullet
            
            // Ignoruj meta linie
            if (trimmedLine.startsWith('[') && trimmedLine.includes(']')) {
                continue;
            }
            
            // NOWY TASK (tradycyjny format)
            if (currentTask) {
                tasks.push(currentTask);
            }
            
            let assigneeName = null;
            let taskTitle = trimmedLine;
            
            const assigneeMatch = trimmedLine.match(assigneeRegex);
            if (assigneeMatch) {
                assigneeName = assigneeMatch[1].trim();
                taskTitle = trimmedLine.replace(assigneeRegex, '').trim();
            }
            
            currentTask = {
                title: taskTitle,
                assigneeName: assigneeName,
                description: [],
                checkboxes: []
            };
            hasNonBulletTitle = true;
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
    let content = task.title;
    
    // Dodaj description
    if (task.description && task.description.length > 0) {
        content += '\n\n' + task.description.join('\n');
    }
    
    // Dodaj checkboxy
    if (task.checkboxes && task.checkboxes.length > 0) {
        content += '\n';
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
        return `🤖 *Jak używać Codecks Bot v4.1:*

*FORMAT 1 - Standardowy:*
\`\`\`
[Create] [Deck: Code] Nazwa Taska (Owner)
• Opis linia 1
• [ ] Checkbox
\`\`\`

*FORMAT 2 - Bullet jako tytuł:*
\`\`\`
[Create] [Deck: Code]
• Nazwa Taska (Owner)
   • To jest opis
   • [ ] Checkbox
      • Wcięty tekst w opisie
\`\`\`

*WIELE DECKÓW w jednej wiadomości:*
\`\`\`
[Create] [Deck: Art] Task graficzny
• Opis

[Create] [Deck: Code] Task programistyczny
• Inny opis
\`\`\`

*Poziomy wcięć (Format 2):*
• \`• tekst\` (0 spacji) = Tytuł taska
• \`   • tekst\` (3 spacje) = Opis
• \`      • tekst\` (6 spacji) = Wcięty bullet w opisie

*Zasady:*
• \`(Imię)\` = Owner
• \`• [ ]\` lub \`• []\` = Checkbox
• Pusta linia = separator`;
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
