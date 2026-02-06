/**
 * Dynamic Mapping Cache v4.0
 * 
 * Fetches from Codecks API and caches: name → UUID
 * Handles:
 * - Spaces (Projects)
 * - Decks (with Space association)
 * - Users
 * 
 * Mappingi (SPACE_MAPPING, DECK_MAPPING, USER_MAPPING) to teraz tylko aliasy:
 * - Key = shortcut used in Slack
 * - Value = full name in Codecks
 * - Empty mapping {} = searches by name directly
 */

class MappingCache {
    constructor() {
        // Cache: name (lowercase) → UUID
        this.spaces = new Map();      // "ma txa" → "uuid-space"
        this.decks = new Map();       // "backlog" → { id: "uuid", spaceId: "uuid-space", spaceName: "MA TXA" }
        this.users = new Map();       // "tobiasz" → "uuid-user"
        
        // Reverse cache: UUID → name (for debugging)
        this.spaceNames = new Map();  // "uuid" → "MA TXA"
        this.deckNames = new Map();   // "uuid" → "Backlog"
        this.userNames = new Map();   // "uuid" → "Tobiasz"
        
        // Full deck paths: "space/deck" → UUID
        this.deckPaths = new Map();   // "ma txa/backlog" → "uuid-deck"
        
        // Status
        this.initialized = false;
        this.lastRefresh = null;
    }
    
    /**
     * Inicjalizuje cache - pobiera wszystkie dane z Codecks API
     */
    async initialize(codecksClient) {
        console.log('[Cache] Initializing...');
        
        try {
            // Pobierz spaces (projects)
            await this.loadSpaces(codecksClient);
            
            // Pobierz decks (z przypisaniem do spaces)
            await this.loadDecks(codecksClient);
            
            // Pobierz users
            await this.loadUsers(codecksClient);
            
            this.initialized = true;
            this.lastRefresh = new Date();
            
            console.log('[Cache] Ready:');
            console.log(`  Spaces: ${this.spaces.size}`);
            console.log(`  Decks: ${this.decks.size}`);
            console.log(`  Users: ${this.users.size}`);
            
            return true;
            
        } catch (error) {
            console.error('[Cache] Init error:', error.message);
            throw error;
        }
    }
    
    /**
     * Pobiera i cachuje spaces (projects)
     */
    async loadSpaces(codecksClient) {
        const projects = await codecksClient.listProjects();
        
        this.spaces.clear();
        this.spaceNames.clear();
        
        for (const project of projects) {
            const name = project.title || project.name;
            if (name && project.id) {
                const normalizedName = this.normalize(name);
                this.spaces.set(normalizedName, project.id);
                this.spaceNames.set(project.id, name);
            }
        }
        
        console.log(`[Cache] Loaded ${this.spaces.size} spaces`);
    }
    
    /**
     * Fetches and caches decks (with space association)
     */
    async loadDecks(codecksClient) {
        const decksData = await codecksClient.listDecksWithSpaces();
        
        this.decks.clear();
        this.deckNames.clear();
        this.deckPaths.clear();
        
        for (const deck of decksData) {
            const name = deck.title || deck.name;
            if (name && deck.id) {
                const normalizedName = this.normalize(name);
                
                // Handle various project formats:
                // - deck.project can be an object {id, name}
                // - deck.project can be a string (ID)
                // - deck.projectId can be a string (ID)
                let projectId = null;
                let spaceName = null;
                
                if (deck.project) {
                    if (typeof deck.project === 'object' && deck.project.id) {
                        // Format: {id: "...", name: "..."}
                        projectId = deck.project.id;
                        spaceName = deck.project.name || this.spaceNames.get(projectId);
                    } else if (typeof deck.project === 'string') {
                        // Format: just ID string
                        projectId = deck.project;
                        spaceName = this.spaceNames.get(projectId);
                    }
                } else if (deck.projectId) {
                    // Fallback do projectId
                    projectId = deck.projectId;
                    spaceName = this.spaceNames.get(projectId);
                }
                
                // Cache deck
                const deckInfo = {
                    id: deck.id,
                    spaceId: projectId,
                    spaceName: spaceName
                };
                
                // If deck name already exists, use full space/deck path
                if (this.decks.has(normalizedName)) {
                    // Same name in different space — keep first, require full path
                    
                } else {
                    this.decks.set(normalizedName, deckInfo);
                }
                
                this.deckNames.set(deck.id, name);
                
                // Full space/deck path
                if (spaceName) {
                    const fullPath = this.normalize(`${spaceName}/${name}`);
                    this.deckPaths.set(fullPath, deck.id);
                }
            }
        }
        
        console.log(`[Cache] Loaded ${this.decks.size} decks, ${this.deckPaths.size} paths`);
    }
    
    /**
     * Pobiera i cachuje users
     */
    async loadUsers(codecksClient) {
        const users = await codecksClient.listUsers();
        
        this.users.clear();
        this.userNames.clear();
        
        for (const user of users) {
            const name = user.nickname || user.username || user.name;
            if (name && user.id) {
                const normalizedName = this.normalize(name);
                this.users.set(normalizedName, user.id);
                this.userNames.set(user.id, name);
                
                // Also add username if different from nickname
                if (user.username && user.username !== name) {
                    this.users.set(this.normalize(user.username), user.id);
                }
            }
        }
        
        console.log(`[Cache] Loaded ${this.users.size} users`);
    }
    
    /**
     * Refreshes cache
     */
    async refresh(codecksClient) {
        console.log('[Cache] Refreshing...');
        return this.initialize(codecksClient);
    }
    
