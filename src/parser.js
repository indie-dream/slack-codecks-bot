/**
 * Parser wiadomości Slack v3.0
 * 
 * Format:
 * [Create] [Deck: NazwaDecka]
 * 
 * Nazwa Taska (Owner)
 * • Opis linia 1
 * • Opis linia 2
 * • [ ] Checkbox 1
 * • [] Checkbox 2
 *    • Wcięcie w tekście
 * 
 * Drugi Task
 * • Opis
 */

/**
 * Parsuje wiadomość Slack i wyodrębnia taski
 */
function parseTaskMessage(message, userMapping = {}, deckMapping = {}, defaultDeckId = null) {
    if (!message || typeof message !== 'string') {
        return { tasks: [], deckId: defaultDeckId };
    }
    
    // Sprawdź czy wiadomość zawiera [Create]
    if (!message.includes('[Create]')) {
        return { tasks: [], deckId: defaultDeckId };
    }
    
    // Wyodrębnij deck z [Deck: nazwa]
    let deckId = defaultDeckId;
    const deckMatch = message.match(/\[Deck:\s*([^\]]+)\]/i);
    if (deckMatch) {
        const deckName = deckMatch[1].trim().toLowerCase();
        if (deckMapping[deckName]) {
            deckId = deckMapping[deckName];
        }
    }
    
    const tasks = [];
    const lines = message.split('\n');
    
    // Regex do wykrywania bullet points (-, •, *)
    const bulletRegex = /^(\s*)([-•*])\s+(.*)$/;
    
    // Regex do wyodrębnienia przypisania: (Imię) lub (Imię Nazwisko)
    const assigneeRegex = /\(([^)]+)\)\s*$/;
    
    // Regex do wykrywania checkboxów: [ ], [x], [X], []
    const checkboxRegex = /^\[([xX\s]?)\]\s*(.*)$/;
    
    let currentTask = null;
    let inCreateBlock = false;
    let lastLineWasDescription = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Sprawdź czy zaczyna się blok [Create]
        if (line.includes('[Create]')) {
            inCreateBlock = true;
            continue;
        }
        
        // Ignoruj linie przed [Create]
        if (!inCreateBlock) {
            continue;
        }
        
        // Pusta linia = separator tasków
        if (line.trim() === '') {
            if (currentTask) {
                tasks.push(currentTask);
                currentTask = null;
            }
            lastLineWasDescription = false;
            continue;
        }
        
        // Sprawdź czy to bullet point
        const bulletMatch = line.match(bulletRegex);
        
        if (bulletMatch) {
            // To jest bullet point
            const indent = bulletMatch[1].length;
            let content = bulletMatch[3].trim();
            
            // Jeśli nie ma aktywnego taska, ignoruj
            if (!currentTask) {
                continue;
            }
            
            // Sprawdź czy to checkbox: [ ], [], [x]
            const checkboxMatch = content.match(checkboxRegex);
            
            if (checkboxMatch) {
                // To jest checkbox
                const isChecked = checkboxMatch[1].toLowerCase() === 'x';
                const checkboxText = checkboxMatch[2].trim();
                currentTask.checkboxes.push({
                    text: checkboxText,
                    checked: isChecked
                });
                lastLineWasDescription = false;
            } else if (indent >= 3) {
                // Wcięty bullet = wcięcie w tekście (dodaj do poprzedniej linii)
                if (currentTask.description.length > 0) {
                    // Dodaj jako nową linię z wcięciem
                    currentTask.description.push('   ' + content);
                } else {
                    currentTask.description.push('   ' + content);
                }
                lastLineWasDescription = true;
            } else {
                // Zwykły opis
                currentTask.description.push(content);
                lastLineWasDescription = true;
            }
        } else {
            // Linia bez bullet = nowy task (tytuł)
            const trimmedLine = line.trim();
            
            // Ignoruj linie z [Deck:] i inne meta
            if (trimmedLine.startsWith('[') && trimmedLine.includes(']')) {
                continue;
            }
            
            // Ignoruj puste linie
            if (trimmedLine === '') {
                continue;
            }
            
            // Zapisz poprzedni task
            if (currentTask) {
                tasks.push(currentTask);
            }
            
            // Wyodrębnij assignee
            let assigneeId = null;
            let assigneeName = null;
            let taskTitle = trimmedLine;
            
            const assigneeMatch = trimmedLine.match(assigneeRegex);
            if (assigneeMatch) {
                assigneeName = assigneeMatch[1].trim();
                taskTitle = trimmedLine.replace(assigneeRegex, '').trim();
                
                // Szukaj w mapowaniu
                const normalizedName = normalizeString(assigneeName);
                for (const [key, userId] of Object.entries(userMapping)) {
                    if (normalizeString(key) === normalizedName) {
                        assigneeId = userId;
                        break;
                    }
                }
            }
            
            currentTask = {
                title: taskTitle,
                assigneeId: assigneeId,
                assigneeName: assigneeName,
                description: [],
                checkboxes: []
            };
            lastLineWasDescription = false;
        }
    }
    
    // Dodaj ostatni task
    if (currentTask) {
        tasks.push(currentTask);
    }
    
    return { tasks, deckId };
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
        if (task.description.length > 0) {
            content += '\n';
        } else {
            content += '\n';
        }
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
    return trimmed === '!help' || trimmed === '!commands';
}

/**
 * Zwraca odpowiedź na komendę
 */
function getCommandResponse(message) {
    const trimmed = message.trim().toLowerCase();
    
    if (trimmed === '!commands') {
        return `📋 *Dostępne komendy:*

• \`!commands\` - pokazuje tę listę
• \`!help\` - pokazuje przykład użycia

📝 *Atrybuty:*
• \`[Create]\` - tworzy taski w Codecks
• \`[Deck: nazwa]\` - wybiera deck (opcjonalne)`;
    }
    
    if (trimmed === '!help') {
        return `🤖 *Jak używać Codecks Bot:*

*Format wiadomości:*
\`\`\`
[Create] [Deck: Design]

Nazwa Taska (Owner)
• Opis linia 1
• Opis linia 2
• [ ] Checkbox 1
• [] Checkbox 2
   • Wcięcie w tekście

Drugi Task (Inna Osoba)
• Opis tego taska
\`\`\`

*Zasady:*
• Linia bez bullet (•/-/*) = *Nazwa taska*
• \`(Imię)\` przy nazwie = *Owner*
• \`• tekst\` = Opis
• \`• [ ]\` lub \`• []\` = Checkbox
• Wcięty \`   •\` = Wcięcie w tekście
• Pusta linia = Separator tasków

*Przykład:*
\`\`\`
[Create]

System walki (Tobiasz)
• Multiplayer support
• Dodaj animacje
• [ ] Idle animation
• [ ] Attack animation

UI Design (Anna)
• Zaprojektuj menu
   • Główne menu
   • Opcje
\`\`\``;
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
    buildCardContent,
    normalizeString,
    isCommand,
    getCommandResponse,
    hasCreateCommand
};
