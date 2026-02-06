/**
 * Slack Message Parser v5.3
 *
 * Reads event.blocks (rich_text) to preserve indent levels.
 * Falls back to event.text when blocks aren't available.
 *
 * Supported message formats:
 *
 *   [Create] [Deck: Space/Deck]
 *   Owner:
 *   • Task title          (indent 0 → card title)
 *      • Description       (indent 1 → card body)
 *         • Sub-bullet     (indent 2 → "- text" in body)
 *      • [ ] Checkbox      (indent 1 → checkbox)
 *   • Next task
 *
 * Both "•" (Slack bullet list) and "- " (plain text dash) are recognized.
 * Owner can be "Name:" or just "Name" on its own line before tasks.
 * Inline "(Owner)" at end of bullet also works and overrides header.
 */

const assigneeRegex = /\(([^)]+)\)\s*$/;
const checkboxRegex = /^\[([xX\s]?)\]\s*(.*)$/;
const textBulletRegex = /^(\s*)([-•◦*‣])\s+(.+)$/;

// --- Text extraction from rich_text elements ---

function extractText(elements) {
    if (!elements || !Array.isArray(elements)) return '';
    return elements.map(el => {
        switch (el.type) {
            case 'text':    return el.text || '';
            case 'link':    return el.text || el.url || '';
            case 'emoji':   return el.unicode ? String.fromCodePoint(parseInt(el.unicode, 16)) : `:${el.name}:`;
            case 'user':    return `<@${el.user_id}>`;
            case 'channel': return `<#${el.channel_id}>`;
            default:        return el.text || '';
        }
    }).join('');
}

// --- Main entry point ---

function parseTaskMessage(text, blocks) {
    const messageText = text || '';
    if (!messageText.includes('[Create]')) {
        return { tasks: [], deckPath: null, blocks: [] };
    }

    if (blocks && Array.isArray(blocks) && blocks.length > 0) {
        return parseFromBlocks(blocks);
    }

    return parseFromText(messageText);
}

// ============================================================
// Block-based parser (primary — reads event.blocks)
// ============================================================

function parseFromBlocks(blocks) {
    const allTasks = [];
    let firstDeckPath = null;

    for (const block of blocks) {
        if (block.type !== 'rich_text') continue;

        const flatItems = flattenRichTextBlock(block);
        const createSections = splitByCreate(flatItems);

        for (const section of createSections) {
            const { tasks, deckPath } = parseCreateSection(section);
            if (firstDeckPath === null && deckPath) firstDeckPath = deckPath;
            for (const task of tasks) {
                task.deckPath = deckPath;
                allTasks.push(task);
            }
        }
    }

    console.log(`[Parser] Parsed ${allTasks.length} task(s) from blocks`);
    return { tasks: allTasks, deckPath: firstDeckPath, blocks: [] };
}

/**
 * Flattens a rich_text block into a list of { text, indent, isList } items.
 * Handles both rich_text_list (Slack bullet UI) and plain text with "- " dashes.
 */
function flattenRichTextBlock(block) {
    const items = [];
    if (!block.elements) return items;

    for (const element of block.elements) {
        if (element.type === 'rich_text_section') {
            const text = extractText(element.elements).trim();
            for (const line of text.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                const m = line.match(textBulletRegex);
                if (m) {
                    const spaces = m[1].length;
                    const indent = spaces <= 1 ? 0 : spaces <= 4 ? 1 : 2;
                    items.push({ text: m[3].trim(), indent, isList: true, listStyle: 'bullet' });
                } else {
                    items.push({ text: trimmed, indent: -1, isList: false });
                }
            }

        } else if (element.type === 'rich_text_list') {
            const indent = element.indent || 0;
            const style = element.style || 'bullet';
            if (!element.elements) continue;

            for (const li of element.elements) {
                if (li.type === 'rich_text_section') {
                    items.push({ text: extractText(li.elements).trim(), indent, isList: true, listStyle: style });
                }
            }
        }
    }

    return items;
}

