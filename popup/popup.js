/**
 * FB Toolkit popup logic
 * - Settings controls
 * - Session analytics display
 * - Tabbed navigation
 * - Theme & Wallpaper management
 */

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
    FEED_WIDTH: { width: 60 },
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
  global: {
    THEME: 'system'
  }
};

const GRADIENT_THEMES = [
  { id: 'cosmic', label: 'Cosmic', class: 'thumb-cosmic' },
  { id: 'ocean', label: 'Ocean', class: 'thumb-ocean' },
  { id: 'sunset', label: 'Sunset', class: 'thumb-sunset' },
  { id: 'aurora', label: 'Aurora', class: 'thumb-aurora' },
  { id: 'midnight', label: 'Midnight', class: 'thumb-midnight' },
  { id: 'forest', label: 'Forest', class: 'thumb-forest' },
  { id: 'rose', label: 'Rose', class: 'thumb-rose' },
  { id: 'dark', label: 'Dark', class: 'thumb-dark' },
  { id: 'sky', label: 'Sky (Light)', class: 'thumb-sky' },
  { id: 'mint', label: 'Mint (Light)', class: 'thumb-mint' },
  { id: 'lavender', label: 'Lavender (Light)', class: 'thumb-lavender' },
  { id: 'lemon', label: 'Lemon (Light)', class: 'thumb-lemon' },
  { id: 'sakura', label: 'Sakura (Light)', class: 'thumb-sakura' },
  { id: 'ivory', label: 'Ivory (Light)', class: 'thumb-ivory' }
];

