/**
 * Klient API Codecks
 * Obsługa komunikacji z API Codecks do tworzenia kart
 */

const axios = require('axios');

/**
 * Klient do komunikacji z Codecks API
 */
class CodecksClient {
    /**
     * @param {string} token - Token autoryzacyjny (z cookie 'at')
     * @param {string} subdomain - Subdomena organizacji (np. 'mojaorganizacja')
     */
    constructor(token, subdomain) {
        if (!token) {
            throw new Error('Codecks token jest wymagany');
        }
        if (!subdomain) {
            throw new Error('Codecks subdomain jest wymagany');
        }
        
        this.token = token;
        this.subdomain = subdomain;
        this.baseUrl = 'https://api.codecks.io';
        
        // Konfiguracja axios
        this.client = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'X-Auth-Token': this.token,
                'X-Account': this.subdomain,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });
        
        // Cache użytkowników (ładowany lazy)
        this._usersCache = null;
        this._decksCache = null;
    }
    
    /**
     * Wykonuje zapytanie GraphQL-like do Codecks
     * 
     * @param {Object} query - Obiekt zapytania
     * @returns {Promise<Object>} Wynik zapytania
     */
    async query(queryObj) {
        try {
            const response = await this.client.post('/', {
                query: queryObj
            });
            
            return response.data;
        } catch (error) {
            this._handleError(error);
        }
    }
    
    /**
     * Tworzy nową kartę w Codecks
     * 
     * @param {Object} cardData - Dane karty
     * @param {string} cardData.content - Treść karty (tytuł + opis)
     * @param {string} cardData.deckId - ID decka docelowego
     * @param {string|null} cardData.assigneeId - ID przypisanego użytkownika
     * @param {string} cardData.priority - Priorytet (a/b/c/d)
     * @param {boolean} cardData.putOnHand - Czy dodać na rękę użytkownika
     * @param {string|null} cardData.milestoneId - ID milestone'a
     * @param {Array} cardData.masterTags - Lista tagów
     * @returns {Promise<Object>} Utworzona karta
     */
    async createCard(cardData) {
        try {
            const payload = {
                content: cardData.content,
                deckId: cardData.deckId || null,
                assigneeId: cardData.assigneeId || null,
                priority: cardData.priority || 'b',
                putOnHand: cardData.putOnHand || false,
                milestoneId: cardData.milestoneId || null,
                masterTags: cardData.masterTags || [],
                attachments: cardData.attachments || [],
                effort: cardData.effort || null,
                childCards: []
            };
            
            const response = await this.client.post('/dispatch/cards/create', payload);
            
            console.log(`📝 Karta utworzona: ${response.data.id || 'success'}`);
            
            return {
                id: response.data.id || response.data,
                success: true,
                ...payload
            };
            
        } catch (error) {
            this._handleError(error);
        }
    }
    
    /**
     * Pobiera listę decków
     * 
     * @param {boolean} useCache - Czy użyć cache
     * @returns {Promise<Array>} Lista decków
     */
    async getDecks(useCache = true) {
        if (useCache && this._decksCache) {
            return this._decksCache;
        }
        
        const result = await this.query({
            _root: [{
                account: [{
                    decks: ['id', 'title', 'cardCount']
                }]
            }]
        });
        
        this._decksCache = result._root?.account?.decks || [];
        return this._decksCache;
    }
    
    /**
     * Pobiera listę użytkowników
     * 
     * @param {boolean} useCache - Czy użyć cache
     * @returns {Promise<Array>} Lista użytkowników
     */
    async getUsers(useCache = true) {
        if (useCache && this._usersCache) {
            return this._usersCache;
        }
        
        const result = await this.query({
            _root: [{
                account: [{
                    users: ['id', 'username', 'fullName', 'email']
                }]
            }]
        });
        
        this._usersCache = result._root?.account?.users || [];
        return this._usersCache;
    }
    
    /**
     * Szuka użytkownika po nazwie/nazwisku
     * 
     * @param {string} name - Imię, nazwisko lub username
     * @returns {Promise<Object|null>} Znaleziony użytkownik lub null
     */
    async findUserByName(name) {
        const users = await this.getUsers();
        const normalizedName = name.toLowerCase().trim();
        
        return users.find(user => {
            const fullName = (user.fullName || '').toLowerCase();
            const username = (user.username || '').toLowerCase();
            
            return fullName.includes(normalizedName) || 
                   username.includes(normalizedName) ||
                   normalizedName.includes(fullName) ||
                   normalizedName.includes(username);
        }) || null;
    }
    
    /**
     * Pobiera karty z decka
     * 
     * @param {string} deckId - ID decka
     * @param {Object} options - Opcje zapytania
     * @returns {Promise<Array>} Lista kart
     */
    async getCardsFromDeck(deckId, options = {}) {
        const limit = options.limit || 50;
        const order = options.order || 'createdAt';
        
        const queryStr = `{"deckId": "${deckId}", "$order": "${order}", "$limit": ${limit}}`;
        
        const result = await this.query({
            _root: [{
                account: [{
                    [`cards(${queryStr})`]: ['id', 'title', 'content', 'status', 'assigneeId', 'priority']
                }]
            }]
        });
        
        // Klucz dynamiczny w odpowiedzi
        const cardsKey = Object.keys(result._root?.account || {}).find(k => k.startsWith('cards'));
        return result._root?.account?.[cardsKey] || [];
    }
    
    /**
     * Pobiera informacje o koncie (weryfikacja połączenia)
     * 
     * @returns {Promise<Object>} Dane konta
     */
    async getAccountInfo() {
        const result = await this.query({
            _root: [{
                account: ['name', 'id']
            }]
        });
        
        return result._root?.account || {};
    }
    
    /**
     * Testuje połączenie z API
     * 
     * @returns {Promise<boolean>} Czy połączenie działa
     */
    async testConnection() {
        try {
            const account = await this.getAccountInfo();
            console.log(`✅ Połączono z Codecks: ${account.name}`);
            return true;
        } catch (error) {
            console.error(`❌ Błąd połączenia z Codecks:`, error.message);
            return false;
        }
    }
    
    /**
     * Generuje mapowanie użytkowników (helper)
     * 
     * @returns {Promise<Object>} Obiekt mapowania { "imię nazwisko": "userId" }
     */
    async generateUserMapping() {
        const users = await this.getUsers();
        const mapping = {};
        
        for (const user of users) {
            if (user.fullName) {
                // Pełne imię i nazwisko
                mapping[user.fullName.toLowerCase()] = user.id;
                
                // Samo imię (pierwsze słowo)
                const firstName = user.fullName.split(' ')[0];
                if (firstName) {
                    mapping[firstName.toLowerCase()] = user.id;
                }
                
                // Imię + pierwsza litera nazwiska (np. "Janek X")
                const parts = user.fullName.split(' ');
                if (parts.length >= 2) {
                    const shortForm = `${parts[0]} ${parts[1][0]}`.toLowerCase();
                    mapping[shortForm] = user.id;
                }
            }
            
            if (user.username) {
                mapping[user.username.toLowerCase()] = user.id;
            }
        }
        
        return mapping;
    }
    
    /**
     * Obsługa błędów API
     * 
     * @param {Error} error - Błąd
     * @throws {Error} Przetworzony błąd
     */
    _handleError(error) {
        if (error.response) {
            const status = error.response.status;
            const data = error.response.data;
            
            switch (status) {
                case 401:
                    throw new Error('Codecks: Nieautoryzowany - sprawdź token');
                case 403:
                    throw new Error('Codecks: Brak dostępu - sprawdź uprawnienia');
                case 404:
                    throw new Error('Codecks: Nie znaleziono - sprawdź subdomain');
                case 429:
                    throw new Error('Codecks: Rate limit - za dużo requestów');
                default:
                    throw new Error(`Codecks API Error (${status}): ${JSON.stringify(data)}`);
            }
        } else if (error.request) {
            throw new Error('Codecks: Brak odpowiedzi z serwera - sprawdź połączenie');
        } else {
            throw error;
        }
    }
    
    /**
     * Czyści cache
     */
    clearCache() {
        this._usersCache = null;
        this._decksCache = null;
    }
}

