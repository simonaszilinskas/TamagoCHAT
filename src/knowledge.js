// src/knowledge.js
import * as webllm from "@mlc-ai/web-llm";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence, RunnablePassthrough } from "@langchain/core/runnables";
import { formatDocumentsAsString } from "langchain/util/document";
import OpenAIBackend from './backends/openai';
import TextProcessor from './text-processor';
import { WebLLMEmbeddings } from './embeddings';

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
    this.backend = 'local';
    this.openaiBackend = null;
    this.textProcessor = null;
  }

  // Add this method right after constructor
  async _initializeIfNeeded(callback) {
    if (this.isInitialized) return;
    
    if (!this.initPromise) {
      this.initPromise = this._initialize(callback);
    }
    
    try {
      await this.initPromise;
    } catch (error) {
      this.initPromise = null;
      throw error;
    }
  }

// Update storeText method for sequential timestamps
  async storeText(text, url, title) {
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid text input');
    }
    
    await this._initializeIfNeeded();
    
    try {
      const baseTimestamp = Date.now();
      
      // Process text to extract insights
      const processedContent = await this.textProcessor.processText(text, url, title);
      
      // Store both original text and insights with sequential timestamps
      const documents = [{
        pageContent: text,
        metadata: {
          url,
          title,
          timestamp: baseTimestamp,
          isOriginal: true
        }
      },
      ...processedContent.insights.map((insight, index) => ({
        pageContent: insight.content,
        metadata: {
          url,
          title,
          timestamp: baseTimestamp + index + 1, // Sequential timestamps
          isInsight: true,
          originalText: text
        }
      }))];

      if (!this.vectorStore) {
        this.pendingDocuments.push(...documents);
      } else {
        await this.vectorStore.addDocuments(documents);
      }

      // Save to chrome storage with insights
      const stored = await chrome.storage.local.get('vectors');
      const vectors = stored.vectors || [];
      vectors.push({
        text,
        url,
        title,
        timestamp: baseTimestamp,
        insights: processedContent.insights
      });
      await chrome.storage.local.set({ vectors });

      return {
        timestamp: baseTimestamp,
        insights: processedContent.insights
      };
    } catch (error) {
      console.error('Error storing text:', error);
      throw new Error(`Failed to store text: ${error.message}`);
    }
  }

// Simplify extractResponseContent
  extractResponseContent(response) {
    return response.choices[0].message.content;
  }

