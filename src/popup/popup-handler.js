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
    
    // Knowledge base controls
    this.searchInput = document.getElementById('searchKnowledge');
    this.filterSelect = document.getElementById('filterType');
    
    // Settings elements
    this.settingsButton = document.getElementById('settingsButton');
    this.settingsModal = document.getElementById('settingsModal');
    this.backendSelect = document.getElementById('backendSelect');
    this.apiKeyInput = document.getElementById('apiKeyInput');
    this.openaiSettings = document.getElementById('openaiSettings');
    this.saveSettings = document.getElementById('saveSettings');
    this.closeSettings = document.getElementById('closeSettings');
    
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

    // Knowledge base events
    this.searchInput.addEventListener('input', () => this.filterKnowledgeList());
    this.filterSelect.addEventListener('change', () => this.filterKnowledgeList());

    // Tab events
    this.tabButtons.forEach(button => {
      button.addEventListener('click', () => this.switchTab(button.dataset.tab));
    });

    // Settings events with properly bound this context
    this.settingsButton.addEventListener('click', () => {
      this.toggleSettings(true);
    });

    this.backendSelect.addEventListener('change', () => {
      this.toggleOpenAISettings();
    });

    this.saveSettings.addEventListener('click', async () => {
      await this.handleSaveSettings();
    });

    this.closeSettings.addEventListener('click', () => {
      this.toggleSettings(false);
    });

    // Close modal when clicking outside
    this.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.settingsModal) {
        this.toggleSettings(false);
      }
    });

    // Global escape key event
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.toggleSettings(false);
      }
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
    const filtered = this.filterVectors(vectors);
    this.renderKnowledgeList(filtered);
  }

  filterVectors(vectors) {
    const searchTerm = this.searchInput.value.toLowerCase();
    const filterType = this.filterSelect.value;
    
    return vectors.filter(vector => {
      const matchesSearch = vector.text.toLowerCase().includes(searchTerm) || 
                          vector.insights?.some(i => i.content.toLowerCase().includes(searchTerm));
      
      switch (filterType) {
        case 'insights':
          return matchesSearch && vector.insights?.length > 0;
        case 'original':
          return matchesSearch && !vector.isInsight;
        default:
          return matchesSearch;
      }
    });
  }

  renderKnowledgeList(vectors) {
    if (vectors.length === 0) {
      this.knowledgeList.innerHTML = this.renderEmptyState();
      return;
    }
  
    this.knowledgeList.innerHTML = vectors.map(vector => {
      // Only display insights section
      const insightsHtml = vector.insights?.length ? `
        ${vector.insights.map(insight => `
          <div class="knowledge-item insight">
            <div class="knowledge-content">
              <i class="fas fa-lightbulb"></i>
              ${this.escapeHtml(insight.content)}
            </div>
            <div class="knowledge-meta">
              <a href="${vector.url}" target="_blank" class="knowledge-source">
                <i class="fas fa-link"></i>
                ${this.escapeHtml(vector.title || 'Source')}
              </a>
              <span>
                <i class="far fa-clock"></i>
                ${new Date(insight.timestamp).toLocaleString()}
              </span>
            </div>
            <button class="knowledge-delete" data-timestamp="${vector.timestamp}">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        `).join('')}
      ` : '';
  
      return `
        <div class="knowledge-item original">
          <div class="knowledge-content">
            <div class="original-text">
              <h4>Original Text</h4>
              ${this.escapeHtml(vector.text)}
            </div>
            ${vector.insights?.length ? `
              <div class="insights-section">
                <h4>Generated Insights</h4>
                ${insightsHtml}
              </div>
            ` : ''}
          </div>
          <div class="knowledge-meta">
            <a href="${vector.url}" target="_blank" class="knowledge-source">
              <i class="fas fa-link"></i>
              ${this.escapeHtml(vector.title || 'Source')}
            </a>
            <span>
              <i class="far fa-clock"></i>
              ${new Date(vector.timestamp).toLocaleString()}
            </span>
          </div>
          <button class="knowledge-delete" data-timestamp="${vector.timestamp}">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      `;
    }).join('');
  
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
      
      // Hide loading and modal after successful save
      this.hideLoading();
      this.toggleSettings(false);
      
      // Refresh the knowledge list
      await this.refreshKnowledgeList();
    } catch (error) {
      this.hideLoading();
      this.handleError('Settings update error', error);
    }
  }

  toggleSettings(show = true) {
    if (show) {
      this.settingsModal.classList.remove('hidden');
    } else {
      this.settingsModal.classList.add('hidden');
    }
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

  filterKnowledgeList() {
    this.refreshKnowledgeList();
  }
}

export default PopupHandler;