// === HELPER FUNCTIONS ===

/**
 * Tworzy klienta Codecks z zmiennych środowiskowych
 * 
 * @returns {CodecksClient}
 */
function createClientFromEnv() {
    const token = process.env.CODECKS_TOKEN;
    const subdomain = process.env.CODECKS_SUBDOMAIN;
    
    if (!token || !subdomain) {
        throw new Error('Brak CODECKS_TOKEN lub CODECKS_SUBDOMAIN w zmiennych środowiskowych');
    }
    
    return new CodecksClient(token, subdomain);
}

// Eksport
module.exports = {
    CodecksClient,
    createClientFromEnv
};

// Test CLI
if (require.main === module) {
    require('dotenv').config({ path: '../.env' });
    
    async function runTest() {
        console.log('🧪 Testowanie klienta Codecks...\n');
        
        try {
            const client = createClientFromEnv();
            
            // Test połączenia
            const connected = await client.testConnection();
            if (!connected) return;
            
            // Pobranie użytkowników
            console.log('\n👥 Użytkownicy:');
            const users = await client.getUsers();
            users.forEach(u => console.log(`  - ${u.fullName || u.username} (${u.id})`));
            
            // Pobranie decków
            console.log('\n📚 Decki:');
            const decks = await client.getDecks();
            decks.forEach(d => console.log(`  - ${d.title} (${d.id}) - ${d.cardCount} kart`));
            
            // Generowanie mapowania
            console.log('\n🗺️ Sugerowane mapowanie użytkowników:');
            const mapping = await client.generateUserMapping();
            console.log(JSON.stringify(mapping, null, 2));
            
        } catch (error) {
            console.error('❌ Błąd:', error.message);
        }
    }
    
    runTest();
}
