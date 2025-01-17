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
      await Knowledge._initializeIfNeeded();
      await Knowledge.storeText(info.selectionText, tab.url, tab.title);
      
      // Show success notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon48.png', // Make sure this icon exists in your extension
        title: 'Knowledge Base',
        message: 'Text successfully added to knowledge base'
      });
    } catch (error) {
      console.error('Error adding to knowledge base:', error);
      
      // Show error notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon48.png',
        title: 'Knowledge Base Error',
        message: `Failed to add text: ${error.message}`
      });
    }
  }
});

// Handle content script connections
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'content-script') {
    port.onMessage.addListener(async (msg, sender) => {
      if (msg.type === 'GET_CONTENT') {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => document.body?.innerText || ''
            }, (results) => {
              port.postMessage({ contents: results[0]?.result || '' });
            });
          }
        } catch (error) {
          console.error('Error getting page content:', error);
          port.postMessage({ contents: '' });
        }
      }
    });
  }
});