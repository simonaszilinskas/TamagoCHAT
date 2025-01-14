// src/popup/popup-handler.js
import Knowledge from '../knowledge.js';

export class PopupHandler {
  constructor() {
    this.initElements();
    
    // Set initial tab state
    const activeTab = document.querySelector('.tab-button.active');
    if (activeTab) {
      this.switchTab(activeTab.dataset.tab);
    }
    
    this.bindEvents();
    this.initLLM();
  }

  // Initialization methods
  initElements() {
    // Main elements
    this.loading = document.getElementById('loading');
    this.main = document.getElementById('main');
    
    // Chat elements
    this.chat = document.getElementById('chat');
    this.input = document.getElementById('input');
    this.send = document.getElementById('send');
    this.response = document.getElementById('response');
    
    // Knowledge base elements
    this.knowledgeList = document.getElementById('knowledge-list');
    
    // Tab elements
    this.tabButtons = document.querySelectorAll('.tab-button');
    
    // Settings elements
    this.settingsButton = document.getElementById('settingsButton');
    this.settingsModal = document.getElementById('settingsModal');
    this.backendSelect = document.getElementById('backendSelect');
    this.apiKeyInput = document.getElementById('apiKeyInput');
    this.openaiSettings = document.getElementById('openaiSettings');
    this.saveSettings = document.getElementById('saveSettings');
    this.closeSettings = document.getElementById('closeSettings');

    // Validate required elements
    this.validateElements();
  }

  validateElements() {
    const required = [
      'loading', 'main', 'chat', 'input', 'send', 'response',
      'knowledgeList', 'settingsButton', 'settingsModal', 'backendSelect',
      'apiKeyInput', 'openaiSettings', 'saveSettings', 'closeSettings'
    ];

    for (const elem of required) {
      if (!this[elem]) {
        throw new Error(`Required element "${elem}" not found`);
      }
    }
  }

  bindEvents() {
    this.bindChatEvents();
    this.bindTabEvents();
    this.bindSettingsEvents();
    this.bindKeyboardEvents();
  }