/** Splits flat items into sections, one per [Create] command. */
function splitByCreate(items) {
    const sections = [];
    let cur = null;

    for (const item of items) {
        if (item.text.includes('[Create]')) {
            if (cur) sections.push(cur);
            cur = { createLine: item.text, items: [] };
        } else if (cur) {
            cur.items.push(item);
        }
    }

    if (cur) sections.push(cur);
    return sections;
}

// --- Owner header detection ---

function isOwnerHeader(text) {
    if (!text || text.includes('[') || text.includes(']')) return false;
    const t = text.trim();
    if (!t || t.length > 50) return false;
    return /^[\p{L}\p{M}\s.'-]+:?\s*$/u.test(t);
}

function extractOwnerName(text) {
    return text.trim().replace(/:+\s*$/, '').trim();
}

// --- Section parser (shared logic) ---

function parseCreateSection(section) {
    let deckPath = null;
    const dm = section.createLine.match(/\[Deck:\s*([^\]]+)\]/i);
    if (dm) deckPath = dm[1].trim();

    const tasks = [];
    let currentTask = null;
    let currentOwner = null;
    let lastIndent = -1;

    for (const item of section.items) {

        // Plain text → check if it's an owner header
        if (!item.isList) {
            if (isOwnerHeader(item.text)) {
                if (currentTask) { tasks.push(currentTask); currentTask = null; }
                currentOwner = extractOwnerName(item.text);
                lastIndent = -1;
            }
            continue;
        }

        const { indent, text: content } = item;
        if (!content) continue;

        if (indent === 0) {
            // New task (title)
            if (currentTask) tasks.push(currentTask);

            let title = content;
            let assignee = currentOwner;
            const am = title.match(assigneeRegex);
            if (am) {
                assignee = am[1].trim();
                title = title.replace(assigneeRegex, '').trim();
            }

            currentTask = { title, assigneeName: assignee, description: [], checkboxes: [] };
            lastIndent = 0;

        } else if (indent === 1 && currentTask) {
            // Description or checkbox; insert blank line when returning from deeper indent
            if (lastIndent >= 2) currentTask.description.push('');

            const cm = content.match(checkboxRegex);
            if (cm) {
                currentTask.checkboxes.push({ text: cm[2].trim(), checked: cm[1].toLowerCase() === 'x' });
            } else {
                currentTask.description.push(content);
            }
            lastIndent = 1;

        } else if (indent >= 2 && currentTask) {
            // Sub-bullet → prefixed with "- " in card body
            const cm = content.match(checkboxRegex);
            if (cm) {
                currentTask.checkboxes.push({ text: cm[2].trim(), checked: cm[1].toLowerCase() === 'x' });
            } else {
                currentTask.description.push('- ' + content);
            }
            lastIndent = indent;
        }
    }

    if (currentTask) tasks.push(currentTask);
    return { tasks, deckPath };
}

// ============================================================
// Text-based parser (fallback — reads event.text)
// ============================================================

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

    console.log(`[Parser] Parsed ${allTasks.length} task(s) from text fallback`);
    return { tasks: allTasks, deckPath: firstDeckPath, blocks: [] };
}

function splitIntoCreateBlocks(message) {
    const blocks = [];
    const lines = message.split('\n');
    let cur = [];
    let active = false;

    for (const line of lines) {
        if (line.includes('[Create]')) {
            if (cur.length > 0) blocks.push(cur.join('\n'));
            cur = [line];
            active = true;
        } else if (active) {
            cur.push(line);
        }
    }
    if (cur.length > 0) blocks.push(cur.join('\n'));
    return blocks;
}

