// knowledge.js
import * as webllm from "@mlc-ai/web-llm";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { PromptTemplate } from "@langchain/core/prompts";
import {
  RunnableSequence,
  RunnablePassthrough,
} from "@langchain/core/runnables";
import { formatDocumentsAsString } from "langchain/util/document";

class WebLLMEmbeddings {
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

class Knowledge {
  constructor() {
    this.engine = null;
    this.vectorStore = null;
    this.embeddings = null;
    this.isInitialized = false;
    this.initPromise = null;
    this.EMBEDDING_MODEL = "snowflake-arctic-embed-m-q0f32-MLC-b4";
    this.LLM_MODEL = "Qwen2-0.5B-Instruct-q4f16_1-MLC";
    this.pendingDocuments = [];
  }

  async _initializeIfNeeded(callback) {
    if (this.isInitialized) return;
    
    if (!this.initPromise) {
      this.initPromise = this._initialize(callback);
    }
    
    await this.initPromise;
  }

  async _initialize(callback) {
    try {
      // Initialize engine with both models
      this.engine = await webllm.CreateMLCEngine(
        [this.EMBEDDING_MODEL, this.LLM_MODEL],
        {
          initProgressCallback: callback,
          logLevel: "INFO"
        }
      );

      // Initialize embeddings
      this.embeddings = new WebLLMEmbeddings(this.engine, this.EMBEDDING_MODEL);

      // Initialize vector store
      this.vectorStore = await MemoryVectorStore.fromExistingIndex(this.embeddings);

      // Load existing vectors from storage
      const stored = await chrome.storage.local.get('vectors');
      if (stored.vectors && stored.vectors.length > 0) {
        const documents = stored.vectors.map(v => ({
          pageContent: v.text,
          metadata: {
            url: v.url,
            title: v.title,
            timestamp: v.timestamp
          }
        }));
        await this.vectorStore.addDocuments(documents);
      }

      // Process any pending documents
      if (this.pendingDocuments.length > 0) {
        await Promise.all(this.pendingDocuments.map(doc => 
          this.vectorStore.addDocuments([doc])
        ));
        this.pendingDocuments = [];
      }

      this.isInitialized = true;
    } catch (error) {
      console.error('Error in initialization:', error);
      this.initPromise = null;
      throw error;
    }
  }

  async storeText(text, url, title) {
    await this._initializeIfNeeded();

    try {
      const doc = {
        pageContent: text,
        metadata: {
          url,
          title,
          timestamp: Date.now()
        }
      };

      if (!this.vectorStore) {
        this.pendingDocuments.push(doc);
      } else {
        await this.vectorStore.addDocuments([doc]);
      }

      // Save to chrome storage
      const stored = await chrome.storage.local.get('vectors');
      const vectors = stored.vectors || [];
      vectors.push({
        text,
        url,
        title,
        timestamp: doc.metadata.timestamp
      });
      await chrome.storage.local.set({ vectors });

      return doc.metadata.timestamp;
    } catch (error) {
      console.error('Error storing text:', error);
      throw error;
    }
  }

  async search(query, context = "") {
    await this._initializeIfNeeded();

    if (!this.vectorStore) {
      throw new Error("Vector store not initialized");
    }

    try {
      const promptTemplate = PromptTemplate.fromTemplate(`
        Answer the question based on the following context and your knowledge.
        If the context doesn't contain relevant information, say so.

        Context:
        {context}

        Additional Context: ${context}

        Question: {question}

        Answer:`);

      const chain = RunnableSequence.from([
        {
          context: this.vectorStore.asRetriever().pipe(formatDocumentsAsString),
          question: new RunnablePassthrough()
        },
        promptTemplate
      ]);

      const formattedPrompt = await chain.invoke(query);

      const response = await this.engine.chat.completions.create({
        messages: [{ role: "user", content: formattedPrompt.toString() }],
        model: this.LLM_MODEL
      });

      const relevantDocs = await this.vectorStore.similaritySearch(query, 3);
      
      return {
        response: response.choices[0].message.content,
        sources: relevantDocs.map(doc => ({
          text: doc.pageContent,
          ...doc.metadata
        }))
      };
    } catch (error) {
      console.error('Error searching:', error);
      throw error;
    }
  }

  async getVectors() {
    const result = await chrome.storage.local.get('vectors');
    return result.vectors || [];
  }

  async deleteVector(timestamp) {
    await this._initializeIfNeeded();

    const vectors = await this.getVectors();
    const updatedVectors = vectors.filter(v => v.timestamp !== timestamp);
    await chrome.storage.local.set({ vectors: updatedVectors });
    
    // Reinitialize vector store with updated vectors
    if (this.vectorStore) {
      this.vectorStore = await MemoryVectorStore.fromExistingIndex(this.embeddings);
      if (updatedVectors.length > 0) {
        await this.vectorStore.addDocuments(
          updatedVectors.map(v => ({
            pageContent: v.text,
            metadata: {
              url: v.url,
              title: v.title,
              timestamp: v.timestamp
            }
          }))
        );
      }
    }
  }

  // Method to check initialization status
  isReady() {
    return this.isInitialized && this.vectorStore !== null;
  }
}

export default new Knowledge();