  bindChatEvents() {
    this.send.addEventListener('click', () => this.handleSend());
    this.input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });
  }

  bindTabEvents() {
    this.tabButtons.forEach(button => {
      button.addEventListener('click', () => this.switchTab(button.dataset.tab));
    });
  }

  bindSettingsEvents() {
    this.settingsButton.addEventListener('click', () => this.openSettings());
    this.closeSettings.addEventListener('click', () => this.closeSettingsModal());
    this.saveSettings.addEventListener('click', () => this.saveSettingsHandler());
    this.backendSelect.addEventListener('change', () => this.toggleOpenAISettings());
    
    this.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.settingsModal) {
        this.closeSettingsModal();
      }
    });
  }

  bindKeyboardEvents() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeSettingsModal();
      }
    });
  }

  // LLM initialization
  async initLLM() {
    try {
      this.showLoading('Initializing...');
      
      await Knowledge._initializeIfNeeded((progress) => {
        if (progress) {
          this.updateLoadingProgress(progress);
        }
      });
      
      this.hideLoading();
      this.refreshKnowledgeList();
      await this.loadSettings();
    } catch (error) {
      this.handleError('Initialization error', error);
    }
  }

  // Loading state methods
  showLoading(message, icon = 'spinner') {
    this.loading.innerHTML = `
      <i class="fas fa-${icon} ${icon === 'spinner' ? 'fa-spin' : ''}"></i>
      ${message}
    `;
    this.loading.style.display = 'block';
    this.main.style.display = 'none';
  }

  hideLoading() {
    this.loading.style.display = 'none';
    this.main.style.display = 'block';
  }

  updateLoadingProgress(progress) {
    this.loading.innerHTML = `
      <i class="fas fa-spinner fa-spin"></i>
      Loading models: ${Math.round(progress.progress * 100)}%
    `;
  }

  // Error handling
  handleError(context, error) {
    console.error(`${context}:`, error);
    this.loading.innerHTML = `
      <i class="fas fa-exclamation-triangle"></i>
      Error: ${error.message}. Try reloading the extension.
    `;
  }

  // Tab methods
  switchTab(tabId) {
    if (!tabId) return;

    this.tabButtons.forEach(button => {
      const isActive = button.dataset.tab === tabId;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive);
    });

    document.querySelectorAll('.tab-content').forEach(content => {
      const isActive = content.id === tabId;
      content.classList.toggle('active', isActive);
      content.setAttribute('aria-hidden', !isActive);
    });

    if (tabId === 'knowledge') {
      this.refreshKnowledgeList();
    }
  }

  // Settings methods
  async loadSettings() {
    const settings = await Knowledge.getSettings();
    this.backendSelect.value = settings.backend;
    this.apiKeyInput.value = settings.apiKey || '';
    this.toggleOpenAISettings();
  }

  toggleOpenAISettings() {
    const isOpenAI = this.backendSelect.value === 'openai';
    this.openaiSettings.classList.toggle('hidden', !isOpenAI);
  }

  openSettings() {
    this.settingsModal.classList.remove('hidden');
  }

  closeSettingsModal() {
    this.settingsModal.classList.add('hidden');
  }

  async saveSettingsHandler() {
    const settings = {
      backend: this.backendSelect.value,
      apiKey: this.backendSelect.value === 'openai' ? this.apiKeyInput.value.trim() : ''
    };

    try {
      this.showLoading('Updating settings...', 'spinner');
      this.settingsModal.classList.add('hidden');
      
      await Knowledge.updateSettings(settings);
      this.hideLoading();
    } catch (error) {
      this.handleError('Settings update error', error);
    }
  }

  // Chat methods
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

      return await this.getTabContent(tab);
    } catch (error) {
      console.warn('Could not get page context:', error);
      return '';
    }
  }

  async getTabContent(tab) {
    return new Promise((resolve) => {
      try {
        const port = chrome.runtime.connect(tab.id);
        port.onMessage.addListener((msg) => {
          port.disconnect();
          resolve(msg.contents || '');
        });
        port.postMessage({ type: 'GET_CONTENT' });
        
        setTimeout(() => {
          port.disconnect();
          resolve('');
        }, 1000);
      } catch {
        resolve('');
      }
    });
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
      <div class="response-text">
        <i class="fas fa-robot"></i>
        ${result.response}
      </div>
      ${this.formatSources(result.sources)}
    `;
  }

  formatSources(sources) {
    if (!sources?.length) return '';
    
    return `
      <div class="sources">
        <div class="sources-header">
          <i class="fas fa-book"></i>
          <strong>Sources:</strong>
        </div>
        ${sources.map(s => `
          <div class="source-item">
            <a href="${s.url}" target="_blank">
              <i class="fas fa-link"></i>
              ${s.title || 'Source'}
            </a>
          </div>
        `).join('')}
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

  // Knowledge list methods
  async refreshKnowledgeList() {
    const vectors = await Knowledge.getVectors();
    this.knowledgeList.innerHTML = vectors.length === 0 
      ? this.renderEmptyState()
      : this.renderKnowledgeItems(vectors);

    this.bindDeleteButtons();
  }

  renderEmptyState() {
    return `
      <div class="knowledge-item empty-state">
        <i class="fas fa-lightbulb"></i>
        <p>No knowledge stored yet. Highlight text on any webpage and use the right-click menu to add it.</p>
      </div>
    `;
  }

  renderKnowledgeItems(vectors) {
    return vectors.map(vector => `
      <div class="knowledge-item">
        <div class="knowledge-text">
          <i class="fas fa-quote-left"></i>
          ${this.truncateText(vector.text, 200)}
        </div>
        <div class="knowledge-meta">
          <a href="${vector.url}" target="_blank" class="knowledge-source">
            <i class="fas fa-link"></i>
            ${vector.title || 'Source'}
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
    `).join('');
  }

  bindDeleteButtons() {
    this.knowledgeList.querySelectorAll('.knowledge-delete').forEach(button => {
      button.addEventListener('click', async (e) => {
        e.preventDefault();
        const button = e.currentTarget;
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        await this.deleteKnowledgeItem(button.dataset.timestamp);
      });
    });
  }

  truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return text || '';
    return text.substring(0, maxLength) + '...';
  }

  async deleteKnowledgeItem(timestamp) {
    if (!timestamp) return;
    await Knowledge.deleteVector(parseInt(timestamp));
    await this.refreshKnowledgeList();
  }
}