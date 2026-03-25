/**
 * FB Toolkit bridge (ISOLATED world)
 * Forwards safe events from MAIN world scripts to extension runtime.
 */
(function () {
  'use strict';

  if (window.__fb_toolkit_bridge_loaded) {
    return;
  }
  window.__fb_toolkit_bridge_loaded = true;

  // Expose extension icon URL to MAIN world scripts
  const script = document.createElement('script');
  script.textContent = `window.__fb_toolkit_icon_url = "${chrome.runtime.getURL('icons/icon48.png')}";`;
  (document.head || document.documentElement).appendChild(script);
  script.remove();

  window.addEventListener('message', (event) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data;
    if (!data || data.__fbToolkit !== true) {
      return;
    }

    if (data.type === 'ANALYTICS_INCREMENT') {
      chrome.runtime.sendMessage({
        type: 'ANALYTICS_INCREMENT',
        delta: data.delta || {}
      });
    }

    if (data.type === 'UPDATE_SETTING') {
      // Get current settings, update the specified path, and save
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
        if (!settings) return;

        const { category, feature, value } = data.payload || {};
        if (category && feature && settings[category]) {
          if (!settings[category][feature]) {
            settings[category][feature] = {};
          }
          Object.assign(settings[category][feature], value);

          chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
        }
      });
    }
  });

  // Listen for messages from the popup (via chrome.tabs.sendMessage)
  // and forward to MAIN world via window.postMessage
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PIN_IMAGES' && Array.isArray(message.urls)) {
      window.postMessage({
        __fbToolkit: true,
        type: 'PIN_IMAGES',
        urls: message.urls
      }, '*');
      sendResponse({ success: true });
    }

    if (message.type === 'UPDATE_FEED_WIDTH' && message.width != null) {
      window.postMessage({
        __fbToolkit: true,
        type: 'UPDATE_FEED_WIDTH',
        width: message.width
      }, '*');
      sendResponse({ success: true });
    }
  });
})();
