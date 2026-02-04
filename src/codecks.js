/**
 * Klient API Codecks
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
     * Wykonuje zapytanie GraphQL
     */
    async graphql(query) {
        const response = await fetch(`https://${this.subdomain}.codecks.io/api/v1/graphql`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `at=${this.token}`
            },
            body: JSON.stringify({ query })
        });
        
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Codecks GraphQL Error (${response.status}): ${text}`);
        }
        
        const result = await response.json();
        
        if (result.errors) {
            throw new Error(`GraphQL Error: ${JSON.stringify(result.errors)}`);
        }
        
        return result.data;
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
     * Pobiera listę decków z UUID
     */
    async listDecks() {
        try {
            const data = await this.graphql(`
                query {
                    account {
                        decks {
                            id
                            title
                            slug
                        }
                    }
                }
            `);
            
            return data?.account?.decks || [];
        } catch (error) {
            console.error('GraphQL failed, trying REST API...', error.message);
            
            // Fallback do REST API
            const query = {
                query: {
                    "_root": [{
                        "account": [{
                            "decks": ["id", "title", "seq"]
                        }]
                    }]
                }
            };
            
            const result = await this.request('/', query);
            return result?.account?.decks || [];
        }
    }
    
    /**
     * Pobiera listę użytkowników
     */
    async listUsers() {
        try {
            const data = await this.graphql(`
                query {
                    account {
                        users {
                            id
                            username
                            displayName
                            email
                        }
                    }
                }
            `);
            
            return data?.account?.users || [];
        } catch (error) {
            console.error('GraphQL failed, trying REST API...', error.message);
            
            // Fallback do REST API
            const query = {
                query: {
                    "_root": [{
                        "account": [{
                            "users": ["id", "nickname", "name", "email"]
                        }]
                    }]
                }
            };
            
            const result = await this.request('/', query);
            
            // Mapuj stare nazwy pól na nowe
            const users = result?.account?.users || [];
            return users.map(u => ({
                id: u.id,
                username: u.nickname,
                displayName: u.name,
                email: u.email
            }));
        }
    }
}

module.exports = { CodecksClient };
