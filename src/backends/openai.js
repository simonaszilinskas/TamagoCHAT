// src/backends/openai.js
class OpenAIBackend {
    constructor(apiKey) {
      this.apiKey = apiKey;
      this.baseUrl = 'https://api.openai.com/v1';
    }
  
    async embedQuery(text) {
      return this._createEmbedding(text);
    }
  
    async embedDocuments(texts) {
      // Batch the requests to avoid hitting rate limits
      const batchSize = 20;
      const batches = [];
      
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        batches.push(batch);
      }
  
      const embeddings = [];
      for (const batch of batches) {
        const batchEmbeddings = await Promise.all(
          batch.map(text => this._createEmbedding(text))
        );
        embeddings.push(...batchEmbeddings);
      }
  
      return embeddings;
    }
  
    async _createEmbedding(text) {
      try {
        const response = await fetch(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            input: text,
            model: 'text-embedding-ada-002',
            encoding_format: 'float'
          })
        });
  
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.error?.message || 
            `API request failed with status ${response.status}`
          );
        }
  
        const result = await response.json();
        
        if (!result.data?.[0]?.embedding) {
          throw new Error('Invalid embedding response format');
        }
  
        return result.data[0].embedding;
      } catch (error) {
        if (error.message.includes('API key')) {
          throw new Error('Invalid API key. Please check your OpenAI API key in the settings.');
        }
        throw error;
      }
    }
  
    async chat(messages) {
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages,
            temperature: 0.7
          })
        });
  
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.error?.message || 
            `API request failed with status ${response.status}`
          );
        }
  
        return await response.json();
      } catch (error) {
        if (error.message.includes('API key')) {
          throw new Error('Invalid API key. Please check your OpenAI API key in the settings.');
        }
        throw error;
      }
    }
  
    async verifyApiKey() {
      try {
        // Use a minimal embedding request to verify the key
        await this._createEmbedding('test');
        return true;
      } catch (error) {
        console.error('API key verification failed:', error);
        return false;
      }
    }
  }
  
  export default OpenAIBackend;