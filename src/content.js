chrome.runtime.onConnect.addListener(function(port) {
    port.onMessage.addListener(function(msg) {
      port.postMessage({ contents: document.body.innerText });
    });
  });