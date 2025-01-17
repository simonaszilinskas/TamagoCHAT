// src/popup/popup-handler.js
import Knowledge from '../knowledge.js';

export class PopupHandler {
  constructor() {
    this.initElements();
    this.bindEvents();
    this.initLLM();
    
    // Set initial tab
    const activeTab = document.querySelector('.tab-button.active');
    if (activeTab) {
      this.switchTab(activeTab.dataset.tab);
    }
  }

  initElements() {
    // Main elements
    this.loading = document.getElementById('loading');
    this.main = document.getElementById('main');
    this.chat = document.getElementById('chat');
    this.input = document.getElementById('input');
    this.send = document.getElementById('send');
    this.response = document.getElementById('response');
    this.knowledgeList = document.getElementById('knowledge-list');
    
    // Settings elements in knowledge tab
    this.backendSelect = document.getElementById('backendSelect');
    this.apiKeyInput = document.getElementById('apiKeyInput');
    this.openaiSettings = document.getElementById('openaiSettings');
    this.saveSettings = document.getElementById('saveSettings');
    
    this.tabButtons = document.querySelectorAll('.tab-button');
  }

  bindEvents() {
    // Chat events
    this.send.addEventListener('click', () => this.handleSend());
    this.input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    // Settings events
    this.backendSelect.addEventListener('change', () => {
      this.toggleOpenAISettings();
    });

    this.saveSettings.addEventListener('click', async () => {
      await this.handleSaveSettings();
    });

    // Tab events
    this.tabButtons.forEach(button => {
      button.addEventListener('click', () => this.switchTab(button.dataset.tab));
    });
  }

  async initLLM() {
    try {
      this.showLoading('Initializing...');
      await Knowledge._initializeIfNeeded((progress) => {
        if (progress) {
          this.updateLoadingProgress(progress);
        }
      });
      
      await this.loadSettings();
      this.hideLoading();
      await this.refreshKnowledgeList();
    } catch (error) {
      this.handleError('Initialization error', error);
    }
  }

  // Chat functionality
  async handleSend() {
    const query = this.input.value.trim();
    if (!query) return;

    this.input.value = '';
    this.showThinkingState();
    
    try {
      const context = await this.getPageContext();
      const result = await Knowledge.search(query, context);
      this.displayResponse(result);
    } catch (error) {
      this.displayError(error);
    }
  }

