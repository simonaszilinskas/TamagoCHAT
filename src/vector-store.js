// vectorStore.js
import { CreateMLCEngine } from "@mlc-ai/web-llm";

class VectorStore {
  constructor() {
    this.engine = null;
    this.embeddingCache = new Map(); // Cache embeddings in memory
    this.MODEL_DIM = 512; // Embedding dimension for Qwen model
  }

  async initModel(callback) {
    this.engine = await CreateMLCEngine("Qwen2-0.5B-Instruct-q4f16_1-MLC", {
      initProgressCallback: callback
    });
  }

  // Generate embeddings using the model
  async generateEmbedding(text) {
    if (this.embeddingCache.has(text)) {
      return this.embeddingCache.get(text);
    }

    // Use the model to generate embeddings
    const response = await this.engine.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "Generate a vector embedding for the following text. Respond only with the embedding vector."
        },
        {
          role: "user",
          content: text
        }
      ],
      temperature: 0,
      max_tokens: this.MODEL_DIM
    });

    // Convert model output to vector
    const embedding = this.parseEmbedding(response.choices[0].message.content);
    this.embeddingCache.set(text, embedding);
    return embedding;
  }

  // Parse model output into vector
  parseEmbedding(output) {
    // Initialize a zero vector
    const embedding = new Float32Array(this.MODEL_DIM);
    
    // Use model output to populate vector
    // This is a simplified implementation - you'd want to properly parse the model's output
    for (let i = 0; i < this.MODEL_DIM; i++) {
      embedding[i] = Math.random() * 2 - 1; // Placeholder for actual embedding values
    }
    
    return embedding;
  }

  // Compute cosine similarity between two vectors
  cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    
    return dotProduct / (normA * normB);
  }

  // Chunk text into smaller pieces
  chunkText(text, maxChunkSize = 512) {
    const sentences = text.split(/[.!?]+/).filter(Boolean);
    const chunks = [];
    let currentChunk = '';
    
    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > maxChunkSize) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += ' ' + sentence;
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }

  // Store text with its embedding
  async storeText(text, url, title) {
    const chunks = this.chunkText(text);
    const vectors = await this.getVectors();
    
    for (const chunk of chunks) {
      const embedding = await this.generateEmbedding(chunk);
      vectors.push({
        text: chunk,
        url,
        title,
        embedding: Array.from(embedding), // Convert to regular array for storage
        timestamp: Date.now()
      });
    }
    
    await chrome.storage.local.set({ vectors });
  }

  // Search for relevant text chunks
  async search(query, maxResults = 3) {
    const queryEmbedding = await this.generateEmbedding(query);
    const vectors = await this.getVectors();
    
    // Calculate similarities
    const similarities = vectors.map(vector => ({
      ...vector,
      similarity: this.cosineSimilarity(
        queryEmbedding,
        new Float32Array(vector.embedding)
      )
    }));
    
    // Sort by similarity and return top results
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxResults);
  }

  async getVectors() {
    const result = await chrome.storage.local.get('vectors');
    return result.vectors || [];
  }

  // Periodically clean up embedding cache
  cleanupCache(maxSize = 1000) {
    if (this.embeddingCache.size > maxSize) {
      const entries = Array.from(this.embeddingCache.entries());
      const sortedEntries = entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const entriesToRemove = sortedEntries.slice(0, entries.length - maxSize);
      
      for (const [key] of entriesToRemove) {
        this.embeddingCache.delete(key);
      }
    }
  }
}

export default new VectorStore();