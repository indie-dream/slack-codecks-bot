/**
 * Dynamic Mapping Cache v4.0
 * 
 * Pobiera z Codecks API i cachuje: nazwa → UUID
 * Obsługuje:
 * - Spaces (Projects)
 * - Decks (z powiązaniem do Space)
 * - Users
 * 
 * Mappingi (SPACE_MAPPING, DECK_MAPPING, USER_MAPPING) to teraz tylko aliasy:
 * - Klucz = skrót używany w Slacku
 * - Wartość = pełna nazwa w Codecks
 * - Pusty mapping {} = szuka bezpośrednio po nazwie
 */

class MappingCache {
    constructor() {
        // Cache: nazwa (lowercase) → UUID
        this.spaces = new Map();      // "ma txa" → "uuid-space"
        this.decks = new Map();       // "backlog" → { id: "uuid", spaceId: "uuid-space", spaceName: "MA TXA" }
        this.users = new Map();       // "tobiasz" → "uuid-user"
        
        // Reverse cache: UUID → nazwa (dla debugowania)
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
        console.log('🔄 Inicjalizacja cache mappingów...');
        
        try {
            // Pobierz spaces (projects)
            await this.loadSpaces(codecksClient);
            
            // Pobierz decks (z przypisaniem do spaces)
            await this.loadDecks(codecksClient);
            
            // Pobierz users
            await this.loadUsers(codecksClient);
            
            this.initialized = true;
            this.lastRefresh = new Date();
            
            console.log(`✅ Cache zainicjalizowany:`);
            console.log(`   📂 Spaces: ${this.spaces.size}`);
            console.log(`   🎴 Decks: ${this.decks.size}`);
            console.log(`   👥 Users: ${this.users.size}`);
            
            return true;
            
        } catch (error) {
            console.error('❌ Błąd inicjalizacji cache:', error.message);
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
        
        console.log(`   📂 Załadowano ${this.spaces.size} space(ów)`);
    }
    
    /**
     * Pobiera i cachuje decks (z powiązaniem do spaces)
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
                
                // Obsłuż różne formaty project:
                // - deck.project może być obiektem {id, name}
                // - deck.project może być stringiem (ID)
                // - deck.projectId może być stringiem (ID) z naszego mapowania
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
                
                // Jeśli deck o tej nazwie już istnieje, użyj ścieżki space/deck
                if (this.decks.has(normalizedName)) {
                    // Deck z tą samą nazwą w innym space - nie nadpisuj
                    // Użytkownik musi użyć pełnej ścieżki
                } else {
                    this.decks.set(normalizedName, deckInfo);
                }
                
                this.deckNames.set(deck.id, name);
                
                // Pełna ścieżka space/deck
                if (spaceName) {
                    const fullPath = this.normalize(`${spaceName}/${name}`);
                    this.deckPaths.set(fullPath, deck.id);
                }
            }
        }
        
        console.log(`   🎴 Załadowano ${this.decks.size} deck(ów), ${this.deckPaths.size} ścieżek`);
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
                
                // Dodaj też username jeśli inny niż nickname
                if (user.username && user.username !== name) {
                    this.users.set(this.normalize(user.username), user.id);
                }
            }
        }
        
        console.log(`   👥 Załadowano ${this.users.size} user(ów)`);
    }
    
    /**
     * Odświeża cache
     */
    async refresh(codecksClient) {
        console.log('🔄 Odświeżanie cache...');
        return this.initialize(codecksClient);
    }
    
    /**
     * Resolvuje Space name do UUID
     * @param {string} input - nazwa ze Slacka lub alias
     * @param {object} aliasMapping - SPACE_MAPPING (alias → pełna nazwa)
     */
    resolveSpace(input, aliasMapping = {}) {
        if (!input) return null;
        
        // 1. Sprawdź alias
        const resolvedName = this.resolveAlias(input, aliasMapping);
        
        // 2. Szukaj w cache
        const normalized = this.normalize(resolvedName);
        const spaceId = this.spaces.get(normalized);
        
        if (spaceId) {
            console.log(`   📂 Space: "${input}" → "${resolvedName}" → ${spaceId}`);
            return spaceId;
        }
        
        console.log(`   ⚠️ Space nie znaleziony: "${input}"`);
        return null;
    }
    
    /**
     * Resolvuje Deck name do UUID
     * @param {string} input - nazwa ze Slacka (może być "deck" lub "space/deck")
     * @param {object} aliasMapping - DECK_MAPPING (alias → pełna nazwa)
     * @param {object} spaceAliasMapping - SPACE_MAPPING (dla resolvowania space w ścieżce)
     */
    resolveDeck(input, aliasMapping = {}, spaceAliasMapping = {}) {
        if (!input) return null;
        
        // 1. Sprawdź alias dla całej ścieżki
        let resolvedPath = this.resolveAlias(input, aliasMapping);
        
        // 2. Sprawdź czy to ścieżka space/deck
        if (resolvedPath.includes('/')) {
            const [spacePart, deckPart] = resolvedPath.split('/').map(s => s.trim());
            
            // Resolvuj space alias
            const resolvedSpace = this.resolveAlias(spacePart, spaceAliasMapping);
            
            // Szukaj po pełnej ścieżce
            const fullPath = this.normalize(`${resolvedSpace}/${deckPart}`);
            const deckId = this.deckPaths.get(fullPath);
            
            if (deckId) {
                console.log(`   🎴 Deck: "${input}" → "${resolvedSpace}/${deckPart}" → ${deckId}`);
                return deckId;
            }
            
            // Fallback: szukaj tylko po nazwie decka
            const normalized = this.normalize(deckPart);
            const deckInfo = this.decks.get(normalized);
            
            if (deckInfo) {
                console.log(`   🎴 Deck (fallback): "${deckPart}" → ${deckInfo.id}`);
                return deckInfo.id;
            }
        } else {
            // Sama nazwa decka
            const normalized = this.normalize(resolvedPath);
            const deckInfo = this.decks.get(normalized);
            
            if (deckInfo) {
                console.log(`   🎴 Deck: "${input}" → "${resolvedPath}" → ${deckInfo.id}`);
                return deckInfo.id;
            }
        }
        
        console.log(`   ⚠️ Deck nie znaleziony: "${input}"`);
        return null;
    }
    
    /**
     * Resolvuje User name do UUID
     * @param {string} input - nazwa ze Slacka lub alias
     * @param {object} aliasMapping - USER_MAPPING (alias → pełna nazwa)
     */
    resolveUser(input, aliasMapping = {}) {
        if (!input) return null;
        
        // 1. Sprawdź alias
        const resolvedName = this.resolveAlias(input, aliasMapping);
        
        // 2. Szukaj w cache
        const normalized = this.normalize(resolvedName);
        const userId = this.users.get(normalized);
        
        if (userId) {
            console.log(`   👤 User: "${input}" → "${resolvedName}" → ${userId}`);
            return userId;
        }
        
        // 3. Fuzzy matching - szukaj częściowego dopasowania
        for (const [name, id] of this.users.entries()) {
            if (name.includes(normalized) || normalized.includes(name)) {
                console.log(`   👤 User (fuzzy): "${input}" → ${name} → ${id}`);
                return id;
            }
        }
        
        console.log(`   ⚠️ User nie znaleziony: "${input}"`);
        return null;
    }
    
    /**
     * Resolvuje alias do pełnej nazwy
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
        
        // Brak aliasu - zwróć oryginał
        return input;
    }
    
    /**
     * Normalizuje string do porównywania
     */
    normalize(str) {
        if (!str) return '';
        return str
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')  // Usuń akcenty
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
     * Zwraca listę wszystkich spaces (do debugowania)
     */
    listSpaces() {
        const result = [];
        for (const [name, id] of this.spaces.entries()) {
            result.push({ name: this.spaceNames.get(id), id });
        }
        return result;
    }
    
    /**
     * Zwraca listę wszystkich decks (do debugowania)
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
     * Zwraca listę wszystkich users (do debugowania)
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
