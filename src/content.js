chrome.runtime.onConnect.addListener((port) => {
    port.onMessage.addListener((msg, senderPort) => {
      const pageContent = document.body?.innerText || '';
      senderPort.postMessage({ contents: pageContent });
      port.disconnect();
    });
  });