// src/embeddings.js

export class WebLLMEmbeddings {
    constructor(engine, modelId) {
      this.engine = engine;
      this.modelId = modelId;
    }
  
    async embedQuery(text) {
      return this._embed([text]).then(embeddings => embeddings[0]);
    }
  
    async embedDocuments(texts) {
      return this._embed(texts);
    }
  
    async _embed(texts) {
      const formattedTexts = texts.map(text => `[CLS] ${text} [SEP]`);
      const reply = await this.engine.embeddings.create({
        input: formattedTexts,
        model: this.modelId
      });
      return reply.data.map(item => item.embedding);
    }
  }