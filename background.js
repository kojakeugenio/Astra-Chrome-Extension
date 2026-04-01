/**
 * FB Toolkit — Background Service Worker
 * Handles content script registration, feature state management,
 * session analytics, optional cloud sync, and network rule setup.
 */

const FB_SCRIPT_HOSTS = [
  'https://www.facebook.com/*',
  'https://web.facebook.com/*',
  'https://www.messenger.com/*'
];

const FB_TAB_HOSTS = [
  ...FB_SCRIPT_HOSTS,
  'https://m.facebook.com/*'
];

const RULE_IDS = {
  STRIP_CSP: 1,
  MOBILE_REDIRECT: 2,
  MOBILE_USER_AGENT: 3
};

const SYNC_SETTINGS_KEY = 'fb_toolkit_sync_settings';
const SESSION_ANALYTICS_KEY = 'fb_toolkit_session_stats';
const SYNC_PUSH_MIN_INTERVAL_MS = 5000;

const DEFAULT_SESSION_ANALYTICS = {
  hiddenAds: 0,
  hiddenSuggestions: 0,
  hiddenPeople: 0,
  hiddenKeywordPosts: 0
};

const MOBILE_USER_AGENT_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1';

const DEFAULT_SETTINGS = {
  unseen: {
    DISABLE_READ: { enable: true },
    DISABLE_TYPING: { enable: true },
    DISABLE_STORIES_SEEN: { enable: true }
  },
  homepage: {
    HIDE_LEFT_SIDEBAR: { enable: false },
    HIDE_RIGHT_SIDEBAR: { enable: false },
    HIDE_NAV_BAR: { enable: false },
    FULL_WIDTH_FEED: { enable: false },
    FEED_WIDTH: { width: 65 },
    HIDE_WHATS_ON_YOUR_MIND: { enable: false },
    HIDE_STORIES: { enable: false },
    HIDE_REELS: { enable: false },
    REELS_START_MUTED: { enable: false },
    REELS_VIDEO_CONTROLS: { enable: true },
    REELS_AUTO_NEXT: { enable: true },
    REELS_WATCH_COUNT: { count: 0 },
    REELS_DEFAULT_SPEED: { enable: false, speed: 1 },
    REELS_TIMEOUT: { enable: true, threshold: 100, message: '' },
    HIDE_ADS: { enable: true },
    HIDE_SUGGESTIONS: { enable: false },
    HIDE_PEOPLE_YOU_MAY_KNOW: { enable: false },
    CARD_BORDERS: { enable: false, border: 'glow' },
    FEED_BACKGROUND: { enable: false, gradient: 'cosmic', wallpaper: null },
    THEME_HOME_ONLY: { enable: false },
    WALLPAPER_ZOOM: { enable: false },
    WALLPAPER_BLUR_INTENSITY: { amount: 0 },
    GRADIENT_INTENSITY: { amount: 100 },
    PARTICLE_PATTERN: { pattern: 'none' },
    PARTICLE_SPEED: { speed: 1 },
    KEYWORD_FILTER: { enable: false, terms: [] },
    CUSTOM_FONT: { enable: false, family: 'default', size: 100 },
    COMPACT_MODE: { enable: false },
    HOVER_ZOOM: { enable: false, mode: 'popup', excludeUrls: '/messenger_media\n/photo/?fbid\n/stories/', upscaleSmall: true, enablePin: false },
    AUTO_SCROLL: { enable: true, speed: 2 }
  },
  browser: {
    MOBILE_VIEW: { enable: false }
  },
  sync: {
    CLOUD_SYNC: { enable: false }
  },
  global: {
    THEME: 'system'
  }
};

let inMemorySessionAnalytics = { ...DEFAULT_SESSION_ANALYTICS };
let analyticsQueue = Promise.resolve();
let lastSyncPushAt = 0;
let queuedSyncSettings = null;
let queuedSyncTimer = null;

