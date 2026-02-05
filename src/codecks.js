/**
 * Klient API Codecks v4.0.3
 * 
 * NAPRAWIONE na podstawie debug:
 * - users: pobierane przez ROLES (bezpośredni dostęp zwraca 500!)
 * - projects: id, name ✅
 * - decks: id, title ✅
 */

class CodecksClient {
    constructor(token, subdomain) {
        this.token = token;
        this.subdomain = subdomain;
        this.baseUrl = 'https://api.codecks.io';
    }
    
    /**
     * Wykonuje zapytanie do API
     */
    async request(endpoint, data) {
        const url = `${this.baseUrl}${endpoint}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': this.token,
                'X-Account': this.subdomain
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Codecks API Error (${response.status}): ${text}`);
        }
        
        return response.json();
    }
    
    /**
     * Tworzy nową kartę
     */
    async createCard(cardData) {
        const payload = {
            content: cardData.content,
            deckId: cardData.deckId,
            assigneeId: cardData.assigneeId || null,
            priority: cardData.priority || 'b',
            putOnHand: cardData.putOnHand || false,
            masterTags: cardData.tags || [],
            attachments: [],
            childCards: []
        };
        
        const result = await this.request('/dispatch/cards/create', payload);
        return result;
    }
    
    /**
     * Pobiera listę decków
     */
    async listDecks() {
        const query = {
            query: {
                "_root": [{
                    "account": [{
                        "decks": ["id", "title"]
                    }]
                }]
            }
        };
        
        const result = await this.request('/', query);
        return this.parseDecks(result);
    }
    
    /**
     * Pobiera listę decków z projektem
     */
    async listDecksWithSpaces() {
        const query = {
            query: {
                "_root": [{
                    "account": [{
                        "decks": [
                            "id", 
                            "title",
                            {"project": ["id", "name"]}
                        ]
                    }]
                }]
            }
        };
        
        const result = await this.request('/', query);
        return this.parseDecksWithProjects(result);
    }
    
    /**
     * Pobiera listę użytkowników PRZEZ ROLES
     * (bezpośredni dostęp do users zwraca 500!)
     */
    async listUsers() {
        const query = {
            query: {
                "_root": [{
                    "account": [{
                        "roles": [
                            "role",
                            {"user": ["id", "name"]}
                        ]
                    }]
                }]
            }
        };
        
        const result = await this.request('/', query);
        return this.parseUsersFromRoles(result);
    }
    
    /**
     * Pobiera listę projektów (spaces)
     */
    async listProjects() {
        const query = {
            query: {
                "_root": [{
                    "account": [{
                        "projects": ["id", "name"]
                    }]
                }]
            }
        };
        
        const result = await this.request('/', query);
        return this.parseProjects(result);
    }
    
    /**
     * Pobiera szczegóły konta
     */
    async getAccountInfo() {
        const query = {
            query: {
                "_root": [{
                    "account": ["id", "name"]
                }]
            }
        };
        
        const result = await this.request('/', query);
        
        // Parsuj odpowiedź
        if (result.account) {
            const accountId = result._root?.account;
            if (accountId && result.account[accountId]) {
                return result.account[accountId];
            }
            // Fallback
            const accounts = Object.values(result.account);
            if (accounts.length > 0) {
                return accounts[0];
            }
        }
        
        return null;
    }
    
    /**
     * Parsuje decks z odpowiedzi API
     */
    parseDecks(result) {
        const decks = [];
        
        if (result.deck) {
            for (const [id, data] of Object.entries(result.deck)) {
                decks.push({
                    id: data.id || id,
                    title: data.title,
                    name: data.title
                });
            }
        }
        
        return decks;
    }
    
    /**
     * Parsuje decks z projektami
     */
    parseDecksWithProjects(result) {
        const decks = [];
        
        if (result.deck) {
            for (const [id, data] of Object.entries(result.deck)) {
                // Znajdź projekt
                let projectId = data.project;
                let projectName = null;
                
                if (projectId && result.project && result.project[projectId]) {
                    projectName = result.project[projectId].name;
                }
                
                decks.push({
                    id: data.id || id,
                    title: data.title,
                    name: data.title,
                    projectId: projectId,
                    project: projectId ? { id: projectId, name: projectName } : null
                });
            }
        }
        
        return decks;
    }
    
    /**
     * Parsuje users z roles
     */
    parseUsersFromRoles(result) {
        const users = [];
        const seenIds = new Set();
        
        if (result.user) {
            for (const [id, data] of Object.entries(result.user)) {
                if (!seenIds.has(id)) {
                    seenIds.add(id);
                    users.push({
                        id: data.id || id,
                        name: data.name,
                        nickname: data.name,
                        username: data.name
                    });
                }
            }
        }
        
        return users;
    }
    
    /**
     * Parsuje projects
     */
    parseProjects(result) {
        const projects = [];
        
        if (result.project) {
            for (const [id, data] of Object.entries(result.project)) {
                projects.push({
                    id: data.id || id,
                    name: data.name,
                    title: data.name
                });
            }
        }
        
        return projects;
    }
    
    /**
     * Testuje połączenie
     */
    async testConnection() {
        try {
            const account = await this.getAccountInfo();
            if (account) {
                console.log(`✅ Połączenie z Codecks OK: ${account.name || this.subdomain}`);
                return true;
            }
            return false;
        } catch (error) {
            console.error(`❌ Błąd połączenia z Codecks: ${error.message}`);
            return false;
        }
    }
}

module.exports = { CodecksClient };