  async getPageContext() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || tab.url?.startsWith('chrome://')) return '';

      const port = chrome.runtime.connect({ name: 'content-script' });
      return new Promise((resolve) => {
        port.onMessage.addListener((msg) => {
          port.disconnect();
          resolve(msg.contents || '');
        });
        port.postMessage({ type: 'GET_CONTENT' });
        setTimeout(() => {
          port.disconnect();
          resolve('');
        }, 1000);
      });
    } catch (error) {
      console.warn('Could not get page context:', error);
      return '';
    }
  }

  // Knowledge base functionality
  async refreshKnowledgeList() {
    const vectors = await Knowledge.getVectors();
    this.renderKnowledgeList(vectors);
  }

  renderKnowledgeList(vectors) {
    if (vectors.length === 0) {
      this.knowledgeList.innerHTML = this.renderEmptyState();
      return;
    }

    // Flatten and transform vectors to show only insights
    const flattenedInsights = vectors.reduce((acc, vector) => {
      if (vector.insights) {
        const insights = vector.insights.map(insight => ({
          content: insight.content,
          url: vector.url,
          title: vector.title,
          timestamp: insight.timestamp || vector.timestamp,
          vectorTimestamp: vector.timestamp // Keep original vector timestamp for deletion
        }));
        return [...acc, ...insights];
      }
      return acc;
    }, []);

    // Sort by timestamp, newest first
    const sortedInsights = flattenedInsights.sort((a, b) => b.timestamp - a.timestamp);

    this.knowledgeList.innerHTML = sortedInsights.map(insight => `
      <div class="knowledge-item insight">
        <div class="knowledge-content">
          <i class="fas fa-lightbulb"></i>
          ${this.escapeHtml(insight.content)}
        </div>
        <div class="knowledge-meta">
          <a href="${insight.url}" target="_blank" class="knowledge-source">
            <i class="fas fa-link"></i>
            ${this.escapeHtml(insight.title || 'Source')}
          </a>
          <span>
            <i class="far fa-clock"></i>
            ${new Date(insight.timestamp).toLocaleString()}
          </span>
        </div>
        <button class="knowledge-delete" data-timestamp="${insight.vectorTimestamp}">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `).join('');

    this.bindDeleteButtons();
  }

  renderEmptyState() {
    return `
      <div class="knowledge-item empty-state">
        <div class="knowledge-content">
          <i class="fas fa-lightbulb"></i>
          <p>No knowledge stored yet. Highlight text on any webpage and use the right-click menu to add it.</p>
        </div>
      </div>
    `;
  }

  bindDeleteButtons() {
    this.knowledgeList.querySelectorAll('.knowledge-delete').forEach(button => {
      button.addEventListener('click', async (e) => {
        const timestamp = parseInt(e.currentTarget.dataset.timestamp);
        if (timestamp) {
          await Knowledge.deleteVector(timestamp);
          await this.refreshKnowledgeList();
        }
      });
    });
  }

  // Settings functionality
  async loadSettings() {
    const settings = await Knowledge.getSettings();
    this.backendSelect.value = settings.backend;
    this.apiKeyInput.value = settings.apiKey || '';
    this.toggleOpenAISettings();
  }

  async handleSaveSettings() {
    try {
      this.showLoading('Updating settings...');
      
      const newSettings = {
        backend: this.backendSelect.value,
        apiKey: this.backendSelect.value === 'openai' ? this.apiKeyInput.value.trim() : ''
      };

      await Knowledge.updateSettings(newSettings);
      
      // Hide loading after successful save
      this.hideLoading();
      
      // Show success message
      this.showSuccessMessage('Settings saved successfully');
      
      // Refresh the knowledge list
      await this.refreshKnowledgeList();
    } catch (error) {
      this.hideLoading();
      this.handleError('Settings update error', error);
    }
  }

  showSuccessMessage(message) {
    const successEl = document.createElement('div');
    successEl.className = 'success-message';
    successEl.innerHTML = `
      <i class="fas fa-check-circle"></i>
      ${message}
    `;
    
    // Insert after save button
    this.saveSettings.parentNode.insertBefore(successEl, this.saveSettings.nextSibling);
    
    // Remove after 3 seconds
    setTimeout(() => {
      successEl.remove();
    }, 3000);
  }

  toggleOpenAISettings() {
    const isOpenAI = this.backendSelect.value === 'openai';
    if (isOpenAI) {
      this.openaiSettings.classList.remove('hidden');
    } else {
      this.openaiSettings.classList.add('hidden');
    }
  }

  // UI state management
  switchTab(tabId) {
    this.tabButtons.forEach(button => {
      const isActive = button.dataset.tab === tabId;
      button.classList.toggle('active', isActive);
    });

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === tabId);
    });

    if (tabId === 'knowledge') {
      this.refreshKnowledgeList();
    }
  }

  // Loading and error states
  showLoading(message) {
    this.loading.textContent = message;
    this.loading.style.display = 'block';
    this.main.style.display = 'none';
  }

  hideLoading() {
    this.loading.style.display = 'none';
    this.main.style.display = 'block';
  }

  updateLoadingProgress(progress) {
    this.loading.textContent = `Loading models: ${Math.round(progress.progress * 100)}%`;
  }

  showThinkingState() {
    this.response.innerHTML = `
      <div class="thinking">
        <i class="fas fa-spinner fa-spin"></i> Thinking...
      </div>
    `;
  }

  displayResponse(result) {
    this.response.innerHTML = `
      <div class="response-content">
        <div class="response-text">
          ${result.response}
        </div>
        ${this.formatSources(result.sources)}
      </div>
    `;
  }
  
  formatSources(sources) {
    if (!sources?.insights?.length && !sources?.context?.length) return '';
    
    const sourcesList = [...(sources.insights || []), ...(sources.context || [])]
      .map(source => `
        <div class="source-item">
          <a href="${source.url}" target="_blank" class="source-link">
            <i class="fas fa-link"></i>
            ${this.escapeHtml(source.title || 'Source')}
          </a>
        </div>
      `).join('');
  
    return `
      <div class="response-sources">
        <div class="sources-header">
          <i class="fas fa-book"></i>
          Sources:
        </div>
        <div class="sources-list">
          ${sourcesList}
        </div>
      </div>
    `;
  }

  displayError(error) {
    this.response.innerHTML = `
      <div class="error">
        <i class="fas fa-exclamation-circle"></i>
        Error: ${error.message}
      </div>
    `;
  }

  handleError(context, error) {
    console.error(`${context}:`, error);
    // Display error message in the UI
    const errorMessage = `Error: ${error.message}`;
    if (this.response) {
      this.response.innerHTML = `
        <div class="error">
          <i class="fas fa-exclamation-circle"></i>
          ${errorMessage}
        </div>
      `;
    } else {
      // If response element isn't available, show in loading div
      this.loading.innerHTML = `
        <div class="error">
          <i class="fas fa-exclamation-triangle"></i>
          ${errorMessage}
          <button onclick="location.reload()">Retry</button>
        </div>
      `;
    }
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

export default PopupHandler;