    /**
     * Resolvuje Space name do UUID
     * @param {string} input - nazwa ze Slacka lub alias
     * @param {object} aliasMapping - SPACE_MAPPING (alias → full name)
     */
    resolveSpace(input, aliasMapping = {}) {
        if (!input) return null;
        
        // 1. Check alias
        const resolvedName = this.resolveAlias(input, aliasMapping);
        
        // 2. Szukaj w cache
        const normalized = this.normalize(resolvedName);
        const spaceId = this.spaces.get(normalized);
        
        if (spaceId) {
            console.log(`[Resolve] Space: ${input} → ${spaceId}`);
            return spaceId;
        }
        
        console.warn(`[Resolve] Space not found: ${input}`);
        return null;
    }
    
    /**
     * Resolvuje Deck name do UUID
     * @param {string} input - name from Slack (can be "deck" or "space/deck")
     * @param {object} aliasMapping - DECK_MAPPING (alias → full name)
     * @param {object} spaceAliasMapping - SPACE_MAPPING (for resolving space in path)
     */
    resolveDeck(input, aliasMapping = {}, spaceAliasMapping = {}) {
        if (!input) return null;
        
        // 1. Check alias for full path
        let resolvedPath = this.resolveAlias(input, aliasMapping);
        
        // 2. Check if space/deck path
        if (resolvedPath.includes('/')) {
            const [spacePart, deckPart] = resolvedPath.split('/').map(s => s.trim());
            
            // Resolvuj space alias
            const resolvedSpace = this.resolveAlias(spacePart, spaceAliasMapping);
            
            // Look up full path
            const fullPath = this.normalize(`${resolvedSpace}/${deckPart}`);
            const deckId = this.deckPaths.get(fullPath);
            
            if (deckId) {
                console.log(`[Resolve] Deck: ${input} → ${deckId}`);
                return deckId;
            }
            
            // Fallback: szukaj tylko po nazwie decka
            const normalized = this.normalize(deckPart);
            const deckInfo = this.decks.get(normalized);
            
            if (deckInfo) {
                console.log(`[Resolve] Deck (fallback): ${deckPart} → ${deckInfo.id}`);
                return deckInfo.id;
            }
        } else {
            // Sama nazwa decka
            const normalized = this.normalize(resolvedPath);
            const deckInfo = this.decks.get(normalized);
            
            if (deckInfo) {
                console.log(`[Resolve] Deck: ${input} → ${deckInfo.id}`);
                return deckInfo.id;
            }
        }
        
        console.warn(`[Resolve] Deck not found: ${input}`);
        return null;
    }
    
    /**
     * Resolvuje User name do UUID
     * @param {string} input - nazwa ze Slacka lub alias
     * @param {object} aliasMapping - USER_MAPPING (alias → full name)
     */
    resolveUser(input, aliasMapping = {}) {
        if (!input) return null;
        
        // 1. Check alias
        const resolvedName = this.resolveAlias(input, aliasMapping);
        
        // 2. Szukaj w cache
        const normalized = this.normalize(resolvedName);
        const userId = this.users.get(normalized);
        
        if (userId) {
            console.log(`[Resolve] User: ${input} → ${userId}`);
            return userId;
        }
        
        // 3. Fuzzy matching — partial name match
        for (const [name, id] of this.users.entries()) {
            if (name.includes(normalized) || normalized.includes(name)) {
                console.log(`[Resolve] User (fuzzy): ${input} → ${id}`);
                return id;
            }
        }
        
        console.warn(`[Resolve] User not found: ${input}`);
        return null;
    }
    
    /**
     * Resolves alias to full name
     */
    resolveAlias(input, aliasMapping = {}) {
        if (!input) return input;
        
        // Szukaj w mapping (case-insensitive)
        const normalizedInput = this.normalize(input);
        
        for (const [alias, fullName] of Object.entries(aliasMapping)) {
            if (this.normalize(alias) === normalizedInput) {
                return fullName;
            }
        }
        
        // No alias — return original
        return input;
    }
    
    /**
     * Normalizes string for comparison
     */
    normalize(str) {
        if (!str) return '';
        return str
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')  // Remove diacritics
            .replace(/ł/g, 'l')
            .replace(/Ł/g, 'l')
            .trim();
    }
    
    /**
     * Zwraca statystyki cache
     */
    getStats() {
        return {
            initialized: this.initialized,
            lastRefresh: this.lastRefresh,
            spaces: this.spaces.size,
            decks: this.decks.size,
            deckPaths: this.deckPaths.size,
            users: this.users.size
        };
    }
    
    /**
     * Returns all spaces (for debugging)
     */
    listSpaces() {
        const result = [];
        for (const [name, id] of this.spaces.entries()) {
            result.push({ name: this.spaceNames.get(id), id });
        }
        return result;
    }
    
    /**
     * Returns all decks (for debugging)
     */
    listDecks() {
        const result = [];
        for (const [name, info] of this.decks.entries()) {
            result.push({ 
                name: this.deckNames.get(info.id), 
                id: info.id,
                space: info.spaceName
            });
        }
        return result;
    }
    
    /**
     * Returns all users (for debugging)
     */
    listUsers() {
        const result = [];
        const seen = new Set();
        for (const [name, id] of this.users.entries()) {
            if (!seen.has(id)) {
                result.push({ name: this.userNames.get(id), id });
                seen.add(id);
            }
        }
        return result;
    }
}

// Singleton instance
const mappingCache = new MappingCache();

module.exports = { MappingCache, mappingCache };