// ── Initialization ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  const settings = await initializeSettings(details.reason);
  // Ensure installDate is set on install
  if (details.reason === 'install') {
    await setInstallDate();
    await resetSessionAnalytics();
  }
  await setupNetworkRules(settings);
  await registerContentScripts();

  // Inject content scripts into already-open Facebook tabs
  // This ensures the extension works immediately without requiring a page refresh
  await injectContentScriptsIntoExistingTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await initializeSettings('startup');
  await setupNetworkRules(settings);
  await registerContentScripts();

  // Also inject on browser startup to catch tabs that were restored
  await injectContentScriptsIntoExistingTabs();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !changes[SYNC_SETTINGS_KEY]) {
    return;
  }

  (async () => {
    const current = await getSettings();
    if (!current?.sync?.CLOUD_SYNC?.enable) {
      return;
    }

    const syncedValue = changes[SYNC_SETTINGS_KEY].newValue;
    if (!syncedValue) {
      return;
    }

    const next = deepMergeDefaults(DEFAULT_SETTINGS, syncedValue);
    if (JSON.stringify(next) === JSON.stringify(current)) {
      return;
    }

    await applySettingsUpdate(current, next, { pushToSync: false });
  })().catch((error) => {
    console.warn('[fb-toolkit] Sync change apply failed.', error);
  });
});

async function initializeSettings(reason) {
  const data = await chrome.storage.local.get('fb_toolkit');
  let settings = deepMergeDefaults(DEFAULT_SETTINGS, data.fb_toolkit || {});

  // Fresh install gets defaults; updates/startup preserve user values and add new keys.
  if (reason === 'install' && !data.fb_toolkit) {
    settings = deepMergeDefaults(DEFAULT_SETTINGS, {});
  }

  // Ensure installDate exists for existing users too
  const meta = await chrome.storage.local.get('meta');
  if (!meta.installDate) {
    await setInstallDate();
  }

  if (settings?.sync?.CLOUD_SYNC?.enable) {
    const synced = await pullSettingsFromSync();
    if (synced) {
      settings = deepMergeDefaults(DEFAULT_SETTINGS, synced);
    }
  }

  await chrome.storage.local.set({ fb_toolkit: settings });
  return settings;
}

async function setInstallDate() {
  const now = Date.now();
  await chrome.storage.local.set({ meta: { installDate: now } });
}

// ── Network Rules (CSP + Mobile Emulation) ──────────────────────────────────

async function setupNetworkRules(settingsOverride) {
  const settings = settingsOverride || await getSettings();
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = existingRules.map((rule) => rule.id);
  let addRules = buildNetworkRules(settings, true);

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeIds,
      addRules
    });
  } catch (error) {
    console.warn('[fb-toolkit] Mobile UA header override failed. Retrying without it.', error);
    addRules = buildNetworkRules(settings, false);
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeIds,
      addRules
    });
  }
}

function buildNetworkRules(settings, includeMobileUserAgent) {
  const rules = [
    {
      id: RULE_IDS.STRIP_CSP,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'Content-Security-Policy', operation: 'remove' },
          { header: 'Content-Security-Policy-Report-Only', operation: 'remove' }
        ]
      },
      condition: {
        regexFilter: '.*facebook\\.com.*|.*messenger\\.com.*',
        resourceTypes: ['main_frame', 'xmlhttprequest']
      }
    }
  ];

  if (settings?.browser?.MOBILE_VIEW?.enable) {
    rules.push({
      id: RULE_IDS.MOBILE_REDIRECT,
      priority: 2,
      action: {
        type: 'redirect',
        redirect: {
          regexSubstitution: 'https://m.facebook.com/\\1'
        }
      },
      condition: {
        regexFilter: '^https://(?:www|web)\\.facebook\\.com/(.*)$',
        resourceTypes: ['main_frame']
      }
    });

    if (includeMobileUserAgent) {
      rules.push({
        id: RULE_IDS.MOBILE_USER_AGENT,
        priority: 3,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'User-Agent', operation: 'set', value: MOBILE_USER_AGENT_IOS }
          ]
        },
        condition: {
          regexFilter: '^https://(?:m\\.)?facebook\\.com/.*',
          resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest']
        }
      });
    }
  }

  return rules;
}