const NATURE_WALLPAPERS = [
  { id: 'leaves', label: 'Nature Leaves', url: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&w=400&q=80' },
  { id: 'forest-vibe', label: 'Deep Forest', url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=400&q=80' },
  { id: 'mountain', label: 'Misty Peaks', url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=400&q=80' },
  { id: 'lake', label: 'Serene Lake', url: 'https://images.unsplash.com/photo-1439853949127-fa647821eba0?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1439853949127-fa647821eba0?auto=format&fit=crop&w=400&q=80' },
  { id: 'autumn', label: 'Autumn Glow', url: 'https://images.unsplash.com/photo-1523712999610-f77fbcfc3843?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1523712999610-f77fbcfc3843?auto=format&fit=crop&w=400&q=80' },
  { id: 'waterfall', label: 'Wild Falls', url: 'https://images.unsplash.com/photo-1432405972618-c60b0225b8f9?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1432405972618-c60b0225b8f9?auto=format&fit=crop&w=400&q=80' },
  { id: 'beach', label: 'Sunset Beach', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=400&q=80' },
  { id: 'flowers', label: 'Spring Flowers', url: 'https://images.unsplash.com/photo-1559150180-a0b6c0a1193d?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1559150180-a0b6c0a1193d?auto=format&fit=crop&w=400&q=80' },
  { id: 'galaxy', label: 'Starry Sky', url: 'https://images.unsplash.com/photo-1661705969607-cde73828023d?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1661705969607-cde73828023d?auto=format&fit=crop&w=400&q=80' }
];

let settings = deepMergeDefaults(DEFAULT_SETTINGS, {});
let analyticsPollTimer = null;
let statusTimer = null;

const ui = {
  toggles: [],
  tabBtns: [],
  tabContents: [],
  gradientGrid: null,
  wallpaperGrid: null,
  reelsSpeed: null,
  customWallInput: null,
  customWallApply: null,
  blurSlider: null,
  blurVal: null,
  gradientIntensitySlider: null,
  gradientIntensityVal: null,
  particlePattern: null,
  themeArea: null,
  status: null,
  statAds: null,
  themeBtns: [],
  feedWidthSlider: null,
  feedWidthVal: null,
  feedWidthContainer: null,
  particleSpeedSlider: null,
  particleSpeedVal: null,
  particleSpeedContainer: null,
  themeOptionsArea: null,
  reelsTimeoutThreshold: null,
  reelsTimeoutMessage: null,
  reelsTimeoutContainer: null,
  hoverZoomExcludeUrls: null,
  hoverZoomExcludeContainer: null,

  hoverZoomPinToggle: null,
  hoverZoomPinRow: null,
  hoverZoomPinUrlContainer: null,
  hoverZoomModeBtns: [],
  hoverZoomModeContainer: null,
  autoscrollSpeedSlider: null,
  autoscrollSpeedVal: null,
  autoscrollSpeedContainer: null,
  themeResetFeedWidth: null,
  keywordFilterTerms: null,
  keywordFilterContainer: null,
  fontFamilySelect: null,
  fontFamilyContainer: null,
  fontSizeSlider: null,
  fontSizeVal: null,
  fontSizeContainer: null,
  resetFontSize: null
};

document.addEventListener('DOMContentLoaded', async () => {
  cacheElements();

  // Check if user is on Facebook
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isFacebook = tab?.url && (
    tab.url.includes('facebook.com') ||
    tab.url.includes('messenger.com') ||
    tab.url.includes('web.facebook.com') ||
    tab.url.includes('m.facebook.com')
  );

  if (!isFacebook) {
    document.querySelector('.app-shell').classList.add('not-connected');
    return;
  }

  populateGrids();
  bindEvents();

  // Render defaults immediately so UI is visible right away
  renderSettings();

  try {
    const loaded = await sendMessage({ type: 'GET_SETTINGS' });
    settings = deepMergeDefaults(DEFAULT_SETTINGS, loaded || {});
    renderSettings(); // Re-render with actual saved settings
  } catch (error) {
    // Already showing defaults — just flag the error
    setStatus('Using cached settings', 'error');
  }

  // Run non-critical tasks in parallel
  Promise.all([
    checkRatingPrompt().catch(() => { }),
    refreshAnalytics().catch(() => { })
  ]);

  analyticsPollTimer = setInterval(refreshAnalytics, 3000);
  window.addEventListener('unload', () => {
    if (analyticsPollTimer) {
      clearInterval(analyticsPollTimer);
    }
  });
});

function cacheElements() {
  ui.toggles = Array.from(document.querySelectorAll('input[type="checkbox"][data-feature]'));
  ui.tabBtns = Array.from(document.querySelectorAll('.tab-btn'));
  ui.tabContents = Array.from(document.querySelectorAll('.tab-content'));
  ui.gradientGrid = document.getElementById('gradient-grid');
  ui.wallpaperGrid = document.getElementById('wallpaper-grid');
  ui.reelsSpeed = document.getElementById('reels-speed');
  ui.customWallInput = document.getElementById('custom-wallpaper-url');
  ui.customWallApply = document.getElementById('apply-custom-wall');
  ui.blurSlider = document.getElementById('blur-slider');
  ui.blurVal = document.getElementById('blur-val');
  ui.gradientIntensitySlider = document.getElementById('gradient-intensity-slider');
  ui.gradientIntensityVal = document.getElementById('gradient-intensity-val');
  ui.particlePattern = document.getElementById('particle-pattern');
  ui.themeArea = document.getElementById('theme-selection-area');
  ui.status = document.getElementById('data-status');
  ui.statAds = document.getElementById('stat-ads');
  ui.statKeywords = document.getElementById('stat-keywords');
  ui.keywordStatBadge = document.getElementById('keyword-stat-badge');
  ui.themeBtns = Array.from(document.querySelectorAll('.theme-btn'));
  ui.feedWidthSlider = document.getElementById('feed-width-slider');
  ui.feedWidthVal = document.getElementById('feed-width-val');
  ui.feedWidthContainer = document.getElementById('feed-width-container');
  ui.particleSpeedSlider = document.getElementById('particle-speed-slider');
  ui.particleSpeedVal = document.getElementById('particle-speed-val');
  ui.particleSpeedContainer = document.getElementById('particle-speed-container');
  ui.themeOptionsArea = document.getElementById('theme-options-area');
  ui.reelsTimeoutThreshold = document.getElementById('reels-timeout-threshold');
  ui.reelsTimeoutMessage = document.getElementById('reels-timeout-message');
  ui.reelsTimeoutContainer = document.getElementById('reels-timeout-container');
  ui.hoverZoomExcludeUrls = document.getElementById('hover-zoom-exclude-urls');
  ui.hoverZoomExcludeContainer = document.getElementById('hover-zoom-exclude-container');
  ui.keywordFilterTerms = document.getElementById('keyword-filter-terms');
  ui.keywordFilterContainer = document.getElementById('keyword-filter-container');
  ui.fontFamilySelect = document.getElementById('font-family-select');
  ui.fontFamilyContainer = document.getElementById('font-family-container');
  ui.fontSizeSlider = document.getElementById('font-size-slider');
  ui.fontSizeVal = document.getElementById('font-size-val');
  ui.fontSizeContainer = document.getElementById('font-size-container');
  ui.resetFontSize = document.getElementById('reset-font-size');

  ui.hoverZoomPinToggle = document.getElementById('hover-zoom-pin-toggle');
  ui.hoverZoomPinRow = document.getElementById('hover-zoom-pin-row');
  ui.hoverZoomPinUrl = document.getElementById('hover-zoom-pin-url');
  ui.hoverZoomPinUrlBtn = document.getElementById('hover-zoom-pin-url-btn');
  ui.hoverZoomPinUrlContainer = document.getElementById('hover-zoom-pin-url-container');
  ui.hoverZoomModeBtns = Array.from(document.querySelectorAll('#hover-zoom-mode-container .segmented-btn'));
  ui.hoverZoomModeContainer = document.getElementById('hover-zoom-mode-container');
  ui.autoscrollSpeedSlider = document.getElementById('autoscroll-speed-slider');
  ui.autoscrollSpeedVal = document.getElementById('autoscroll-speed-val');
  ui.autoscrollSpeedContainer = document.getElementById('autoscroll-speed-container');
  ui.resetFeedWidth = document.getElementById('reset-feed-width');
  ui.themeFeedWidthSlider = document.getElementById('theme-feed-width-slider');
  ui.themeFeedWidthVal = document.getElementById('theme-feed-width-val');
  ui.themeResetFeedWidth = document.getElementById('theme-reset-feed-width');
}

function populateGrids() {
  // Populate Gradients
  GRADIENT_THEMES.forEach(theme => {
    const card = document.createElement('div');
    card.className = 'preview-card';
    card.dataset.id = theme.id;
    card.dataset.type = 'gradient';
    card.innerHTML = `
      <div class="preview-thumb ${theme.class}"></div>
      <div class="preview-label">${theme.label}</div>
    `;
    ui.gradientGrid.appendChild(card);
  });

  // Populate Wallpapers
  NATURE_WALLPAPERS.forEach(wall => {
    const card = document.createElement('div');
    card.className = 'preview-card';
    card.dataset.id = wall.id;
    card.dataset.type = 'wallpaper';
    card.dataset.url = wall.url;
    card.innerHTML = `
      <div class="preview-thumb" style="background-image: url('${wall.thumb}')"></div>
      <div class="preview-label">${wall.label}</div>
    `;
    ui.wallpaperGrid.appendChild(card);
  });
}

function bindEvents() {
  // Tab Switching
  ui.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;

      ui.tabBtns.forEach(b => b.classList.toggle('active', b === btn));
      ui.tabContents.forEach(c => c.classList.toggle('active', c.id === targetTab));

      // Scroll to top
      const appShell = document.querySelector('.app-shell');
      if (appShell) appShell.scrollTop = 0;
    });
  });

  // OPTIMIZATION: Event Delegation for setting rows
  // Instead of attaching listeners to every row, we attach one to the container
  document.querySelector('.tab-container').addEventListener('click', (e) => {
    const row = e.target.closest('.setting-row');
    if (!row) return;

    // Don't trigger if the input/slider itself was clicked
    if (e.target.tagName === 'INPUT' || e.target.classList.contains('slider')) return;

    const checkbox = row.querySelector('input[type="checkbox"]');
    if (checkbox) {
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
    }
  });

  ui.toggles.forEach((toggle) => {
    toggle.addEventListener('change', async () => {
      const category = toggle.dataset.category || 'unseen';
      const feature = toggle.dataset.feature;
      ensureFeature(category, feature);
      settings[category][feature].enable = toggle.checked;
      renderControlState();
      await persistSettings('Configuration synchronized');
    });
  });

  // Theme selection click
  [ui.gradientGrid, ui.wallpaperGrid].forEach(grid => {
    grid.addEventListener('click', async (e) => {
      const card = e.target.closest('.preview-card');
      if (!card) return;

      ensureFeature('homepage', 'FEED_BACKGROUND', { enable: false, gradient: 'cosmic', wallpaper: null });

      const type = card.dataset.type;
      const id = card.dataset.id;

      if (type === 'gradient') {
        settings.homepage.FEED_BACKGROUND.gradient = id;
        settings.homepage.FEED_BACKGROUND.wallpaper = null;
      } else {
        settings.homepage.FEED_BACKGROUND.gradient = null;
        settings.homepage.FEED_BACKGROUND.wallpaper = card.dataset.url;
      }

      ui.customWallInput.value = '';
      updateActivePreviews();
      await persistSettings('Theme applied');
    });
  });

  ui.customWallApply.addEventListener('click', async () => {
    const url = ui.customWallInput.value.trim();
    if (!url) return;

    ensureFeature('homepage', 'FEED_BACKGROUND', { enable: false, gradient: 'cosmic', wallpaper: null });
    settings.homepage.FEED_BACKGROUND.gradient = null;
    settings.homepage.FEED_BACKGROUND.wallpaper = url;

    updateActivePreviews();
    await persistSettings('Custom wallpaper applied');
  });

  ui.blurSlider.addEventListener('input', async () => {
    const val = Number(ui.blurSlider.value);
    ui.blurVal.textContent = val + 'px';

    ensureFeature('homepage', 'WALLPAPER_BLUR_INTENSITY', { amount: 0 });
    settings.homepage.WALLPAPER_BLUR_INTENSITY.amount = val;

    await persistSettings('Blur intensity adjusted');
  });

  ui.gradientIntensitySlider.addEventListener('input', async () => {
    const val = Number(ui.gradientIntensitySlider.value);
    ui.gradientIntensityVal.textContent = val + '%';

    ensureFeature('homepage', 'GRADIENT_INTENSITY', { amount: 100 });
    settings.homepage.GRADIENT_INTENSITY.amount = val;

    await persistSettings('Gradient intensity adjusted');
  });

  ui.particlePattern.addEventListener('change', async () => {
    ensureFeature('homepage', 'PARTICLE_PATTERN', { pattern: 'none' });
    settings.homepage.PARTICLE_PATTERN.pattern = ui.particlePattern.value;
    renderControlState();
    await persistSettings('Particle pattern changed');
  });

  ui.reelsSpeed.addEventListener('change', async () => {
    ensureFeature('homepage', 'REELS_DEFAULT_SPEED', { enable: false, speed: 1 });
    settings.homepage.REELS_DEFAULT_SPEED.speed = Number(ui.reelsSpeed.value) || 1;
    await persistSettings('Reels speed updated');
  });

  // Helper: send lightweight feed width update to active tab for smooth real-time resizing
  let feedWidthDebounce = null;
  async function sendFeedWidthToTab(width) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) chrome.tabs.sendMessage(tab.id, { type: 'UPDATE_FEED_WIDTH', width });
    } catch (e) { /* ignore */ }
  }

  ui.feedWidthSlider.addEventListener('input', async () => {
    const val = Number(ui.feedWidthSlider.value);
    ui.feedWidthVal.textContent = val + '%';
    if (ui.themeFeedWidthSlider) ui.themeFeedWidthSlider.value = val;
    if (ui.themeFeedWidthVal) ui.themeFeedWidthVal.textContent = val + '%';

    ensureFeature('homepage', 'FEED_WIDTH', { width: 100 });
    settings.homepage.FEED_WIDTH.width = val;

    // Smooth: send lightweight update for instant CSS variable change
    sendFeedWidthToTab(val);

    // Debounce the full save round-trip
    clearTimeout(feedWidthDebounce);
    feedWidthDebounce = setTimeout(() => persistSettings('Feed width adjusted'), 250);
  });

  if (ui.themeFeedWidthSlider) {
    ui.themeFeedWidthSlider.addEventListener('input', async () => {
      const val = Number(ui.themeFeedWidthSlider.value);
      ui.themeFeedWidthVal.textContent = val + '%';
      ui.feedWidthSlider.value = val;
      ui.feedWidthVal.textContent = val + '%';

      ensureFeature('homepage', 'FEED_WIDTH', { width: 100 });
      settings.homepage.FEED_WIDTH.width = val;

      // Smooth: send lightweight update for instant CSS variable change
      sendFeedWidthToTab(val);

      // Debounce the full save round-trip
      clearTimeout(feedWidthDebounce);
      feedWidthDebounce = setTimeout(() => persistSettings('Feed width adjusted'), 250);
    });
  }

  ui.resetFeedWidth.addEventListener('click', async () => {
    ui.feedWidthSlider.value = 60;
    ui.feedWidthVal.textContent = '60%';

    ensureFeature('homepage', 'FEED_WIDTH', { width: 60 });
    settings.homepage.FEED_WIDTH.width = 60;

    sendFeedWidthToTab(60);
    await persistSettings('Feed width reset to normal');
  });

  if (ui.themeResetFeedWidth) {
    ui.themeResetFeedWidth.addEventListener('click', async () => {
      ui.themeFeedWidthSlider.value = 60;
      ui.themeFeedWidthVal.textContent = '60%';
      ui.feedWidthSlider.value = 60;
      ui.feedWidthVal.textContent = '60%';

      ensureFeature('homepage', 'FEED_WIDTH', { width: 60 });
      settings.homepage.FEED_WIDTH.width = 60;

      sendFeedWidthToTab(60);
      await persistSettings('Feed width reset to normal');
    });
  }

  ui.particleSpeedSlider.addEventListener('input', async () => {
    const val = Number(ui.particleSpeedSlider.value);
    ui.particleSpeedVal.textContent = val + 'x';

    ensureFeature('homepage', 'PARTICLE_SPEED', { speed: 1 });
    settings.homepage.PARTICLE_SPEED.speed = val;

    await persistSettings('Particle speed adjusted');
  });

  ui.reelsTimeoutThreshold.addEventListener('change', async () => {
    ensureFeature('homepage', 'REELS_TIMEOUT', { enable: false, threshold: 100, message: '' });
    settings.homepage.REELS_TIMEOUT.threshold = Math.max(1, Number(ui.reelsTimeoutThreshold.value) || 100);
    await persistSettings('Reels timeout threshold updated');
  });

  ui.reelsTimeoutMessage.addEventListener('change', async () => {
    ensureFeature('homepage', 'REELS_TIMEOUT', { enable: false, threshold: 100, message: '' });
    settings.homepage.REELS_TIMEOUT.message = ui.reelsTimeoutMessage.value.trim();
    await persistSettings('Reels timeout message updated');
  });

  if (ui.keywordFilterTerms) {
    ui.keywordFilterTerms.addEventListener('change', async () => {
      ensureFeature('homepage', 'KEYWORD_FILTER', { enable: false, terms: [] });
      const rawText = ui.keywordFilterTerms.value;
      settings.homepage.KEYWORD_FILTER.terms = rawText
        .split(/[\n,]/)
        .map(t => t.trim())
        .filter(Boolean);
      await persistSettings('Keyword filter updated');
    });
  }

  ui.fontFamilySelect.addEventListener('change', async () => {
    ensureFeature('homepage', 'CUSTOM_FONT', { enable: false, family: 'default', size: 100 });
    settings.homepage.CUSTOM_FONT.family = ui.fontFamilySelect.value;
    await persistSettings('Font family updated');
  });

  ui.fontSizeSlider.addEventListener('input', async () => {
    const val = Number(ui.fontSizeSlider.value);
    ui.fontSizeVal.textContent = val + '%';
    ensureFeature('homepage', 'CUSTOM_FONT', { enable: false, family: 'default', size: 100 });
    settings.homepage.CUSTOM_FONT.size = val;
    await persistSettings('Font size updated');
  });

  ui.resetFontSize.addEventListener('click', async () => {
    ui.fontSizeSlider.value = 100;
    ui.fontSizeVal.textContent = '100%';
    ensureFeature('homepage', 'CUSTOM_FONT', { enable: false, family: 'default', size: 100 });
    settings.homepage.CUSTOM_FONT.size = 100;
    await persistSettings('Font size reset');
  });

  ui.hoverZoomExcludeUrls.addEventListener('change', async () => {
    ensureFeature('homepage', 'HOVER_ZOOM', { enable: false, excludeUrls: '' });
    settings.homepage.HOVER_ZOOM.excludeUrls = ui.hoverZoomExcludeUrls.value;
    await persistSettings('Hover zoom exclude URLs updated');
  });



  ui.hoverZoomPinToggle.addEventListener('change', async () => {
    ensureFeature('homepage', 'HOVER_ZOOM', { enable: false, excludeUrls: '', upscaleSmall: true, enablePin: true });
    settings.homepage.HOVER_ZOOM.enablePin = ui.hoverZoomPinToggle.checked;
    await persistSettings('Hover zoom pin setting updated');
  });

  if (ui.hoverZoomModeContainer) {
    ui.hoverZoomModeContainer.addEventListener('click', async (e) => {
      const btn = e.target.closest('.segmented-btn');
      if (!btn) return;

      const mode = btn.dataset.mode;
      ensureFeature('homepage', 'HOVER_ZOOM', { enable: false, mode: 'popup' });
      settings.homepage.HOVER_ZOOM.mode = mode;

      ui.hoverZoomModeBtns.forEach(b => b.classList.toggle('active', b === btn));

      // Update mode description
      const descEl = document.getElementById('hover-zoom-mode-desc');
      if (descEl) {
        descEl.textContent = mode === 'inline'
          ? 'Zoom and pan images directly within the feed without opening a separate preview'
          : 'Opens a floating preview window when you hover over images in the feed';
      }

      await persistSettings('Hover zoom mode updated');
    });
  }

  ui.hoverZoomPinUrlBtn.addEventListener('click', async () => {
    const text = ui.hoverZoomPinUrl.value.trim();
    if (!text) return;
    const urls = text.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    if (urls.length === 0) return;
    // Send to active Facebook tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { type: 'PIN_IMAGES', urls });
    }
    ui.hoverZoomPinUrl.value = '';
  });

  ui.autoscrollSpeedSlider.addEventListener('input', async () => {
    const val = Number(ui.autoscrollSpeedSlider.value);
    ui.autoscrollSpeedVal.textContent = val + 'px';

    ensureFeature('homepage', 'AUTO_SCROLL', { enable: false, speed: 2 });
    settings.homepage.AUTO_SCROLL.speed = val;

    await persistSettings('Auto scroll speed adjusted');
  });

  // UI Theme Switching
  ui.themeBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const theme = btn.dataset.theme;

      if (!settings.global) settings.global = {};
      settings.global.THEME = theme;

      applyTheme();
      await persistSettings('Theme updated');
    });
  });

  document.getElementById('reset-analytics').addEventListener('click', async () => {
    try {
      const response = await sendMessage({ type: 'RESET_ANALYTICS' });
      renderAnalytics(response?.stats || {});
      setStatus('Stats reset successfully', 'success');
    } catch (error) {
      setStatus('Reset aborted', 'error');
    }
  });

  document.getElementById('set-default').addEventListener('click', async () => {
    if (confirm('Are you sure you want to restore all settings to default?')) {
      settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      renderSettings();
      await persistSettings('Restored to default settings');
    }
  });

  // Export Settings
  document.getElementById('export-settings').addEventListener('click', async () => {
    try {
      const exported = JSON.stringify(settings, null, 2);
      const blob = new Blob([exported], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `astra-settings-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus('Settings exported', 'success');
    } catch (error) {
      setStatus('Export failed', 'error');
    }
  });

  // Import Settings
  const importFileInput = document.getElementById('import-file-input');
  document.getElementById('import-settings').addEventListener('click', () => {
    importFileInput.click();
  });

  importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const imported = JSON.parse(text);

      // Basic validation: must have at least one known category
      if (!imported.homepage && !imported.unseen && !imported.browser) {
        throw new Error('Invalid settings file');
      }

      if (confirm('Import will overwrite your current settings. Continue?')) {
        settings = deepMergeDefaults(DEFAULT_SETTINGS, imported);
        renderSettings();
        await persistSettings('Settings imported successfully');
      }
    } catch (error) {
      if (error.message === 'Invalid settings file') {
        setStatus('Invalid settings file', 'error');
      } else {
        setStatus('Import failed — invalid JSON', 'error');
      }
    }

    // Reset the input so the same file can be re-imported
    importFileInput.value = '';
  });
}

async function persistSettings(successMessage) {
  try {
    const response = await sendMessage({ type: 'SAVE_SETTINGS', settings });
    if (!response?.success) {
      throw new Error('save_failed');
    }

    settings = deepMergeDefaults(DEFAULT_SETTINGS, response.settings || settings);
    setStatus(successMessage || 'Saved', 'success');
    renderControlState();
  } catch (error) {
    setStatus('Connection error', 'error');
  }
}

function renderSettings() {
  ui.toggles.forEach((toggle) => {
    const category = toggle.dataset.category || 'unseen';
    const feature = toggle.dataset.feature;
    toggle.checked = Boolean(settings?.[category]?.[feature]?.enable);
  });

  ui.reelsSpeed.value = String(settings?.homepage?.REELS_DEFAULT_SPEED?.speed || 1);

  const blurAmount = settings?.homepage?.WALLPAPER_BLUR_INTENSITY?.amount || 0;
  ui.blurSlider.value = blurAmount;
  ui.blurVal.textContent = blurAmount + 'px';

  const gradientIntensity = settings?.homepage?.GRADIENT_INTENSITY?.amount || 100;
  ui.gradientIntensitySlider.value = gradientIntensity;
  ui.gradientIntensityVal.textContent = gradientIntensity + '%';

  ui.particlePattern.value = settings?.homepage?.PARTICLE_PATTERN?.pattern || 'none';

  const feedWidth = settings?.homepage?.FEED_WIDTH?.width || 100;
  ui.feedWidthSlider.value = feedWidth;
  ui.feedWidthVal.textContent = feedWidth + '%';
  if (ui.themeFeedWidthSlider) {
    ui.themeFeedWidthSlider.value = feedWidth;
    ui.themeFeedWidthVal.textContent = feedWidth + '%';
  }

  const particleSpeed = settings?.homepage?.PARTICLE_SPEED?.speed || 1;
  ui.particleSpeedSlider.value = particleSpeed;
  ui.particleSpeedVal.textContent = particleSpeed + 'x';

  const reelsTimeoutThreshold = settings?.homepage?.REELS_TIMEOUT?.threshold || 100;
  ui.reelsTimeoutThreshold.value = reelsTimeoutThreshold;

  const reelsTimeoutMessage = settings?.homepage?.REELS_TIMEOUT?.message || '';
  ui.reelsTimeoutMessage.value = reelsTimeoutMessage;

  if (ui.keywordFilterTerms) {
    const keywordTerms = settings?.homepage?.KEYWORD_FILTER?.terms || [];
    const keywordText = Array.isArray(keywordTerms) ? keywordTerms.join('\n') : String(keywordTerms);
    ui.keywordFilterTerms.value = keywordText;
  }

  const fontFamily = settings?.homepage?.CUSTOM_FONT?.family || 'default';
  ui.fontFamilySelect.value = fontFamily;

  const fontSize = settings?.homepage?.CUSTOM_FONT?.size || 100;
  ui.fontSizeSlider.value = fontSize;
  ui.fontSizeVal.textContent = fontSize + '%';

  const hoverZoomExcludeUrls = settings?.homepage?.HOVER_ZOOM?.excludeUrls || '';
  ui.hoverZoomExcludeUrls.value = hoverZoomExcludeUrls;



  const hoverZoomPin = settings?.homepage?.HOVER_ZOOM?.enablePin !== false;
  ui.hoverZoomPinToggle.checked = hoverZoomPin;

  const hoverZoomMode = settings?.homepage?.HOVER_ZOOM?.mode || 'popup';
  ui.hoverZoomModeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === hoverZoomMode);
  });

  // Set mode description text
  const descEl = document.getElementById('hover-zoom-mode-desc');
  if (descEl) {
    descEl.textContent = hoverZoomMode === 'inline'
      ? 'Zoom and pan images directly within the feed without opening a separate preview'
      : 'Opens a floating preview window when you hover over images in the feed';
  }

  const autoscrollSpeed = settings?.homepage?.AUTO_SCROLL?.speed || 2;
  ui.autoscrollSpeedSlider.value = autoscrollSpeed;
  ui.autoscrollSpeedVal.textContent = autoscrollSpeed + 'px';

  if (settings.homepage.FEED_BACKGROUND?.wallpaper &&
    !NATURE_WALLPAPERS.some(w => w.url === settings.homepage.FEED_BACKGROUND.wallpaper)) {
    ui.customWallInput.value = settings.homepage.FEED_BACKGROUND.wallpaper;
  } else {
    ui.customWallInput.value = '';
  }

  updateActivePreviews();
  renderControlState();
  applyTheme();
}

function applyTheme() {
  const theme = settings.global?.THEME || 'system';

  // Remove force classes
  document.body.classList.remove('force-dark', 'force-light');

  if (theme === 'dark') {
    document.body.classList.add('force-dark');
  } else if (theme === 'light') {
    document.body.classList.add('force-light');
  }

  // Update buttons
  ui.themeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

function updateActivePreviews() {
  const currentGradient = settings.homepage.FEED_BACKGROUND?.gradient;
  const currentWallpaper = settings.homepage.FEED_BACKGROUND?.wallpaper;

  document.querySelectorAll('.preview-card').forEach(card => {
    if (card.dataset.type === 'gradient') {
      card.classList.toggle('active', card.dataset.id === currentGradient);
    } else {
      card.classList.toggle('active', card.dataset.url === currentWallpaper);
    }
  });
}

function renderControlState() {
  const feedBackgroundEnabled = Boolean(settings?.homepage?.FEED_BACKGROUND?.enable);
  const reelSpeedEnabled = Boolean(settings?.homepage?.REELS_DEFAULT_SPEED?.enable);
  const feedWidthEnabled = Boolean(settings?.homepage?.FULL_WIDTH_FEED?.enable);
  const particlesEnabled = settings?.homepage?.PARTICLE_PATTERN?.pattern !== 'none';
  const reelsTimeoutEnabled = Boolean(settings?.homepage?.REELS_TIMEOUT?.enable);

  // Disable all theme options when "Activate Theme" is off
  if (ui.themeOptionsArea) {
    ui.themeOptionsArea.classList.toggle('disabled', !feedBackgroundEnabled);
    // Also disable all inputs inside the theme options area
    const themeInputs = ui.themeOptionsArea.querySelectorAll('input, select');
    themeInputs.forEach(input => {
      input.disabled = !feedBackgroundEnabled;
    });
  }
  if (ui.themeArea) ui.themeArea.classList.toggle('disabled', !feedBackgroundEnabled);

  ui.reelsSpeed.disabled = !reelSpeedEnabled;
  if (ui.feedWidthContainer) ui.feedWidthContainer.classList.toggle('disabled', !feedWidthEnabled);
  if (ui.feedWidthSlider) ui.feedWidthSlider.disabled = !feedWidthEnabled;

  // Particle speed is double-gated: theme must be on AND a particle pattern must be selected
  const particleSpeedEnabled = feedBackgroundEnabled && particlesEnabled;
  if (ui.particleSpeedContainer) ui.particleSpeedContainer.classList.toggle('disabled', !particleSpeedEnabled);
  if (ui.particleSpeedSlider) ui.particleSpeedSlider.disabled = !particleSpeedEnabled;

  // Reels timeout controls
  if (ui.reelsTimeoutContainer) ui.reelsTimeoutContainer.classList.toggle('disabled', !reelsTimeoutEnabled);
  if (ui.reelsTimeoutThreshold) ui.reelsTimeoutThreshold.disabled = !reelsTimeoutEnabled;
  if (ui.reelsTimeoutMessage) ui.reelsTimeoutMessage.disabled = !reelsTimeoutEnabled;

  // Keyword filter controls
  const keywordFilterEnabled = Boolean(settings?.homepage?.KEYWORD_FILTER?.enable);
  if (ui.keywordFilterContainer) ui.keywordFilterContainer.classList.toggle('disabled', !keywordFilterEnabled);
  if (ui.keywordFilterTerms) ui.keywordFilterTerms.disabled = !keywordFilterEnabled;

  // Font customization controls
  const customFontEnabled = Boolean(settings?.homepage?.CUSTOM_FONT?.enable);
  if (ui.fontFamilyContainer) ui.fontFamilyContainer.classList.toggle('disabled', !customFontEnabled);
  if (ui.fontFamilySelect) ui.fontFamilySelect.disabled = !customFontEnabled;
  if (ui.fontSizeContainer) ui.fontSizeContainer.classList.toggle('disabled', !customFontEnabled);
  if (ui.fontSizeSlider) ui.fontSizeSlider.disabled = !customFontEnabled;
  if (ui.resetFontSize) ui.resetFontSize.disabled = !customFontEnabled;

  // Hover zoom exclude controls
  const hoverZoomEnabled = Boolean(settings?.homepage?.HOVER_ZOOM?.enable);
  if (ui.hoverZoomExcludeContainer) ui.hoverZoomExcludeContainer.classList.toggle('disabled', !hoverZoomEnabled);
  if (ui.hoverZoomExcludeUrls) ui.hoverZoomExcludeUrls.disabled = !hoverZoomEnabled;

  if (ui.hoverZoomPinRow) ui.hoverZoomPinRow.classList.toggle('disabled', !hoverZoomEnabled);
  if (ui.hoverZoomPinToggle) ui.hoverZoomPinToggle.disabled = !hoverZoomEnabled;
  if (ui.hoverZoomPinUrlContainer) ui.hoverZoomPinUrlContainer.classList.toggle('disabled', !hoverZoomEnabled);
  if (ui.hoverZoomPinUrl) ui.hoverZoomPinUrl.disabled = !hoverZoomEnabled;
  if (ui.hoverZoomPinUrlBtn) ui.hoverZoomPinUrlBtn.disabled = !hoverZoomEnabled;
  if (ui.hoverZoomModeContainer) ui.hoverZoomModeContainer.classList.remove('disabled');
  if (ui.hoverZoomModeBtns) ui.hoverZoomModeBtns.forEach(btn => btn.disabled = false);

  // Auto scroll speed controls
  const autoScrollEnabled = Boolean(settings?.homepage?.AUTO_SCROLL?.enable);
  if (ui.autoscrollSpeedContainer) ui.autoscrollSpeedContainer.classList.toggle('disabled', !autoScrollEnabled);
  if (ui.autoscrollSpeedSlider) ui.autoscrollSpeedSlider.disabled = !autoScrollEnabled;
}

async function refreshAnalytics() {
  try {
    const response = await sendMessage({ type: 'GET_ANALYTICS' });
    renderAnalytics(response?.stats || {});
  } catch (error) {
    // Keep previous values if polling fails.
  }
}

function renderAnalytics(stats) {
  const hiddenAds = Math.max(0, Number(stats.hiddenAds) || 0);
  ui.statAds.textContent = String(hiddenAds);

  const hiddenKeywords = Math.max(0, Number(stats.hiddenKeywordPosts) || 0);
  if (ui.statKeywords) ui.statKeywords.textContent = String(hiddenKeywords);
  if (ui.keywordStatBadge) {
    ui.keywordStatBadge.style.display = hiddenKeywords > 0 ? 'flex' : 'none';
  }
}

function ensureFeature(category, feature, fallback) {
  if (!settings[category]) {
    settings[category] = {};
  }

  if (!settings[category][feature]) {
    settings[category][feature] = fallback || { enable: false };
  }
}

function setStatus(message, tone) {
  if (!ui.status) {
    return;
  }

  ui.status.textContent = message || 'All systems operational';
  ui.status.className = 'status-indicator';

  if (tone === 'success') {
    ui.status.classList.add('success');
  } else if (tone === 'error') {
    ui.status.classList.add('error');
  }

  if (statusTimer) {
    clearTimeout(statusTimer);
  }

  if (message) {
    statusTimer = setTimeout(() => {
      ui.status.textContent = 'All systems operational';
      ui.status.className = 'status-indicator';
    }, 3000);
  }
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

function sendMessage(message, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Message timeout — service worker may be waking up'));
    }, timeoutMs);

    chrome.runtime.sendMessage(message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

/* Rating System */

async function checkRatingPrompt() {
  const data = await chrome.storage.local.get('meta');
  const meta = data.meta || {};
  const installDate = meta.installDate || Date.now();
  const now = Date.now();
  const twoWeeks = 14 * 24 * 60 * 60 * 1000;

  // Check if enough time has passed (2 weeks)
  if ((meta.ratingStatus || 'pending') === 'pending' && (now - installDate) > twoWeeks) {
    const modal = document.getElementById('rating-modal');
    if (!modal) return;

    modal.classList.remove('hidden');

    const rateNowBtn = document.getElementById('rate-now');
    const rateLaterBtn = document.getElementById('rate-later');

    rateNowBtn.onclick = async () => {
      const extId = chrome.runtime.id;
      const url = `https://chrome.google.com/webstore/detail/${extId}/reviews`;
      window.open(url, '_blank');
      await setRatingStatus('rated');
      modal.classList.add('hidden');
    };

    rateLaterBtn.onclick = async () => {
      await setRatingStatus('dismissed');
      modal.classList.add('hidden');
    };
  }
}

async function setRatingStatus(status) {
  const data = await chrome.storage.local.get('meta');
  const meta = data.meta || {};
  meta.ratingStatus = status;
  await chrome.storage.local.set({ meta });
}