// Update search method template
  async search(query, context = "") {
    await this._initializeIfNeeded();
    if (!this.vectorStore) throw new Error("Vector store not initialized");

    try {
      const relevantDocs = await this.vectorStore.similaritySearch(query, 5);
      const organizedDocs = this.organizeSearchResults(relevantDocs);

      const promptTemplate = PromptTemplate.fromTemplate(`
        Answer the question based on the following insights and context.
        Prioritize information from the insights but use the full context for additional details if needed.
        If the context doesn't contain relevant information, say so.

        Key Insights:
        {insights}

        Full Context:
        {context}
        ${context ? `\nAdditional Context: ${context}` : ''}

        Question: {question}

        Answer:`);

      const chain = RunnableSequence.from([
        {
          insights: () => organizedDocs.insights.map(d => d.pageContent).join('\n'),
          context: () => organizedDocs.fullContext.map(d => d.pageContent).join('\n'),
          question: new RunnablePassthrough()
        },
        promptTemplate
      ]);

      const formattedPrompt = await chain.invoke(query);
      const response = await this.getResponse(formattedPrompt);

      return {
        response: this.extractResponseContent(response),
        sources: this.formatSources(organizedDocs)
      };
    } catch (error) {
      console.error('Error searching:', error);
      throw error;
    }
  }

  async _initialize(callback) {
    try {
      const settings = await chrome.storage.local.get(['backend', 'apiKey']);
      this.backend = settings.backend || 'local';

      if (this.backend === 'openai') {
        if (!settings.apiKey) throw new Error('OpenAI API key not found');
        this.openaiBackend = new OpenAIBackend(settings.apiKey);
        if (!await this.openaiBackend.verifyApiKey()) {
          throw new Error('Invalid OpenAI API key');
        }
        this.embeddings = this.openaiBackend;
        this.textProcessor = new TextProcessor(this.openaiBackend, "gpt-3.5-turbo");
      } else {
        // Initialize both models
        this.engine = await webllm.CreateMLCEngine(
          [this.EMBEDDING_MODEL, this.LLM_MODEL],
          { initProgressCallback: callback, logLevel: "INFO" }
        );
        
        // Create separate engine instances for embeddings and chat
        this.embeddings = new WebLLMEmbeddings(this.engine, this.EMBEDDING_MODEL);
        this.textProcessor = new TextProcessor(
          this.engine, 
          this.LLM_MODEL,
          this.EMBEDDING_MODEL // Pass embedding model ID
        );
      }

      this.vectorStore = await MemoryVectorStore.fromExistingIndex(this.embeddings);
      await this.loadStoredVectors();
      await this.processPendingDocuments();
      
      this.isInitialized = true;
    } catch (error) {
      console.error('Initialization error:', error);
      this.isInitialized = false;
      this.initPromise = null;
      throw error;
    }
  }

  async processPendingDocuments() {
    if (this.pendingDocuments.length > 0) {
      await Promise.all(this.pendingDocuments.map(doc => 
        this.vectorStore.addDocuments([doc])
      ));
      this.pendingDocuments = [];
    }
  }

  async loadStoredVectors() {
    const stored = await chrome.storage.local.get('vectors');
    if (stored.vectors?.length > 0) {
      const documents = stored.vectors.map(v => ({
        pageContent: v.text,
        metadata: {
          url: v.url,
          title: v.title,
          timestamp: v.timestamp,
          isInsight: v.isInsight,
          originalText: v.originalText
        }
      }));
      await this.vectorStore.addDocuments(documents);
    }
  }

  async storeText(text, url, title) {
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid text input');
    }
    
    await this._initializeIfNeeded();
    
    try {
      // Process text to extract insights
      const processedContent = await this.textProcessor.processText(text, url, title);
      
      // Store both original text and insights
      const documents = [{
        pageContent: text,
        metadata: {
          url,
          title,
          timestamp: Date.now(),
          isOriginal: true
        }
      },
      ...processedContent.insights.map(insight => ({
        pageContent: insight.content,
        metadata: {
          url,
          title,
          timestamp: Date.now(),
          isInsight: true,
          originalText: text
        }
      }))];

      if (!this.vectorStore) {
        this.pendingDocuments.push(...documents);
      } else {
        await this.vectorStore.addDocuments(documents);
      }

      // Save to chrome storage with insights
      const stored = await chrome.storage.local.get('vectors');
      const vectors = stored.vectors || [];
      vectors.push({
        text,
        url,
        title,
        timestamp: documents[0].metadata.timestamp,
        insights: processedContent.insights
      });
      await chrome.storage.local.set({ vectors });

      return {
        timestamp: documents[0].metadata.timestamp,
        insights: processedContent.insights
      };
    } catch (error) {
      console.error('Error storing text:', error);
      throw new Error(`Failed to store text: ${error.message}`);
    }
  }

  async search(query, context = "") {
    await this._initializeIfNeeded();
    if (!this.vectorStore) throw new Error("Vector store not initialized");

    try {
      // First search for relevant insights
      const relevantDocs = await this.vectorStore.similaritySearch(query, 5);
      
      // Prioritize insights but include original content for context
      const organizedDocs = this.organizeSearchResults(relevantDocs);

      const promptTemplate = PromptTemplate.fromTemplate(`
        Answer the question based on the following insights and context.
        Prioritize information from the insights but use the full context for additional details if needed.
        If the context doesn't contain relevant information, say so.

        Key Insights:
        {insights}

        Full Context:
        {context}

        Additional Context: ${context}

        Question: {question}

        Answer:`);

      const chain = RunnableSequence.from([
        {
          insights: () => organizedDocs.insights.map(d => d.pageContent).join('\n'),
          context: () => organizedDocs.fullContext.map(d => d.pageContent).join('\n'),
          question: new RunnablePassthrough()
        },
        promptTemplate
      ]);

      const formattedPrompt = await chain.invoke(query);
      const response = await this.getResponse(formattedPrompt);

      return {
        response: this.extractResponseContent(response),
        sources: this.formatSources(organizedDocs)
      };
    } catch (error) {
      console.error('Error searching:', error);
      throw error;
    }
  }

  organizeSearchResults(docs) {
    const insights = docs.filter(doc => doc.metadata.isInsight);
    const fullContext = docs.filter(doc => !doc.metadata.isInsight);
    return { insights, fullContext };
  }

  async getResponse(prompt) {
    if (this.backend === 'openai') {
      return await this.openaiBackend.chat([
        { role: "user", content: prompt.toString() }
      ]);
    }
    return await this.engine.chat.completions.create({
      messages: [{ role: "user", content: prompt.toString() }],
      model: this.LLM_MODEL
    });
  }

  extractResponseContent(response) {
    return this.backend === 'openai' 
      ? response.choices[0].message.content 
      : response.choices[0].message.content;
  }

  formatSources(organizedDocs) {
    return {
      insights: organizedDocs.insights.map(doc => ({
        text: doc.pageContent,
        url: doc.metadata.url,
        title: doc.metadata.title,
        timestamp: doc.metadata.timestamp,
        isInsight: doc.metadata.isInsight
      })),
      context: organizedDocs.fullContext.map(doc => ({
        text: doc.pageContent,
        url: doc.metadata.url,
        title: doc.metadata.title,
        timestamp: doc.metadata.timestamp,
        isInsight: doc.metadata.isInsight
      }))
    };
  }

  // Settings management
  async updateSettings(settings) {
    const { backend, apiKey } = settings;
    await chrome.storage.local.set({ backend, apiKey });
    
    this.isInitialized = false;
    this.initPromise = null;
    this.engine = null;
    this.vectorStore = null;
    this.embeddings = null;
    this.openaiBackend = null;
    
    await this._initializeIfNeeded();
  }

  async getSettings() {
    const settings = await chrome.storage.local.get(['backend', 'apiKey']);
    return {
      backend: settings.backend || 'local',
      apiKey: settings.apiKey || ''
    };
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
              timestamp: v.timestamp,
              isInsight: v.isInsight,
              originalText: v.originalText
            }
          }))
        );
      }
    }
  }

  isReady() {
    return this.isInitialized && this.vectorStore !== null;
  }
}

export default new Knowledge();