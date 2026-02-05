/**
 * Parser wiadomości Slack v3.1
 * 
 * Format:
 * [Create] Nazwa Taska (Owner)
 * • Opis linia 1
 * • Opis linia 2
 *    • Wcięcie w opisie
 * • [] Checkbox 1
 * • [ ] Checkbox 2
 * 
 * Następny Task (Inna Osoba)
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
    
    // Regex do [Create] z tytułem w tej samej linii
    const createWithTitleRegex = /\[Create\](?:\s*\[Deck:[^\]]+\])?\s+(.+)/i;
    
    let currentTask = null;
    let inCreateBlock = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        
        // Sprawdź czy to linia z [Create]
        if (line.includes('[Create]')) {
            inCreateBlock = true;
            
            // Sprawdź czy tytuł jest w tej samej linii
            const createMatch = line.match(createWithTitleRegex);
            if (createMatch) {
                let titlePart = createMatch[1].trim();
                
                // Wyodrębnij assignee z tytułu
                let assigneeId = null;
                let assigneeName = null;
                
                const assigneeMatch = titlePart.match(assigneeRegex);
                if (assigneeMatch) {
                    assigneeName = assigneeMatch[1].trim();
                    titlePart = titlePart.replace(assigneeRegex, '').trim();
                    
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
                    title: titlePart,
                    assigneeId: assigneeId,
                    assigneeName: assigneeName,
                    description: [],
                    checkboxes: []
                };
            }
            continue;
        }
        
        // Ignoruj linie przed [Create]
        if (!inCreateBlock) {
            continue;
        }
        
        // Pusta linia = potencjalny separator
        if (trimmedLine === '') {
            continue;
        }
        
        // Sprawdź czy to bullet point
        const bulletMatch = line.match(bulletRegex);
        
        if (bulletMatch) {
            // To jest bullet point - ZAWSZE należy do aktualnego taska
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
            } else if (indent >= 3) {
                // Wcięty bullet = wcięcie w tekście opisu
                currentTask.description.push('   • ' + content);
            } else {
                // Zwykły opis
                currentTask.description.push(content);
            }
        } else {
            // Linia bez bullet = NOWY task (tytuł)
            
            // Ignoruj linie z [Deck:] i inne meta
            if (trimmedLine.startsWith('[') && trimmedLine.includes(']')) {
                continue;
            }
            
            // Zapisz poprzedni task jeśli istnieje
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
[Create] Nazwa Taska (Owner)
• Opis linia 1
• Opis linia 2
   • Wcięcie w tekście
• [ ] Checkbox 1
• [] Checkbox 2

Następny Task (Inna Osoba)
• Opis tego taska
\`\`\`

*Zasady:*
• Tytuł taska = linia bez bullet (•/-/*)
• \`(Imię)\` przy tytule = Owner
• \`• tekst\` = Opis
• \`   • tekst\` (wcięty) = Wcięcie w opisie
• \`• [ ]\` lub \`• []\` = Checkbox

*Przykład:*
\`\`\`
[Create] System walki (Tobiasz)
• Multiplayer support
• Dodaj animacje
   • Attack animation
   • Idle animation
• [ ] Testy jednostkowe
• [ ] Code review

UI Design (Anna)
• Zaprojektuj menu główne
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
