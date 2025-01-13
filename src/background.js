import Knowledge from './knowledge.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "addToKnowledge",
    title: "Add to knowledge base",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "addToKnowledge") {
    try {
      // No explicit initialization needed - it will happen automatically
      await Knowledge.storeText(info.selectionText, tab.url, tab.title);
    } catch (error) {
      console.error('Error adding to knowledge base:', error);
    }
  }
});