// ── Content Script Registration ─────────────────────────────────────────────

async function registerContentScripts() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ['fb-toolkit-proxy', 'fb-toolkit-homepage', 'fb-toolkit-bridge'] });
  } catch (error) {
    // Script wasn't registered yet.
  }

  await chrome.scripting.registerContentScripts([
    {
      id: 'fb-toolkit-bridge',
      js: ['injects/bridge.js'],
      matches: FB_TAB_HOSTS,
      runAt: 'document_start',
      world: 'ISOLATED'
    },
    {
      id: 'fb-toolkit-proxy',
      js: ['injects/proxy.js'],
      matches: FB_SCRIPT_HOSTS,
      runAt: 'document_start',
      world: 'MAIN'
    },
    {
      id: 'fb-toolkit-homepage',
      js: ['injects/homepage.js'],
      matches: [
        'https://www.facebook.com/*',
        'https://web.facebook.com/*'
      ],
      runAt: 'document_start',
      world: 'MAIN'
    }
  ]);
}

// ── Inject Feature Settings into Tabs ───────────────────────────────────────

async function injectSettingsIntoTab(tabId) {
  const settings = await getSettings();

  try {
    await chrome.scripting.executeScript({
      injectImmediately: true,
      world: 'MAIN',
      target: { tabId, allFrames: true },
      func: (settingsJSON) => {
        window.fb_toolkit = JSON.parse(settingsJSON);
      },
      args: [JSON.stringify(settings)]
    });
  } catch (error) {
    // Tab might have been closed or navigated away.
  }
}

async function injectSettingsIntoAllTabs() {
  const tabs = await chrome.tabs.query({ url: FB_TAB_HOSTS });
  await Promise.all(
    tabs
      .filter((tab) => tab.id)
      .map((tab) => injectSettingsIntoTab(tab.id))
  );
}

async function reloadFacebookTabs() {
  const tabs = await chrome.tabs.query({ url: FB_TAB_HOSTS });
  await Promise.all(
    tabs
      .filter((tab) => tab.id)
      .map((tab) => chrome.tabs.reload(tab.id))
  );
}

/**
 * Inject content scripts into already-open Facebook tabs.
 * This is necessary because content scripts defined via registerContentScripts
 * only run on NEW page loads, not on tabs that are already open.
 */
async function injectContentScriptsIntoExistingTabs() {
  const tabs = await chrome.tabs.query({ url: FB_TAB_HOSTS });
  const settings = await getSettings();

  for (const tab of tabs) {
    if (!tab.id) continue;

    try {
      // First inject settings
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: (settingsJSON) => {
          window.fb_toolkit = JSON.parse(settingsJSON);
        },
        args: [JSON.stringify(settings)]
      });

      // Then inject the bridge script (ISOLATED world)
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'ISOLATED',
        files: ['injects/bridge.js']
      });

      // Inject proxy.js (MAIN world) - only for non-mobile Facebook
      const url = tab.url || '';
      if (!url.includes('m.facebook.com')) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          files: ['injects/proxy.js']
        });
      }

      // Inject homepage.js (MAIN world) - for desktop Facebook
      if (url.includes('facebook.com') && !url.includes('messenger.com')) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          files: ['injects/homepage.js']
        });
      }

      console.log('[fb-toolkit] Injected scripts into existing tab:', tab.id);
    } catch (error) {
      // Tab might not be ready or have restricted access
      console.warn('[fb-toolkit] Could not inject into tab:', tab.id, error.message);
    }
  }
}

// ── Tab Update Listener ─────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab?.url || changeInfo.status !== 'loading') {
    return;
  }

  const url = new URL(tab.url);
  const isFacebookSurface = url.hostname.includes('facebook.com') || url.hostname.includes('messenger.com');
  if (isFacebookSurface) {
    await injectSettingsIntoTab(tabId);
  }
});

