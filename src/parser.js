/**
 * Parser wiadomości Slack v2.0
 * Obsługuje wielopoziomową strukturę tasków z description i checkboxami
 * 
 * Format:
 * [Create]
 * • Nazwa taska (Owner)
 *    • Opis linijka
 *       • [ ] Checkbox
 */

/**
 * Parsuje wiadomość Slack i wyodrębnia taski
 * 
 * @param {string} message - Treść wiadomości
 * @param {Object} userMapping - Mapowanie imion na ID użytkowników Codecks
 * @returns {Array} Lista tasków z description i checkboxami
 */
function parseTaskMessage(message, userMapping = {}) {
    if (!message || typeof message !== 'string') {
        return [];
    }
    
    // Sprawdź czy wiadomość zawiera [Create]
    if (!message.includes('[Create]')) {
        return [];
    }
    
    const tasks = [];
    const lines = message.split('\n');
    
    // Regex do wykrywania bullet points (-, •, *)
    const bulletRegex = /^(\s*)([-•*])\s+(.+)$/;
    
    // Regex do wyodrębnienia przypisania: (Imię) lub (Imię Nazwisko)
    const assigneeRegex = /\(([^)]+)\)\s*$/;
    
    // Regex do wykrywania checkboxów: [ ], [x], [X]
    const checkboxRegex = /^\[([xX\s])\]\s*(.+)$/;
    
    let currentTask = null;
    let inCreateBlock = false;
    
    for (const line of lines) {
        // Sprawdź czy zaczyna się blok [Create]
        if (line.includes('[Create]')) {
            inCreateBlock = true;
            continue;
        }
        
        // Ignoruj linie przed [Create]
        if (!inCreateBlock) {
            continue;
        }
        
        // Sprawdź czy to bullet point
        const bulletMatch = line.match(bulletRegex);
        
        if (!bulletMatch) {
            // Pusta linia lub tekst bez bullet - kontynuuj
            continue;
        }
        
        const indent = bulletMatch[1].length;
        let content = bulletMatch[3].trim();
        
        // Poziom 1 (brak wcięcia lub małe) = Nowy task
        if (indent < 2) {
            // Zapisz poprzedni task jeśli istnieje
            if (currentTask) {
                tasks.push(currentTask);
            }
            
            // Wyodrębnij assignee
            let assigneeId = null;
            let assigneeName = null;
            
            const assigneeMatch = content.match(assigneeRegex);
            if (assigneeMatch) {
                assigneeName = assigneeMatch[1].trim();
                content = content.replace(assigneeRegex, '').trim();
                
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
                title: content,
                assigneeId: assigneeId,
                assigneeName: assigneeName,
                description: [],
                checkboxes: []
            };
        }
        // Poziom 2 (wcięcie 2-4 spacje) = Description
        else if (indent >= 2 && indent < 6 && currentTask) {
            // Sprawdź czy to checkbox
            const checkboxMatch = content.match(checkboxRegex);
            if (checkboxMatch) {
                const isChecked = checkboxMatch[1].toLowerCase() === 'x';
                const checkboxText = checkboxMatch[2].trim();
                currentTask.checkboxes.push({
                    text: checkboxText,
                    checked: isChecked
                });
            } else {
                currentTask.description.push(content);
            }
        }
        // Poziom 3+ (wcięcie 6+ spacji) = Checkboxy
        else if (indent >= 6 && currentTask) {
            // Sprawdź czy to checkbox
            const checkboxMatch = content.match(checkboxRegex);
            if (checkboxMatch) {
                const isChecked = checkboxMatch[1].toLowerCase() === 'x';
                const checkboxText = checkboxMatch[2].trim();
                currentTask.checkboxes.push({
                    text: checkboxText,
                    checked: isChecked
                });
            } else {
                // Traktuj jako checkbox bez znacznika
                currentTask.checkboxes.push({
                    text: content,
                    checked: false
                });
            }
        }
    }
    
    // Dodaj ostatni task
    if (currentTask) {
        tasks.push(currentTask);
    }
    
    return tasks;
}

/**
 * Buduje content karty dla Codecks (tytuł + opis + checkboxy)
 * 
 * @param {Object} task - Obiekt taska
 * @returns {string} Content do wysłania do Codecks
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
 * Normalizuje string do porównywania (lowercase, bez polskich znaków)
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
• \`!help\` - pokazuje przykład użycia z wyjaśnieniem

📝 *Atrybuty tasków:*
• \`[Create]\` - tworzy taski w Codecks`;
    }
    
    if (trimmed === '!help') {
        return `🤖 *Jak używać Codecks Bot:*

*Tworzenie tasków:*
\`\`\`
[Create]
• Nazwa taska (Owner)
   • Opis linijka 1
   • Opis linijka 2
      • [ ] Checkbox do zrobienia
      • [x] Checkbox już zrobiony
\`\`\`

*Struktura:*
• *Poziom 1* (bez wcięcia) → Nazwa taska + opcjonalnie (Właściciel)
• *Poziom 2* (wcięcie) → Opis taska
• *Poziom 3* (podwójne wcięcie) → Checkboxy

*Przykład:*
\`\`\`
[Create]
• Stwórz system walki (Tobiasz)
   • System ma obsługiwać multiplayer
   • Dodaj animacje
      • [ ] Idle animation
      • [ ] Attack animation
• Napraw bug z kolizjami (Anna)
   • Gracz przechodzi przez ściany
\`\`\`

*Wskazówki:*
• Możesz użyć \`-\`, \`•\` lub \`*\` jako bullet point
• Owner w nawiasie jest opcjonalny
• Checkboxy: \`[ ]\` = niezaznaczony, \`[x]\` = zaznaczony`;
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