function parseCreateBlockText(blockText) {
    const lines = blockText.split('\n');

    let deckPath = null;
    const dm = blockText.match(/\[Deck:\s*([^\]]+)\]/i);
    if (dm) deckPath = dm[1].trim();

    const tasks = [];
    let currentTask = null;
    let currentOwner = null;
    let lastIndent = -1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed) continue;

        const bm = line.match(bulletRegex);

        if (!bm) {
            if (textOwnerRegex.test(trimmed) && !trimmed.includes('[')) {
                if (currentTask) { tasks.push(currentTask); currentTask = null; }
                currentOwner = trimmed.replace(/:+\s*$/, '').trim();
                lastIndent = -1;
            }
            continue;
        }

        const indent = bm[1].length;
        const content = bm[3].trim();
        const level = indent <= 1 ? 0 : indent <= 4 ? 1 : 2;

        if (level === 0) {
            if (currentTask) tasks.push(currentTask);
            let title = content;
            let assignee = currentOwner;
            const am = title.match(assigneeRegex);
            if (am) { assignee = am[1].trim(); title = title.replace(assigneeRegex, '').trim(); }
            currentTask = { title, assigneeName: assignee, description: [], checkboxes: [] };
            lastIndent = 0;

        } else if (level === 1 && currentTask) {
            if (lastIndent >= 2) currentTask.description.push('');
            const cm = content.match(checkboxRegex);
            if (cm) {
                currentTask.checkboxes.push({ text: cm[2].trim(), checked: cm[1].toLowerCase() === 'x' });
            } else {
                currentTask.description.push(content);
            }
            lastIndent = 1;

        } else if (level >= 2 && currentTask) {
            const cm = content.match(checkboxRegex);
            if (cm) {
                currentTask.checkboxes.push({ text: cm[2].trim(), checked: cm[1].toLowerCase() === 'x' });
            } else {
                currentTask.description.push('- ' + content);
            }
            lastIndent = level;
        }
    }

    if (currentTask) tasks.push(currentTask);
    return { tasks, deckPath };
}

// ============================================================
// Card content builder
// ============================================================

/**
 * Builds the card content string for Codecks API.
 * First line becomes the card title.
 */
function buildCardContent(task) {
    let content = task.title;

    if (task.description && task.description.length > 0) {
        content += '\n\n' + task.description.join('\n');
    }

    if (task.checkboxes && task.checkboxes.length > 0) {
        content += '\n';
        for (const cb of task.checkboxes) {
            content += `\n- [${cb.checked ? 'x' : ' '}] ${cb.text}`;
        }
    }

    return content;
}

// ============================================================
// Utility functions
// ============================================================

function normalizeString(str) {
    return str.toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ł/g, 'l').replace(/Ł/g, 'L')
        .trim();
}

function isCommand(message) {
    if (!message || typeof message !== 'string') return false;
    const t = message.trim().toLowerCase();
    return t === '!help' || t === '!commands' || t === '!status' || t === '!refresh';
}

function hasCreateCommand(message) {
    return message && message.includes('[Create]');
}

function getCommandResponse(message, cacheStats = null) {
    const t = message.trim().toLowerCase();

    if (t === '!commands') {
        return `📋 *Available commands:*

• \`!commands\` — show this list
• \`!help\` — usage example
• \`!status\` — cache status
• \`!refresh\` — refresh cache

📝 *Attributes:*
• \`[Create]\` — create cards in Codecks
• \`[Deck: name]\` — target deck
• \`[Deck: Space/Deck]\` — target deck in a specific space`;
    }

    if (t === '!status') {
        if (cacheStats) {
            return `🔄 *Cache Status:*

• 📂 Spaces: ${cacheStats.spaces}
• 🎴 Decks: ${cacheStats.decks}
• 🛤️ Deck paths: ${cacheStats.deckPaths}
• 👥 Users: ${cacheStats.users}
• ⏰ Last refresh: ${cacheStats.lastRefresh ? new Date(cacheStats.lastRefresh).toISOString() : 'never'}`;
        }
        return '⚠️ Cache not initialized';
    }

    if (t === '!help') {
        return `🤖 *Codecks Bot v5.3*

\`\`\`
[Create] [Deck: Space/Deck]

Tomek:
• Task 1
   • Description line
   • [ ] Checkbox
      • Sub-bullet (becomes "- " in Codecks)
   • Another line
• Task 2

Tobiasz:
• Task 3
   • Description
\`\`\`

You can also use dashes:
\`\`\`
Tomek:
- Task 1
   - Description
- Task 2
\`\`\`

*Owner:* plain text before bullets assigns all tasks below
*Indent levels:*
• \`• text\` — new card (title)
• \`   • text\` — card description
• \`      • text\` — "- text" sub-bullet in description
• \`   • [ ] text\` — checkbox`;
    }

    return null;
}

// ============================================================
// Exports
// ============================================================

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