// ── Message Handler (from Popup + Bridge) ───────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SETTINGS') {
    getSettings()
      .then((settings) => sendResponse(settings))
      .catch(() => sendResponse(deepMergeDefaults(DEFAULT_SETTINGS, {})));
    return true;
  }

  if (message.type === 'SAVE_SETTINGS') {
    (async () => {
      const previous = await getSettings();
      const next = deepMergeDefaults(DEFAULT_SETTINGS, message.settings || {});
      await applySettingsUpdate(previous, next, { pushToSync: true });
      sendResponse({ success: true, settings: next });
    })().catch((error) => {
      console.warn('[fb-toolkit] Failed to save settings.', error);
      sendResponse({ success: false });
    });
    return true;
  }

  if (message.type === 'PUSH_SYNC_SETTINGS') {
    (async () => {
      const settings = await getSettings();
      await pushSettingsToSync(settings);
      sendResponse({ success: true });
    })().catch((error) => {
      console.warn('[fb-toolkit] Push sync failed.', error);
      sendResponse({ success: false });
    });
    return true;
  }

  if (message.type === 'PULL_SYNC_SETTINGS') {
    (async () => {
      const previous = await getSettings();
      const synced = await pullSettingsFromSync();
      if (!synced) {
        sendResponse({ success: false, reason: 'empty' });
        return;
      }
      const next = deepMergeDefaults(DEFAULT_SETTINGS, synced);
      await applySettingsUpdate(previous, next, { pushToSync: false });
      sendResponse({ success: true, settings: next });
    })().catch((error) => {
      console.warn('[fb-toolkit] Pull sync failed.', error);
      sendResponse({ success: false });
    });
    return true;
  }

  if (message.type === 'GET_ANALYTICS') {
    getSessionAnalytics()
      .then((stats) => sendResponse({ success: true, stats }))
      .catch(() => sendResponse({ success: true, stats: { ...DEFAULT_SESSION_ANALYTICS } }));
    return true;
  }

  if (message.type === 'RESET_ANALYTICS') {
    resetSessionAnalytics()
      .then((stats) => sendResponse({ success: true, stats }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.type === 'ANALYTICS_INCREMENT') {
    queueAnalyticsIncrement(message.delta)
      .then((stats) => sendResponse({ success: true, stats }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  return false;
});

// ── Settings Sync Helpers ────────────────────────────────────────────────────

async function applySettingsUpdate(previous, next, options = {}) {
  const opts = {
    pushToSync: true,
    ...options
  };

  await chrome.storage.local.set({ fb_toolkit: next });

  if (opts.pushToSync && next?.sync?.CLOUD_SYNC?.enable) {
    await pushSettingsToSyncThrottled(next);
  }

  await setupNetworkRules(next);
  await injectSettingsIntoAllTabs();

  const previousMobile = Boolean(previous?.browser?.MOBILE_VIEW?.enable);
  const nextMobile = Boolean(next?.browser?.MOBILE_VIEW?.enable);
  if (previousMobile !== nextMobile) {
    await reloadFacebookTabs();
  }
}

async function pushSettingsToSync(settings) {
  if (queuedSyncTimer) {
    clearTimeout(queuedSyncTimer);
    queuedSyncTimer = null;
  }
  queuedSyncSettings = null;
  await chrome.storage.sync.set({ [SYNC_SETTINGS_KEY]: settings });
  lastSyncPushAt = Date.now();
}

async function pullSettingsFromSync() {
  const data = await chrome.storage.sync.get(SYNC_SETTINGS_KEY);
  return data[SYNC_SETTINGS_KEY] || null;
}

async function pushSettingsToSyncThrottled(settings) {
  const now = Date.now();
  const elapsed = now - lastSyncPushAt;

  if (!queuedSyncTimer && elapsed >= SYNC_PUSH_MIN_INTERVAL_MS) {
    await pushSettingsToSync(settings);
    return;
  }

  queuedSyncSettings = settings;

  if (queuedSyncTimer) {
    return;
  }

  const waitMs = Math.max(500, SYNC_PUSH_MIN_INTERVAL_MS - elapsed);
  queuedSyncTimer = setTimeout(async () => {
    queuedSyncTimer = null;

    if (!queuedSyncSettings) {
      return;
    }

    const payload = queuedSyncSettings;
    queuedSyncSettings = null;

    try {
      await pushSettingsToSync(payload);
    } catch (error) {
      console.warn('[fb-toolkit] Deferred cloud sync push failed.', error);
    }
  }, waitMs);
}

// ── Session Analytics (Persistent in Local Storage) ─────────────────────────

async function getSessionAnalytics() {
  try {
    const data = await chrome.storage.local.get(SESSION_ANALYTICS_KEY);
    const stored = data[SESSION_ANALYTICS_KEY] || {};
    return {
      ...DEFAULT_SESSION_ANALYTICS,
      ...stored
    };
  } catch (error) {
    // Fall through to in-memory fallback.
  }

  return {
    ...DEFAULT_SESSION_ANALYTICS,
    ...inMemorySessionAnalytics
  };
}

async function setSessionAnalytics(stats) {
  const safeStats = {
    hiddenAds: Math.max(0, Number(stats.hiddenAds) || 0),
    hiddenSuggestions: Math.max(0, Number(stats.hiddenSuggestions) || 0),
    hiddenPeople: Math.max(0, Number(stats.hiddenPeople) || 0),
    hiddenKeywordPosts: Math.max(0, Number(stats.hiddenKeywordPosts) || 0)
  };

  inMemorySessionAnalytics = safeStats;

  try {
    await chrome.storage.local.set({ [SESSION_ANALYTICS_KEY]: safeStats });
  } catch (error) {
    // Ignore; in-memory fallback already updated.
  }

  return safeStats;
}

async function resetSessionAnalytics() {
  return setSessionAnalytics(DEFAULT_SESSION_ANALYTICS);
}

function normalizeAnalyticsDelta(delta) {
  const safe = delta || {};
  return {
    hiddenAds: Math.max(0, Number(safe.hiddenAds) || 0),
    hiddenSuggestions: Math.max(0, Number(safe.hiddenSuggestions) || 0),
    hiddenPeople: Math.max(0, Number(safe.hiddenPeople) || 0),
    hiddenKeywordPosts: Math.max(0, Number(safe.hiddenKeywordPosts) || 0)
  };
}

async function queueAnalyticsIncrement(delta) {
  const increment = normalizeAnalyticsDelta(delta);

  analyticsQueue = analyticsQueue
    .catch(() => getSessionAnalytics())
    .then(async () => {
      const current = await getSessionAnalytics();
      const next = {
        hiddenAds: current.hiddenAds + increment.hiddenAds,
        hiddenSuggestions: current.hiddenSuggestions + increment.hiddenSuggestions,
        hiddenPeople: current.hiddenPeople + increment.hiddenPeople,
        hiddenKeywordPosts: current.hiddenKeywordPosts + increment.hiddenKeywordPosts
      };

      return setSessionAnalytics(next);
    });

  return analyticsQueue;
}

// ── Utilities ───────────────────────────────────────────────────────────────

async function getSettings() {
  const data = await chrome.storage.local.get('fb_toolkit');
  return deepMergeDefaults(DEFAULT_SETTINGS, data.fb_toolkit || {});
}

function deepMergeDefaults(defaults, current) {
  const result = { ...current };

  for (const key in defaults) {
    if (
      typeof defaults[key] === 'object' &&
      defaults[key] !== null &&
      !Array.isArray(defaults[key])
    ) {
      result[key] = deepMergeDefaults(defaults[key], result[key] || {});
    } else if (result[key] === undefined) {
      result[key] = defaults[key];
    }
  }

  return result;
}
