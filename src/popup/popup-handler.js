import Knowledge from '../knowledge.js';

export class PopupHandler {
  constructor() {
    this.initElements();
    this.bindEvents();
    this.initLLM();
  }

  initElements() {
    this.loading = document.getElementById('loading');
    this.main = document.getElementById('main');
    this.chat = document.getElementById('chat');
    this.input = document.getElementById('input');
    this.send = document.getElementById('send');
    this.response = document.getElementById('response');
    this.knowledgeList = document.getElementById('knowledge-list');
    this.tabButtons = document.querySelectorAll('.tab-button');
  }

  bindEvents() {
    this.send.addEventListener('click', () => this.handleSend());
    this.input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    this.tabButtons.forEach(button => {
      button.addEventListener('click', () => this.switchTab(button.dataset.tab));
    });
  }

  async initLLM() {
    try {
      await Knowledge._initializeIfNeeded((progress) => {
        this.loading.textContent = `Loading models: ${Math.round(progress.progress * 100)}%`;
        if (progress.progress === 1) {
          this.loading.style.display = 'none';
          this.main.style.display = 'block';
          this.refreshKnowledgeList();
        }
      });
    } catch (error) {
      this.loading.textContent = `Error loading models: ${error.message}`;
    }
  }

  switchTab(tabId) {
    this.tabButtons.forEach(button => {
      button.classList.toggle('active', button.dataset.tab === tabId);
    });

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === tabId);
    });

    if (tabId === 'knowledge') {
      this.refreshKnowledgeList();
    }
  }

  async handleSend() {
    const query = this.input.value.trim();
    if (!query) return;
  
    this.response.textContent = 'Thinking...';
    this.input.value = '';
  
    try {
      // First try to get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let context = '';
  
      // Only try to connect if we have a valid tab and it's not a chrome:// URL
      if (tab && !tab.url?.startsWith('chrome://')) {
        try {
          const port = chrome.runtime.connect(tab.id);
          context = await new Promise((resolve) => {
            port.onMessage.addListener((msg) => {
              port.disconnect();
              resolve(msg.contents || '');
            });
            port.postMessage({ type: 'GET_CONTENT' });
            
            // Add timeout to prevent hanging
            setTimeout(() => {
              port.disconnect();
              resolve('');
            }, 1000);
          });
        } catch (connectionError) {
          console.warn('Could not get page context:', connectionError);
          // Continue without context
        }
      }
  
      // Proceed with search regardless of whether we got context
      const result = await Knowledge.search(query, context);
      this.displayResponse(result);
    } catch (error) {
      this.response.textContent = `Error: ${error.message}`;
      console.error('Search error:', error);
    }
  }

  displayResponse(result) {
    this.response.innerHTML = `
      <div class="response-text">${result.response}</div>
      ${result.sources?.length ? `
        <div class="sources">
          <strong>Sources:</strong>
          ${result.sources.map(s => `
            <div><a href="${s.url}" target="_blank">${s.title || 'Source'}</a></div>
          `).join('')}
        </div>
      ` : ''}
    `;
  }

  async refreshKnowledgeList() {
    const vectors = await Knowledge.getVectors();
    
    this.knowledgeList.innerHTML = vectors.length === 0 
      ? '<div class="knowledge-item">No knowledge stored yet. Highlight text on any webpage and use the right-click menu to add it.</div>'
      : vectors.map(vector => `
          <div class="knowledge-item">
            <div class="knowledge-text">${this.truncateText(vector.text, 200)}</div>
            <div class="knowledge-meta">
              <a href="${vector.url}" target="_blank" class="knowledge-source">${vector.title || 'Source'}</a>
              <span>${new Date(vector.timestamp).toLocaleString()}</span>
            </div>
            <button class="knowledge-delete" data-timestamp="${vector.timestamp}">×</button>
          </div>
        `).join('');

    this.knowledgeList.querySelectorAll('.knowledge-delete').forEach(button => {
      button.addEventListener('click', () => this.deleteKnowledgeItem(button.dataset.timestamp));
    });
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  async deleteKnowledgeItem(timestamp) {
    await Knowledge.deleteVector(parseInt(timestamp));
    this.refreshKnowledgeList();
  }
}