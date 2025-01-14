// src/background.js
import Knowledge from './knowledge.js';

// Initialize context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "addToKnowledge",
    title: "Add to knowledge base",
    contexts: ["selection"]
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "addToKnowledge") {
    try {
      // Ensure the Knowledge instance is initialized before storing text
      await Knowledge._initializeIfNeeded();
      
      // Store the selected text
      await Knowledge.storeText(info.selectionText, tab.url, tab.title);
      
      // Show success notification without icon
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22/>'),
        title: 'Knowledge Base',
        message: 'Text successfully added to knowledge base'
      });
    } catch (error) {
      console.error('Error adding to knowledge base:', error);
      
      // Show error notification without icon
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22/>'),
        title: 'Knowledge Base Error',
        message: `Failed to add text: ${error.message}`
      });
    }
  }
});