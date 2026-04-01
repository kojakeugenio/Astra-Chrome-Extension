/**
 * FB Toolkit — Homepage Customization Script
 * Injected into Facebook to apply homepage layout customizations.
 * Uses CSS injection to hide/show sidebar elements.
 */
(function () {
    'use strict';

    // Prevent double-injection
    if (window.__fb_toolkit_homepage_loaded) return;
    window.__fb_toolkit_homepage_loaded = true;
    const relayCountedAdUnitIds = new Set();
    const relayCountedSidebarAdIds = new Set();

    // ══════════════════════════════════════════════════════════════════════════
    // RELAY STORE-BASED AD FILTERING (from fb ad blocker)
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Wait for requireLazy to be available, then set up module-level filtering.
     * This intercepts feed items at the React component level for reliable ad detection.
     */
    function waitForCondition(check, callback) {
        function loop() {
            if (check()) callback();
            else requestAnimationFrame(loop);
        }
        loop();
    }

    waitForCondition(
        () => !!window.requireLazy && !!window.moduleProxyDefine && !!window.defineModule,
        () => {
            // Define the feed unit filter component
            window.defineModule('CometFeedUnitErrorBoundary.react', function FilteredFeedUnit(props) {
                const { payload, lastCmp } = props;
                const react = window.require('react');

                // Only filter on homepage
                if (window.location.pathname !== '/' && window.location.pathname !== '/home.php') {
                    return lastCmp;
                }

                // Check if Hide Ads is enabled
                const hideAdsEnabled = window.fb_toolkit?.homepage?.HIDE_ADS?.enable;
                if (!hideAdsEnabled) {
                    return lastCmp;
                }

                // Get feed unit ID from payload
                const feedUnitId =
                    payload?.feedUnit?.id ||
                    payload?.feedUnit?.__id ||
                    payload?.children?.[0]?.props?.children?.props?.feedUnit?.id ||
                    payload?.children?.[0]?.props?.children?.props?.feedUnit?.__id;

                if (!feedUnitId) {
                    return lastCmp;
                }

                // Use storeFinder to check for sponsored data
                try {
                    const hasAdId =
                        !!(window.storeFinder && window.storeFinder(feedUnitId, '^sponsored_data.ad_id')) ||
                        !!(window.storeFinder && window.storeFinder(feedUnitId, 'sponsored_data.ad_id'));

                    if (hasAdId) {
                        if (!relayCountedAdUnitIds.has(feedUnitId)) {
                            relayCountedAdUnitIds.add(feedUnitId);
                            queueAnalyticsIncrement('hiddenAds');
                        }
                        // Return empty fragment to hide the ad
                        return react.jsx(react.Fragment, {});
                    }
                } catch (e) {
                    // Relay store may not be ready yet. Keep original post.
                }

                return lastCmp;
            }, {
                fallback: (e) => {
                    console.error('[fb-toolkit] Feed filter error:', e);
                    return null;
                }
            });

            // Hide sidebar ads
            window.defineModule('CometAdsSideFeedUnitItem.react', function FilteredSidebarAd(props) {
                const react = window.require('react');
                const hideAdsEnabled = window.fb_toolkit?.homepage?.HIDE_ADS?.enable;

                if (hideAdsEnabled) {
                    const sidebarAdId =
                        props?.payload?.id ||
                        props?.payload?.__id ||
                        props?.payload?.ad_id ||
                        props?.payload?.adId ||
                        null;

                    if (sidebarAdId && !relayCountedSidebarAdIds.has(sidebarAdId)) {
                        relayCountedSidebarAdIds.add(sidebarAdId);
                        queueAnalyticsIncrement('hiddenAds');
                    }

                    // Return empty to hide sidebar ads
                    return react.jsx(react.Fragment, {});
                }
                return props.lastCmp;
            });

            console.log('[fb-toolkit] Relay store-based ad filtering initialized');
        }
    );

    const STYLE_ID = 'fb-toolkit-homepage-styles';
    const AD_HIDDEN_CLASS = 'fb-toolkit-hidden-ad';
    const SUGGESTION_HIDDEN_CLASS = 'fb-toolkit-hidden-suggestion';
    const PEOPLE_HIDDEN_CLASS = 'fb-toolkit-hidden-people';
    const KEYWORD_HIDDEN_CLASS = 'fb-toolkit-hidden-keyword';
    const REEL_CONTROL_PANEL_ID = 'fb-toolkit-reel-controls';
    const AUTOSCROLL_PANEL_ID = 'fb-toolkit-autoscroll-controls';
    const REEL_SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    const FEED_POST_CARD_SELECTOR = `
        div[role="main"] div[role="feed"] div[role="article"][aria-posinset],
        div[role="main"] div[data-pagelet^="FeedUnit_"] div[role="article"],
        div[role="main"] div[role="feed"] > div > div[role="article"],
        div[role="main"] div[role="feed"] div[role="article"]
    `;
    const FEED_ARTICLE_SELECTORS = [
        FEED_POST_CARD_SELECTOR,
        'div[role="feed"] div[role="article"]',
        'div[data-pagelet^="FeedUnit_"] div[role="article"]'
    ];

    const SUGGESTION_MARKERS = [
        'suggested for you',
        'people you may know',
        'because you watched',
        'suggested groups',
        'join group',
        'discover more',
        'recommended for you'
    ];

    const hiddenNodeTracker = {
        ads: new WeakSet(),
        suggestions: new WeakSet(),
        people: new WeakSet(),
        keywordPosts: new WeakSet(),
        marketplaceAds: new WeakSet()
    };

    const MARKETPLACE_AD_HIDDEN_CLASS = 'fb-toolkit-hidden-marketplace-ad';

    const pendingAnalyticsDelta = {
        hiddenAds: 0,
        hiddenSuggestions: 0,
        hiddenPeople: 0,
        hiddenKeywordPosts: 0
    };

    let analyticsFlushTimer = null;
    let contentFilterQueued = false;
    let reelPreferencesQueued = false;
    let reelAutoNextEnabled = false;
    let reelAutoNextVideoRef = null;
    let reelAutoNextIntervalId = null;
    let reelAutoNextCooldownUntil = 0; // Timestamp: ignore auto-next triggers until this time
    const REEL_AUTO_NEXT_COOLDOWN_MS = 2500; // 2.5s cooldown after each auto-next navigation
    let reelWatchCount = 0;
    let reelWatchCountInitialized = false;
    let reelTimeoutCount = 0; // Separate counter for timeout feature
    let lastReelViewTime = null; // Track when user last watched a reel for auto-reset
    let lastTrackedReelUrl = null;
    let lastSkippedSponsoredUrl = null;
    let sponsoredSkipInProgress = false;
    let autoScrollIntervalId = null;
    let reelImmersiveEnabled = true;
    let reelImmersiveIntervalId = null;
    const REEL_IMMERSIVE_BG_ID = 'fb-toolkit-immersive-bg';
    let reelCountdownActive = false;
    let autoScrollActive = false;
    let autoScrollPanelHidden = false;

    // CSS selectors for Facebook sidebars
    // These target the main layout containers on facebook.com homepage
    const HOMEPAGE_STYLES = {
        baseHiddenStyles: `
            .${AD_HIDDEN_CLASS},
            .${SUGGESTION_HIDDEN_CLASS},
            .${PEOPLE_HIDDEN_CLASS},
            .${KEYWORD_HIDDEN_CLASS} {
                display: none !important;
            }
        `,
        hideLeftSidebar: `
            /* Hide left sidebar - navigation column (animated) */
            div[role="navigation"][class*="x9f619"]:has(ul),
            div[role="navigation"][aria-label="Facebook"], 
            div[role="navigation"][aria-label="Shortcuts"],
            div[data-pagelet="LeftRail"], 
            div[data-pagelet="LeftNav"] {
                width: 0 !important;
                min-width: 0 !important;
                flex-basis: 0 !important;
                padding-left: 0 !important;
                padding-right: 0 !important;
                margin-left: 0 !important;
                opacity: 0 !important;
                transform: translateX(-30px) !important;
                overflow: hidden !important;
                pointer-events: none !important;
                transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            min-width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            flex-basis 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            padding 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            margin 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            opacity 0.3s ease,
                            transform 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
        `,
        hideRightSidebar: `
            /* Hide right sidebar - contacts and sponsored (animated) */
            div[role="complementary"],
            div[data-pagelet="RightRail"] {
                width: 0 !important;
                min-width: 0 !important;
                flex-basis: 0 !important;
                padding-left: 0 !important;
                padding-right: 0 !important;
                margin-right: 0 !important;
                opacity: 0 !important;
                transform: translateX(30px) !important;
                overflow: hidden !important;
                pointer-events: none !important;
                transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            min-width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            flex-basis 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            padding 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            margin 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            opacity 0.3s ease,
                            transform 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }

            /* Hide floating "New message" compose button */
            div:has(> span [aria-label="New message"][role="button"]) {
                opacity: 0 !important;
                pointer-events: none !important;
                transform: scale(0.8) !important;
                transition: opacity 0.3s ease, transform 0.3s ease !important;
            }
        `,
        hideNavBar: `
            /* Hide Navigation Bar (animated) */
            div[role="banner"],
            div[data-pagelet="BlueBar"], 
            #pagelet_bluebar {
                max-height: 0 !important;
                min-height: 0 !important;
                padding-top: 0 !important;
                padding-bottom: 0 !important;
                margin-top: 0 !important;
                margin-bottom: 0 !important;
                opacity: 0 !important;
                transform: translateY(-100%) !important;
                overflow: hidden !important;
                pointer-events: none !important;
                z-index: -1 !important;
                transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                            padding 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                            margin 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                            opacity 0.3s ease,
                            transform 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
            
            /* Adjust content top margin since nav bar is gone */
            div[role="main"], 
            #content, 
            .x9f619.x1n2onr6.x1ja2u2z {
                margin-top: 0 !important;
                padding-top: 0 !important;
                transition: margin-top 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                            padding-top 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
            
            /* Ensure the main grid layout doesn't break */
            .x9f619.x1n2onr6.x1ja2u2z {
                top: 0 !important;
                transition: top 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
        `,
        fullWidthFeed: (widthPercent = 100) => `
            /* CSS Custom Property for smooth slider updates */
            :root {
                --fb-feed-width: ${widthPercent}%;
            }

            /* Expand Main Feed Area - Dynamic Width */
            div[role="main"] {
                width: var(--fb-feed-width) !important;
                max-width: var(--fb-feed-width) !important;
                flex-grow: 0 !important;
                flex-shrink: 0 !important;
                flex-basis: var(--fb-feed-width) !important;
                min-width: 0 !important;
                margin: 0 auto !important;
                transition: width 0.15s ease-out, max-width 0.15s ease-out, flex-basis 0.15s ease-out;
            }

            /* Force immediate children to expand within the constrained main */
            div[role="main"] > div,
            div[role="main"] > div > div {
                width: 100% !important;
                max-width: 100% !important;
                flex-basis: auto !important;
                margin: 0 auto !important;
            }

            /* Core Feed Container & Stories */
            [aria-label="Stories"],
            div[role="feed"],
            div[role="feed"] > div {
                width: 100% !important;
                max-width: 100% !important;
            }

            /* Facebook Atomic Width Classes — Override the 680px fixed width on
               the main feed column. Uses the compound selector that uniquely
               identifies the structural feed container (which has all three
               classes) without affecting action bar button wrappers (which only
               have x193iq5w alone). */
            div[role="main"] .x193iq5w.xvue9z.x17zi3g0 {
                width: 100% !important;
                max-width: 100% !important;
            }

            /* Stories & Composer width — these classes constrain the Stories
               carousel and "What's on your mind" box to 680px independently
               of the feed column triad above. */
            div[role="main"] .xgmub6v,
            div[role="main"] .xwya9rg {
                width: 100% !important;
                max-width: 100% !important;
            }

            /* Center Alignment Wrapper */
            div[role="main"] > div > div > div {
                margin-left: auto !important;
                margin-right: auto !important;
                width: 100% !important;
                max-width: 100% !important;
            }

            /* Force any specific fixed-width containers to expand */
            div[style*="max-width: 680px"]:not(div[role="article"] *),
            div[style*="max-width: 590px"]:not(div[role="article"] *),
            div[style*="max-width: 500px"]:not(div[role="article"] *),
            div[style*="max-width: 744px"]:not(div[role="article"] *) {
                width: 100% !important;
                max-width: 100% !important;
            }

            /* Individual post cards / articles - fill the available width */
            div[role="feed"] div[role="article"] {
                width: 100% !important;
                max-width: 100% !important;
            }

            /* ── Reset inside articles ──
               Restore natural width for internal post elements (like/comment/share bar,
               reaction rows, etc.) so the broad selectors above don't break their flex layout */
            div[role="article"] div[role="button"],
            div[role="article"] span[role="toolbar"],
            div[role="article"] div[aria-label*="Like"],
            div[role="article"] div[aria-label*="Comment"],
            div[role="article"] div[aria-label*="Send"],
            div[role="article"] div[aria-label*="Share"] {
                width: auto !important;
                max-width: none !important;
            }
        `,
        hideWhatsOnYourMind: `
            /* Hide Create Post box ("What's on your mind?") - animated */
            div[role="main"] [aria-label="Create a post"] {
                max-height: 0 !important;
                opacity: 0 !important;
                overflow: hidden !important;
                margin-top: 0 !important;
                margin-bottom: 0 !important;
                padding-top: 0 !important;
                padding-bottom: 0 !important;
                transform: scale(0.95) !important;
                pointer-events: none !important;
                transition: max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            opacity 0.25s ease,
                            margin 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            padding 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            transform 0.3s ease !important;
            }
        `,
        hideStories: `
            /* Hide Stories section - animated */
            div[role="main"] [aria-label="Stories"] {
                max-height: 0 !important;
                opacity: 0 !important;
                overflow: hidden !important;
                margin-top: 0 !important;
                margin-bottom: 0 !important;
                padding-top: 0 !important;
                padding-bottom: 0 !important;
                transform: scale(0.95) !important;
                pointer-events: none !important;
                transition: max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            opacity 0.25s ease,
                            margin 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            padding 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            transform 0.3s ease !important;
            }
        `,
        hideReels: `
            /* Hide entire Reels section including header bar - uses :has()
               to target the grandparent that wraps both the "Reels" title bar
               and the carousel content */
            div[role="main"] div:has(> * > [aria-label="Reels"]),
            div[role="main"] div:has(> * > [aria-label="Reels and short videos"]),
            div[role="main"] [aria-label="Reels"],
            div[role="main"] [aria-label="Reels and short videos"] {
                max-height: 0 !important;
                opacity: 0 !important;
                overflow: hidden !important;
                margin-top: 0 !important;
                margin-bottom: 0 !important;
                padding-top: 0 !important;
                padding-bottom: 0 !important;
                transform: scale(0.95) !important;
                pointer-events: none !important;
                transition: max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            opacity 0.25s ease,
                            margin 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            padding 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            transform 0.3s ease !important;
            }
        `,
        reelsControls: `
            #${REEL_CONTROL_PANEL_ID} {
                position: fixed !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                gap: 4px !important;
                padding: 10px 8px !important;
                border-radius: 24px !important;
                background: rgba(15, 23, 42, 0.85) !important;
                backdrop-filter: blur(16px) saturate(140%) !important;
                -webkit-backdrop-filter: blur(16px) saturate(140%) !important;
                z-index: 2147483647 !important;
                pointer-events: auto !important;
                transition: all 250ms ease !important;
                opacity: 0.7 !important;
            }

            #${REEL_CONTROL_PANEL_ID}:hover {
                opacity: 1 !important;
                background: rgba(15, 23, 42, 0.95) !important;
                border-color: rgba(255, 255, 255, 0.15) !important;
            }

            #${REEL_CONTROL_PANEL_ID} button {
                position: relative !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 36px !important;
                height: 36px !important;
                min-width: unset !important;
                padding: 0 !important;
                border: none !important;
                border-radius: 50% !important;
                background: transparent !important;
                color: rgba(255, 255, 255, 0.9) !important;
                cursor: pointer !important;
                transition: all 100ms ease !important;
            }

            #${REEL_CONTROL_PANEL_ID} button:hover {
                background: rgba(255, 255, 255, 0.15) !important;
                color: #ffffff !important;
                transform: scale(1.08) !important;
            }

            #${REEL_CONTROL_PANEL_ID} button:active {
                transform: scale(0.92) !important;
            }

            #${REEL_CONTROL_PANEL_ID} button svg {
                width: 18px !important;
                height: 18px !important;
                fill: currentColor !important;
            }

            /* Custom tooltip popover */
            #${REEL_CONTROL_PANEL_ID} button[data-tooltip]:hover::after,
            #${REEL_CONTROL_PANEL_ID} select[data-tooltip]:hover::after {
                content: attr(data-tooltip) !important;
                position: absolute !important;
                right: calc(100% + 10px) !important;
                top: 50% !important;
                transform: translateY(-50%) !important;
                padding: 6px 12px !important;
                border-radius: 8px !important;
                background: rgba(0, 0, 0, 0.9) !important;
                backdrop-filter: blur(8px) !important;
                color: #fff !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                font-size: 12px !important;
                font-weight: 500 !important;
                line-height: 1.3 !important;
                white-space: nowrap !important;
                pointer-events: none !important;
                z-index: 2147483647 !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;
                border: 1px solid rgba(255,255,255,0.1) !important;
                animation: none !important;
            }

            /* Tooltip arrow */
            #${REEL_CONTROL_PANEL_ID} button[data-tooltip]:hover::before,
            #${REEL_CONTROL_PANEL_ID} select[data-tooltip]:hover::before {
                content: '' !important;
                position: absolute !important;
                right: calc(100% + 4px) !important;
                top: 50% !important;
                transform: translateY(-50%) !important;
                border: 5px solid transparent !important;
                border-left-color: rgba(0, 0, 0, 0.9) !important;
                pointer-events: none !important;
                z-index: 2147483647 !important;
            }

            #${REEL_CONTROL_PANEL_ID} select {
                position: relative !important;
            }

            #${REEL_CONTROL_PANEL_ID} .reel-divider {
                width: 24px !important;
                height: 1px !important;
                background: rgba(255, 255, 255, 0.15) !important;
                margin: 4px 0 !important;
            }

            #${REEL_CONTROL_PANEL_ID} select {
                appearance: none !important;
                -webkit-appearance: none !important;
                border: none !important;
                border-radius: 14px !important;
                background: rgba(255, 255, 255, 0.1) !important;
                color: rgba(255, 255, 255, 0.9) !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                font-size: 12px !important;
                font-weight: 600 !important;
                line-height: 1 !important;
                text-align: center !important;
                padding: 8px 12px !important;
                cursor: pointer !important;
                transition: all 100ms ease !important;
            }

            #${REEL_CONTROL_PANEL_ID} select:hover {
                background: rgba(255, 255, 255, 0.2) !important;
                color: #ffffff !important;
            }

            #${REEL_CONTROL_PANEL_ID} option {
                background: #1a1a1a !important;
                color: #fff !important;
            }

            #${REEL_CONTROL_PANEL_ID} button.active {
                background: #0666FF !important;
                color: #ffffff !important;
                box-shadow: 0 0 12px rgba(6, 102, 255, 0.45) !important;
                opacity: 1 !important;
            }

            #${REEL_CONTROL_PANEL_ID} button.active:hover {
                background: #0056e0 !important;
                box-shadow: 0 0 16px rgba(6, 102, 255, 0.6) !important;
            }

            /* Auto-next countdown inside button */
            #${REEL_CONTROL_PANEL_ID} button .countdown-inline {
                position: relative !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 24px !important;
                height: 24px !important;
            }

            #${REEL_CONTROL_PANEL_ID} button .countdown-inline svg {
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
                width: 24px !important;
                height: 24px !important;
                transform: rotate(-90deg) !important;
            }

            #${REEL_CONTROL_PANEL_ID} button .countdown-inline .cd-bg {
                fill: none !important;
                stroke: rgba(255,255,255,0.2) !important;
                stroke-width: 2 !important;
            }

            #${REEL_CONTROL_PANEL_ID} button .countdown-inline .cd-ring {
                fill: none !important;
                stroke: #fff !important;
                stroke-width: 2.5 !important;
                stroke-linecap: round !important;
                transition: stroke-dashoffset 0.25s linear !important;
            }

            #${REEL_CONTROL_PANEL_ID} button .countdown-inline .cd-num {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                font-size: 11px !important;
                font-weight: 700 !important;
                color: #fff !important;
                line-height: 1 !important;
                z-index: 1 !important;
            }

            #${REEL_CONTROL_PANEL_ID} .reel-counter {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                min-width: 28px !important;
                height: 24px !important;
                padding: 0 8px !important;
                border-radius: 12px !important;
                background: rgba(255, 255, 255, 0.1) !important;
                color: rgba(255, 255, 255, 0.9) !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                font-size: 12px !important;
                font-weight: 700 !important;
                cursor: pointer !important;
                transition: all 100ms ease !important;
            }

            #${REEL_CONTROL_PANEL_ID} .reel-counter:hover {
                background: rgba(255, 255, 255, 0.2) !important;
            }

            #fb-toolkit-counter-menu {
                position: fixed !important;
                display: none;
                flex-direction: column !important;
                gap: 2px !important;
                padding: 6px !important;
                border-radius: 8px !important;
                background: rgba(30, 30, 30, 0.95) !important;
                backdrop-filter: blur(12px) !important;
                border: 1px solid rgba(255, 255, 255, 0.15) !important;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4) !important;
                z-index: 2147483647 !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            }

            #fb-toolkit-counter-menu.show {
                display: flex !important;
            }

            #fb-toolkit-counter-menu button {
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                padding: 8px 12px !important;
                border: none !important;
                border-radius: 6px !important;
                background: transparent !important;
                color: rgba(255, 255, 255, 0.9) !important;
                font-size: 13px !important;
                cursor: pointer !important;
                transition: background 100ms ease !important;
                white-space: nowrap !important;
            }

            #fb-toolkit-counter-menu button:hover {
                background: rgba(255, 255, 255, 0.1) !important;
            }

            #fb-toolkit-counter-menu button.danger:hover {
                background: rgba(239, 68, 68, 0.3) !important;
                color: #fca5a5 !important;
            }
            #${REEL_CONTROL_PANEL_ID} .reel-counter.confirm {
                background: rgba(239, 68, 68, 0.6) !important;
                color: #fff !important;
            }

            #${REEL_CONTROL_PANEL_ID} .reel-counter:active {
                transform: scale(0.95) !important;
            }

            #${REEL_CONTROL_PANEL_ID} button.triggered {
                animation: fb-toolkit-auto-next-pulse 0.8s ease-in-out !important;
                z-index: 10 !important;
            }

            @keyframes fb-toolkit-auto-next-pulse {
                0% { transform: scale(1); box-shadow: 0 0 12px rgba(6, 102, 255, 0.45); }
                50% { transform: scale(1.4); box-shadow: 0 0 30px rgba(6, 102, 255, 0.9); background: #0056e0 !important; }
                100% { transform: scale(1); box-shadow: 0 0 12px rgba(6, 102, 255, 0.45); }
            }
        `,
        reelsTimeoutModal: `
            @keyframes fb-toolkit-modal-fade-in {
                from { opacity: 0; transform: scale(0.9); }
                to { opacity: 1; transform: scale(1); }
            }
            @keyframes fb-toolkit-modal-pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.02); }
            }
            @keyframes fb-toolkit-gradient-shift {
                0% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
            }
            @keyframes fb-toolkit-glass-shimmer {
                0% { background-position: -200% 0; }
                100% { background-position: 200% 0; }
            }
            @keyframes fb-toolkit-float {
                0%, 100% { transform: translateY(0px); }
                50% { transform: translateY(-8px); }
            }
            @keyframes fb-toolkit-glow-pulse {
                0%, 100% { box-shadow: 0 0 30px rgba(139, 92, 246, 0.3), 0 0 60px rgba(59, 130, 246, 0.2); }
                50% { box-shadow: 0 0 50px rgba(139, 92, 246, 0.5), 0 0 100px rgba(59, 130, 246, 0.3); }
            }
            #fb-toolkit-reels-timeout-modal {
                position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
                z-index: 2147483647 !important; display: flex !important; align-items: center !important; justify-content: center !important;
                background: linear-gradient(135deg, rgba(0, 0, 0, 0.7) 0%, rgba(15, 23, 42, 0.85) 100%) !important;
                backdrop-filter: blur(24px) saturate(180%) !important; -webkit-backdrop-filter: blur(24px) saturate(180%) !important;
                animation: fb-toolkit-modal-fade-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-content {
                position: relative !important; max-width: 420px !important; width: 90% !important;
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%) !important;
                backdrop-filter: blur(40px) saturate(150%) !important; -webkit-backdrop-filter: blur(40px) saturate(150%) !important;
                border: 1px solid rgba(255, 255, 255, 0.18) !important; border-radius: 28px !important; padding: 48px 36px !important;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 0 80px rgba(139, 92, 246, 0.15) !important;
                animation: fb-toolkit-modal-fade-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s backwards, fb-toolkit-glow-pulse 4s ease-in-out infinite !important;
                overflow: hidden !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-content::before {
                content: '' !important; position: absolute !important; top: 0 !important; left: 0 !important; right: 0 !important; height: 3px !important;
                background: linear-gradient(90deg, transparent, rgba(139, 92, 246, 0.8), rgba(59, 130, 246, 0.8), rgba(236, 72, 153, 0.6), transparent) !important;
                background-size: 200% 100% !important; animation: fb-toolkit-glass-shimmer 3s linear infinite !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-content::after {
                content: '' !important; position: absolute !important; top: -50% !important; left: -50% !important; width: 200% !important; height: 200% !important;
                background: radial-gradient(circle at 30% 20%, rgba(139, 92, 246, 0.08) 0%, transparent 50%),
                            radial-gradient(circle at 70% 80%, rgba(59, 130, 246, 0.06) 0%, transparent 50%) !important;
                pointer-events: none !important; z-index: -1 !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-icon {
                width: 88px !important; height: 88px !important; margin: 0 auto 28px !important;
                background: linear-gradient(135deg, rgba(139, 92, 246, 0.9) 0%, rgba(59, 130, 246, 0.9) 100%) !important;
                border-radius: 50% !important; display: flex !important; align-items: center !important; justify-content: center !important;
                font-size: 44px !important; box-shadow: 0 12px 40px rgba(139, 92, 246, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.3) !important;
                animation: fb-toolkit-float 3s ease-in-out infinite !important;
                border: 2px solid rgba(255, 255, 255, 0.2) !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-title {
                font-size: 26px !important; font-weight: 700 !important;
                background: linear-gradient(135deg, #ffffff 0%, rgba(255, 255, 255, 0.85) 100%) !important;
                -webkit-background-clip: text !important; background-clip: text !important; -webkit-text-fill-color: transparent !important;
                text-align: center !important; margin: 0 0 14px 0 !important; line-height: 1.3 !important; letter-spacing: -0.3px !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-message {
                font-size: 15px !important; font-weight: 400 !important; color: rgba(255, 255, 255, 0.75) !important;
                text-align: center !important; margin: 0 0 14px 0 !important; line-height: 1.6 !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-count {
                font-size: 13px !important; font-weight: 600 !important;
                background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(59, 130, 246, 0.1) 100%) !important;
                color: rgba(167, 139, 250, 1) !important; text-align: center !important; margin: 0 0 28px 0 !important;
                padding: 10px 18px !important; border-radius: 14px !important; display: inline-block !important; width: 100% !important;
                border: 1px solid rgba(139, 92, 246, 0.2) !important; backdrop-filter: blur(10px) !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-paused-indicator {
                display: flex !important; align-items: center !important; justify-content: center !important; gap: 8px !important;
                font-size: 12px !important; color: rgba(251, 191, 36, 0.9) !important; margin: -8px 0 20px 0 !important;
                padding: 8px 14px !important; background: rgba(251, 191, 36, 0.1) !important; border-radius: 10px !important;
                border: 1px solid rgba(251, 191, 36, 0.2) !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-paused-indicator::before {
                content: '⏸' !important; font-size: 14px !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-buttons {
                display: flex !important; gap: 14px !important; margin-top: 28px !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-btn {
                flex: 1 !important; padding: 16px 24px !important; border: none !important; border-radius: 14px !important;
                font-size: 14px !important; font-weight: 600 !important; cursor: pointer !important;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important; text-transform: none !important; letter-spacing: 0.2px !important;
                position: relative !important; overflow: hidden !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-btn::before {
                content: '' !important; position: absolute !important; top: 0 !important; left: -100% !important; width: 100% !important; height: 100% !important;
                background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent) !important;
                transition: left 0.5s ease !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-btn:hover::before { left: 100% !important; }
            #fb-toolkit-reels-timeout-modal .modal-btn-primary {
                background: linear-gradient(135deg, rgba(139, 92, 246, 0.9) 0%, rgba(99, 102, 241, 0.9) 100%) !important;
                color: #ffffff !important; box-shadow: 0 6px 24px rgba(139, 92, 246, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2) !important;
                border: 1px solid rgba(255, 255, 255, 0.1) !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-btn-primary:hover {
                transform: translateY(-3px) scale(1.02) !important; box-shadow: 0 10px 32px rgba(139, 92, 246, 0.5) !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-btn-primary:active { transform: translateY(-1px) scale(1) !important; }
            #fb-toolkit-reels-timeout-modal .modal-btn-secondary {
                background: rgba(255, 255, 255, 0.08) !important; color: rgba(255, 255, 255, 0.9) !important;
                border: 1px solid rgba(255, 255, 255, 0.15) !important; backdrop-filter: blur(10px) !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-btn-secondary:hover {
                background: rgba(255, 255, 255, 0.14) !important; border-color: rgba(255, 255, 255, 0.25) !important;
                transform: translateY(-2px) !important; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2) !important;
            }
            #fb-toolkit-reels-timeout-modal .modal-btn-secondary:active { transform: translateY(0) !important; background: rgba(255, 255, 255, 0.06) !important; }
            #fb-toolkit-reels-timeout-modal .modal-instruction {
                font-size: 11px !important; color: rgba(255, 255, 255, 0.45) !important; text-align: center !important;
                margin: 18px 0 0 0 !important; line-height: 1.5 !important; font-style: italic !important;
            }
        `,
        hideSuggestions: `
            .${SUGGESTION_HIDDEN_CLASS} {
                display: none !important;
            }
            
            /* Hide "People you may know" section - animated */
            div[role="region"][aria-label="People you may know"],
            div[aria-label="People you may know"] {
                max-height: 0 !important;
                opacity: 0 !important;
                overflow: hidden !important;
                margin: 0 !important;
                padding: 0 !important;
                pointer-events: none !important;
                transition: max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            opacity 0.25s ease,
                            margin 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            padding 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
            
            /* Hide the entire card wrapper that contains PYMK (has the header and carousel) */
            div.x6ikm8r.x10wlt62:has(div[role="region"][aria-label="People you may know"]),
            div.x6ikm8r:has(h3):has([href*="/friends/suggestions/"]) {
                max-height: 0 !important;
                opacity: 0 !important;
                overflow: hidden !important;
                margin: 0 !important;
                padding: 0 !important;
                pointer-events: none !important;
                transition: max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            opacity 0.25s ease,
                            margin 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            padding 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
            
            /* Hide entire "People you may know" card in feed - animated */
            div[role="feed"] > div:has(a[href*="/friends/suggestions/"]):not([role="article"]) {
                max-height: 0 !important;
                opacity: 0 !important;
                overflow: hidden !important;
                margin: 0 !important;
                padding: 0 !important;
                pointer-events: none !important;
                transition: max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            opacity 0.25s ease,
                            margin 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            padding 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
            
            /* Generic hide for any feed unit containing friend suggestion links */
            div[role="main"] > div > div > div:has([href*="/friends/suggestions/"]):not(:has([role="article"])) {
                max-height: 0 !important;
                opacity: 0 !important;
                overflow: hidden !important;
                margin: 0 !important;
                padding: 0 !important;
                pointer-events: none !important;
                transition: max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            opacity 0.25s ease,
                            margin 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            padding 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
        `,
        hideAds: `
            /* Hide Sponsored/Ad posts */
            .${AD_HIDDEN_CLASS},
            div[role="article"]:has(a[href*="/ads/about/"]),
            div[role="article"]:has(a[href*="facebook.com/ads/about/"]),
            div[role="article"]:has([data-ad-preview]),
            div[role="article"]:has([data-ad-comet-preview]),
            div[role="article"]:has([data-ad-rendering-role="story_message"]) {
                display: none !important;
            }

            /* Hide Marketplace Sponsored Ads */
            .fb-toolkit-hidden-marketplace-ad {
                display: none !important;
            }
        `,
        customFont: (family, size) => {
            // Load Google Fonts via <link> tag (not @import, which fails mid-stylesheet)
            const googleFonts = ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Poppins', 'Nunito', 'Outfit', 'DM Sans', 'Plus Jakarta Sans', 'Source Sans 3', 'Dancing Script', 'Pacifico', 'Caveat', 'Satisfy', 'Great Vibes', 'Sacramento', 'Playfair Display', 'Cormorant Garamond', 'Libre Baskerville', 'Crimson Text'];
            const fontName = family.replace(/['"]/g, '').split(',')[0].trim();
            
            // Remove any previous font link
            const oldLink = document.getElementById('fb-toolkit-google-font');
            if (oldLink) oldLink.remove();

            if (googleFonts.includes(fontName)) {
                const link = document.createElement('link');
                link.id = 'fb-toolkit-google-font';
                link.rel = 'stylesheet';
                link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, '+')}:wght@400;500;600;700&display=swap`;
                (document.head || document.documentElement).appendChild(link);
            }

            return `
            ${family !== 'default' ? `
            /* Override font-family on structural and text elements */
            body, div, span, a, p, h1, h2, h3, h4, h5, h6, input, button, select, textarea, [dir="auto"] {
                font-family: ${family} !important;
            }
            /* Preserve ASTRA extension UI font */
            [id^="fb-toolkit"] *, [id^="fb-toolkit"] {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            }
            ` : ''}
            
            ${size !== 100 ? `
            /* Scale ALL text elements across Facebook */
            body {
                font-size: ${size}% !important;
            }
            /* Override Facebook's pixel-based font sizes on text elements */
            [dir="auto"], 
            span[class], 
            a[role="link"], 
            div[role="article"] span,
            div[role="article"] a,
            div[role="article"] p,
            div[role="main"] span,
            div[role="main"] a,
            div[role="button"] span,
            div[role="dialog"] span,
            div[role="dialog"] a,
            h1, h2, h3, h4, h5, h6,
            input, textarea, button,
            [data-ad-preview] span {
                font-size: inherit !important;
            }
            ` : ''}
            `;
        },
        compactMode: `
            /* Compact Mode - Reduce padding and margins */
            :is(${FEED_POST_CARD_SELECTOR}) {
                padding-top: 8px !important;
                padding-bottom: 8px !important;
                margin-bottom: 12px !important;
            }
            :is(${FEED_POST_CARD_SELECTOR}) [dir="auto"] {
                padding-top: 2px !important;
                padding-bottom: 2px !important;
            }
            /* Tighten the header row of posts */
            :is(${FEED_POST_CARD_SELECTOR}) .x1y1aw1k {
                margin-top: 4px !important;
                margin-bottom: 4px !important;
            }
            /* Reduce padding on interaction buttons */
            :is(${FEED_POST_CARD_SELECTOR}) div[role="button"] {
                padding-top: 4px !important;
                padding-bottom: 4px !important;
            }
        `,
        // Card Borders - Beautiful borders on post cards
        cardBorders: {
            glow: `
                /* Card Borders - Glow */
                :is(${FEED_POST_CARD_SELECTOR}) {
                    border: 1px solid rgba(59, 130, 246, 0.4) !important;
                    box-shadow: 0 0 12px rgba(59, 130, 246, 0.3), 0 0 24px rgba(59, 130, 246, 0.15), 0 4px 16px rgba(0, 0, 0, 0.2) !important;
                    transition: box-shadow 0.3s ease, border-color 0.3s ease !important;
                }
                :is(${FEED_POST_CARD_SELECTOR}):hover {
                    border-color: rgba(59, 130, 246, 0.6) !important;
                    box-shadow: 0 0 16px rgba(59, 130, 246, 0.4), 0 0 32px rgba(59, 130, 246, 0.2), 0 8px 24px rgba(0, 0, 0, 0.25) !important;
                }
                /* Reset nested articles (comments) */
                :is(${FEED_POST_CARD_SELECTOR}) div[role="article"],
                :is(${FEED_POST_CARD_SELECTOR}) div[role="article"]:hover {
                    border: none !important;
                    box-shadow: none !important;
                }
            `,
            glass: `
                /* Card Borders - Glass */
                :is(${FEED_POST_CARD_SELECTOR}) {
                    border: 1px solid rgba(255, 255, 255, 0.12) !important;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08) !important;
                    backdrop-filter: blur(8px) !important;
                    -webkit-backdrop-filter: blur(8px) !important;
                    background: rgba(36, 37, 38, 0.85) !important;
                    transition: all 0.3s ease !important;
                }
                :is(${FEED_POST_CARD_SELECTOR}):hover {
                    border-color: rgba(255, 255, 255, 0.18) !important;
                    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.12) !important;
                    transform: translateY(-2px) !important;
                }
                /* Reset nested articles (comments) */
                :is(${FEED_POST_CARD_SELECTOR}) div[role="article"],
                :is(${FEED_POST_CARD_SELECTOR}) div[role="article"]:hover {
                    border: none !important;
                    box-shadow: none !important;
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                    background: inherit !important;
                    transform: none !important;
                }
            `,
            gradient: `
                /* Card Borders - Gradient */
                :is(${FEED_POST_CARD_SELECTOR}) {
                    position: relative !important;
                    border: 2px solid transparent !important;
                    background-clip: padding-box !important;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2) !important;
                    transition: all 0.3s ease !important;
                    overflow: visible !important;
                }
                :is(${FEED_POST_CARD_SELECTOR})::before {
                    content: '' !important;
                    position: absolute !important;
                    top: -2px !important;
                    left: -2px !important;
                    right: -2px !important;
                    bottom: -2px !important;
                    background: linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899, #f97316, #3b82f6) !important;
                    background-size: 300% 300% !important;
                    border-radius: inherit !important;
                    z-index: -1 !important;
                    animation: gradientBorderRotate 4s linear infinite !important;
                }
                :is(${FEED_POST_CARD_SELECTOR}):hover {
                    transform: translateY(-2px) !important;
                    box-shadow: 0 8px 30px rgba(139, 92, 246, 0.25) !important;
                }
                /* Reset nested articles (comments) */
                :is(${FEED_POST_CARD_SELECTOR}) div[role="article"],
                :is(${FEED_POST_CARD_SELECTOR}) div[role="article"]:hover {
                    border: none !important;
                    box-shadow: none !important;
                    position: static !important;
                    transform: none !important;
                    overflow: hidden !important;
                }
                :is(${FEED_POST_CARD_SELECTOR}) div[role="article"]::before {
                    display: none !important;
                    content: none !important;
                }
                @keyframes gradientBorderRotate {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
            `,
            minimal: `
                /* Card Borders - Minimal */
                :is(${FEED_POST_CARD_SELECTOR}) {
                    border: 1px solid rgba(255, 255, 255, 0.08) !important;
                    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15), 0 1px 4px rgba(0, 0, 0, 0.1) !important;
                    transition: all 0.2s ease !important;
                }
                :is(${FEED_POST_CARD_SELECTOR}):hover {
                    border-color: rgba(255, 255, 255, 0.12) !important;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2), 0 2px 6px rgba(0, 0, 0, 0.12) !important;
                }
                /* Reset nested articles (comments) */
                :is(${FEED_POST_CARD_SELECTOR}) div[role="article"],
                :is(${FEED_POST_CARD_SELECTOR}) div[role="article"]:hover {
                    border: none !important;
                    box-shadow: none !important;
                }
            `
        },
        // Feed Background Gradients - Makes post cards pop
        feedBackground: {
            cosmic: `
                /* Feed Background - Cosmic Purple */
                div[role="main"] {
                    background: linear-gradient(135deg, #1a0a2e 0%, #16213e 35%, #0f3460 70%, #1a1a2e 100%) !important;
                }
                div[role="main"] div[role="feed"] {
                    background: transparent !important;
                }
                div[role="article"] {
                    box-shadow: 0 4px 20px rgba(139, 92, 246, 0.15), 0 2px 8px rgba(0, 0, 0, 0.3) !important;
                    border: 1px solid rgba(139, 92, 246, 0.1) !important;
                }
            `,
            ocean: `
                /* Feed Background - Deep Ocean */
                div[role="main"] {
                    background: linear-gradient(135deg, #0c1a2a 0%, #0d2538 35%, #0e3d5e 70%, #0c2a4a 100%) !important;
                }
                div[role="main"] div[role="feed"] {
                    background: transparent !important;
                }
                div[role="article"] {
                    box-shadow: 0 4px 20px rgba(59, 130, 246, 0.15), 0 2px 8px rgba(0, 0, 0, 0.3) !important;
                    border: 1px solid rgba(59, 130, 246, 0.1) !important;
                }
            `,
            sunset: `
                /* Feed Background - Sunset Glow */
                div[role="main"] {
                    background: linear-gradient(135deg, #1a0a1a 0%, #2d1a3e 35%, #3d1a4e 70%, #1a0a2a 100%) !important;
                }
                div[role="main"] div[role="feed"] {
                    background: transparent !important;
                }
                div[role="article"] {
                    box-shadow: 0 4px 20px rgba(236, 72, 153, 0.15), 0 2px 8px rgba(0, 0, 0, 0.3) !important;
                    border: 1px solid rgba(236, 72, 153, 0.1) !important;
                }
            `,
            aurora: `
                /* Feed Background - Aurora Borealis */
                div[role="main"] {
                    background: linear-gradient(135deg, #0a1a1a 0%, #0d2828 35%, #0a3a3a 70%, #0a2020 100%) !important;
                }
                div[role="main"] div[role="feed"] {
                    background: transparent !important;
                }
                div[role="article"] {
                    box-shadow: 0 4px 20px rgba(34, 197, 94, 0.15), 0 2px 8px rgba(0, 0, 0, 0.3) !important;
                    border: 1px solid rgba(34, 197, 94, 0.1) !important;
                }
            `,
            midnight: `
                /* Feed Background - Midnight Blue */
                div[role="main"] {
                    background: linear-gradient(135deg, #0a0a1a 0%, #0d1020 35%, #101525 70%, #0a0a15 100%) !important;
                }
                div[role="main"] div[role="feed"] {
                    background: transparent !important;
                }
                div[role="article"] {
                    box-shadow: 0 4px 20px rgba(99, 102, 241, 0.12), 0 2px 8px rgba(0, 0, 0, 0.35) !important;
                    border: 1px solid rgba(99, 102, 241, 0.08) !important;
                }
            `,
            forest: `
                /* Feed Background - Enchanted Forest */
                div[role="main"] {
                    background: linear-gradient(135deg, #0a120a 0%, #0d1a10 35%, #102015 70%, #0a150a 100%) !important;
                }
                div[role="main"] div[role="feed"] {
                    background: transparent !important;
                }
                div[role="article"] {
                    box-shadow: 0 4px 20px rgba(16, 185, 129, 0.12), 0 2px 8px rgba(0, 0, 0, 0.35) !important;
                    border: 1px solid rgba(16, 185, 129, 0.08) !important;
                }
            `,
            rose: `
                /* Feed Background - Rose Gold */
                div[role="main"] {
                    background: linear-gradient(135deg, #1a0a0f 0%, #2a1520 35%, #351a28 70%, #1a0a12 100%) !important;
                }
                div[role="article"] {
                    box-shadow: 0 4px 20px rgba(244, 114, 182, 0.12), 0 2px 8px rgba(0, 0, 0, 0.35) !important;
                    border: 1px solid rgba(244, 114, 182, 0.08) !important;
                }
            `,
            dark: `
                /* Feed Background - Deep Dark */
                div[role="main"] {
                    background: linear-gradient(135deg, #0a0a0a 0%, #101012 35%, #151518 70%, #0a0a0c 100%) !important;
                }
                div[role="article"] {
                    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.4) !important;
                    border: 1px solid rgba(255, 255, 255, 0.05) !important;
                }
            `,
            // ─── Light Themes ────────────────────────────────────────────────
            cloud: `
                /* Feed Background - Cloud White */
                div[role="main"] {
                    background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 35%, #dee2e6 70%, #f1f3f5 100%) !important;
                }
                div[role="article"] {
                    background: rgba(255, 255, 255, 0.9) !important;
                    color: #1c1e21 !important;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08) !important;
                    border: 1px solid rgba(0, 0, 0, 0.06) !important;
                }
                div[role="article"] * { color: inherit !important; }
            `,
            sky: `
                /* Feed Background - Sky Blue */
                div[role="main"] {
                    background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 35%, #bae6fd 70%, #e8f4fd 100%) !important;
                }
                div[role="article"] {
                    background: rgba(255, 255, 255, 0.9) !important;
                    color: #0369a1 !important;
                }
                div[role="article"] * { color: inherit !important; }
            `,
            mint: `
                /* Feed Background - Mint Fresh */
                div[role="main"] {
                    background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 35%, #bbf7d0 70%, #e8fbee 100%) !important;
                }
                div[role="article"] {
                    background: rgba(255, 255, 255, 0.9) !important;
                    color: #15803d !important;
                }
                div[role="article"] * { color: inherit !important; }
            `,
            lavender: `
                /* Feed Background - Lavender Dream */
                div[role="main"] {
                    background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 35%, #e9d5ff 70%, #f5edff 100%) !important;
                }
                div[role="article"] {
                    background: rgba(255, 255, 255, 0.9) !important;
                    color: #7e22ce !important;
                }
                div[role="article"] * { color: inherit !important; }
            `,
            lemon: `
                /* Feed Background - Lemon Sorbet */
                div[role="main"] {
                    background: linear-gradient(135deg, #fefce8 0%, #fef9c3 35%, #fef08a 70%, #fefadc 100%) !important;
                }
                div[role="article"] {
                    background: rgba(255, 255, 255, 0.9) !important;
                    color: #a16207 !important;
                }
                div[role="article"] * { color: inherit !important; }
            `,
            sakura: `
                /* Feed Background - Sakura Bloom */
                div[role="main"] {
                    background: linear-gradient(135deg, #fff1f2 0%, #ffe4e6 35%, #fecdd3 70%, #fff5f5 100%) !important;
                }
                div[role="article"] {
                    background: rgba(255, 255, 255, 0.9) !important;
                    color: #be123c !important;
                }
                div[role="article"] * { color: inherit !important; }
            `,
            ivory: `
                /* Feed Background - Soft Ivory */
                div[role="main"] {
                    background: linear-gradient(135deg, #fafaf9 0%, #f5f5f4 35%, #e7e5e4 70%, #fcfcfb 100%) !important;
                }
                div[role="article"] {
                    background: rgba(255, 255, 255, 0.9) !important;
                    color: #44403c !important;
                }
                div[role="article"] * { color: inherit !important; }
            `,
            // ─── Modern Pattern Backgrounds ──────────────────────────────────────
            mesh: `
                /* Feed Background - Mesh Gradient */
                div[role="main"] {
                    background: 
                        radial-gradient(at 40% 20%, #7c3aed 0px, transparent 50%),
                        radial-gradient(at 80% 0%, #06b6d4 0px, transparent 50%),
                        radial-gradient(at 0% 50%, #ec4899 0px, transparent 50%),
                        radial-gradient(at 80% 50%, #3b82f6 0px, transparent 50%),
                        radial-gradient(at 0% 100%, #10b981 0px, transparent 50%),
                        #0f172a !important;
                }
                div[role="main"] div[role="feed"] {
                    background: transparent !important;
                }
                div[role="article"] {
                    box-shadow: 0 8px 32px rgba(124, 58, 237, 0.15), 0 4px 16px rgba(0, 0, 0, 0.2) !important;
                    border: 1px solid rgba(124, 58, 237, 0.15) !important;
                    backdrop-filter: blur(8px) !important;
                }
            `,
            noise: `
                /* Feed Background - Grain Texture */
                div[role="main"] {
                    background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%) !important;
                }
                div[role="main"] div[role="feed"] {
                    background: transparent !important;
                }
                div[role="article"] {
                    box-shadow: 0 4px 24px rgba(99, 102, 241, 0.12), 0 2px 8px rgba(0, 0, 0, 0.3) !important;
                    border: 1px solid rgba(99, 102, 241, 0.1) !important;
                }
            `,
            aurora: `
                /* Feed Background - Aurora Waves */
                div[role="main"] {
                    background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%) !important;
                    position: relative !important;
                }
                div[role="main"]::before {
                    content: '' !important;
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    right: 0 !important;
                    bottom: 0 !important;
                    background: 
                        radial-gradient(ellipse 80% 50% at 30% 100%, rgba(34, 211, 238, 0.25) 0%, transparent 50%),
                        radial-gradient(ellipse 80% 50% at 70% 100%, rgba(168, 85, 247, 0.25) 0%, transparent 50%) !important;
                    pointer-events: none !important;
                    z-index: 0 !important;
                    animation: auroraShift 8s ease-in-out infinite !important;
                }
                div[role="main"] div[role="feed"] {
                    background: transparent !important;
                    position: relative !important;
                    z-index: 1 !important;
                }
                div[role="article"] {
                    box-shadow: 0 4px 24px rgba(34, 211, 238, 0.1), 0 2px 8px rgba(0, 0, 0, 0.3) !important;
                    border: 1px solid rgba(34, 211, 238, 0.1) !important;
                    position: relative !important;
                    z-index: 2 !important;
                }
                @keyframes auroraShift {
                    0%, 100% { opacity: 0.8; transform: translateX(0); }
                    50% { opacity: 1; transform: translateX(5%); }
                }
            `,
            neongrid: `
                /* Feed Background - Neon Grid */
                div[role="main"] {
                    background-color: #0a0a0f !important;
                    background-image:
                        linear-gradient(rgba(139, 92, 246, 0.3) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(139, 92, 246, 0.3) 1px, transparent 1px),
                        linear-gradient(rgba(6, 182, 212, 0.15) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(6, 182, 212, 0.15) 1px, transparent 1px) !important;
                    background-size: 60px 60px, 60px 60px, 15px 15px, 15px 15px !important;
                }
                div[role="main"] div[role="feed"] {
                    background: transparent !important;
                }
                div[role="article"] {
                    box-shadow: 0 0 20px rgba(139, 92, 246, 0.2), 0 4px 16px rgba(0, 0, 0, 0.3) !important;
                    border: 1px solid rgba(139, 92, 246, 0.2) !important;
                }
            `,
            // ─── Animated Particle Backgrounds ───────────────────────────────────
            particles: `
                /* Feed Background - Floating Particles */
                div[role="main"] {
                    background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%) !important;
                    position: relative !important;
                    overflow: hidden !important;
                }
                div[role="main"]::before {
                    content: '' !important;
                    position: fixed !important;
                    width: 100% !important;
                    height: 100% !important;
                    top: 0 !important;
                    left: 0 !important;
                    background-image: 
                        radial-gradient(2px 2px at 20% 30%, rgba(59, 130, 246, 0.8), transparent),
                        radial-gradient(2px 2px at 40% 70%, rgba(139, 92, 246, 0.8), transparent),
                        radial-gradient(2px 2px at 60% 20%, rgba(6, 182, 212, 0.8), transparent),
                        radial-gradient(2px 2px at 80% 60%, rgba(59, 130, 246, 0.8), transparent),
                        radial-gradient(3px 3px at 10% 80%, rgba(139, 92, 246, 0.6), transparent),
                        radial-gradient(3px 3px at 90% 40%, rgba(6, 182, 212, 0.6), transparent),
                        radial-gradient(2px 2px at 30% 50%, rgba(59, 130, 246, 0.7), transparent),
                        radial-gradient(2px 2px at 70% 90%, rgba(139, 92, 246, 0.7), transparent) !important;
                    background-size: 100% 100% !important;
                    animation: floatingParticles 20s linear infinite !important;
                    pointer-events: none !important;
                    z-index: 0 !important;
                }
                div[role="main"] div[role="feed"] {
                    background: transparent !important;
                    position: relative !important;
                    z-index: 1 !important;
                }
                div[role="article"] {
                    box-shadow: 0 8px 32px rgba(59, 130, 246, 0.15), 0 4px 16px rgba(0, 0, 0, 0.25) !important;
                    border: 1px solid rgba(59, 130, 246, 0.15) !important;
                    position: relative !important;
                    z-index: 2 !important;
                }
                @keyframes floatingParticles {
                    0% { transform: translateY(0) rotate(0deg); }
                    100% { transform: translateY(-100%) rotate(360deg); }
                }
            `,
            bubbles: `
                /* Feed Background - Rising Bubbles */
                div[role="main"] {
                    background: linear-gradient(180deg, #0c4a6e 0%, #082f49 100%) !important;
                    position: relative !important;
                    overflow: hidden !important;
                }
                div[role="main"]::before {
                    content: '' !important;
                    position: fixed !important;
                    width: 100% !important;
                    height: 200% !important;
                    bottom: 0 !important;
                    left: 0 !important;
                    background-image: 
                        radial-gradient(circle 8px at 10% 100%, rgba(125, 211, 252, 0.4), transparent 50%),
                        radial-gradient(circle 6px at 25% 80%, rgba(125, 211, 252, 0.5), transparent 50%),
                        radial-gradient(circle 10px at 40% 95%, rgba(186, 230, 253, 0.4), transparent 50%),
                        radial-gradient(circle 5px at 55% 70%, rgba(125, 211, 252, 0.6), transparent 50%),
                        radial-gradient(circle 12px at 70% 85%, rgba(186, 230, 253, 0.3), transparent 50%),
                        radial-gradient(circle 7px at 85% 100%, rgba(125, 211, 252, 0.5), transparent 50%),
                        radial-gradient(circle 4px at 95% 75%, rgba(186, 230, 253, 0.4), transparent 50%) !important;
                    animation: risingBubbles 15s linear infinite !important;
                    pointer-events: none !important;
                    z-index: 0 !important;
                }
                div[role="main"] div[role="feed"] {
                    background: transparent !important;
                    position: relative !important;
                    z-index: 1 !important;
                }
                div[role="article"] {
                    box-shadow: 0 8px 32px rgba(125, 211, 252, 0.12), 0 4px 16px rgba(0, 0, 0, 0.25) !important;
                    border: 1px solid rgba(125, 211, 252, 0.15) !important;
                    position: relative !important;
                    z-index: 2 !important;
                }
                @keyframes risingBubbles {
                    0% { transform: translateY(0); }
                    100% { transform: translateY(-50%); }
                }
            `,
            stars: `
                /* Feed Background - Starfield */
                div[role="main"] {
                    background: radial-gradient(ellipse at bottom, #1b2838 0%, #090a0f 100%) !important;
                    position: relative !important;
                    overflow: hidden !important;
                }
                div[role="main"]::before,
                div[role="main"]::after {
                    content: '' !important;
                    position: fixed !important;
                    width: 100% !important;
                    height: 100% !important;
                    top: 0 !important;
                    left: 0 !important;
                    pointer-events: none !important;
                }
                div[role="main"]::before {
                    background-image: 
                        radial-gradient(1px 1px at 10% 20%, white, transparent),
                        radial-gradient(1px 1px at 30% 40%, white, transparent),
                        radial-gradient(2px 2px at 50% 10%, white, transparent),
                        radial-gradient(1px 1px at 70% 60%, white, transparent),
                        radial-gradient(1px 1px at 90% 30%, white, transparent),
                        radial-gradient(2px 2px at 15% 70%, white, transparent),
                        radial-gradient(1px 1px at 45% 80%, white, transparent),
                        radial-gradient(1px 1px at 75% 90%, white, transparent) !important;
                    animation: twinkleStars 4s ease-in-out infinite !important;
                    z-index: 0 !important;
                }
                div[role="main"]::after {
                    background-image: 
                        radial-gradient(1px 1px at 5% 50%, rgba(255,255,255,0.8), transparent),
                        radial-gradient(2px 2px at 25% 15%, rgba(255,255,255,0.9), transparent),
                        radial-gradient(1px 1px at 55% 45%, rgba(255,255,255,0.7), transparent),
                        radial-gradient(1px 1px at 85% 75%, rgba(255,255,255,0.8), transparent),
                        radial-gradient(2px 2px at 35% 95%, rgba(255,255,255,0.6), transparent),
                        radial-gradient(1px 1px at 65% 25%, rgba(255,255,255,0.9), transparent) !important;
                    animation: twinkleStars 4s ease-in-out infinite 2s !important;
                    z-index: 0 !important;
                }
                div[role="main"] div[role="feed"] {
                    background: transparent !important;
                    position: relative !important;
                    z-index: 1 !important;
                }
                div[role="article"] {
                    box-shadow: 0 8px 32px rgba(255, 255, 255, 0.05), 0 4px 16px rgba(0, 0, 0, 0.4) !important;
                    border: 1px solid rgba(255, 255, 255, 0.08) !important;
                    position: relative !important;
                    z-index: 2 !important;
                }
                @keyframes twinkleStars {
                    0%, 100% { opacity: 0.5; }
                    50% { opacity: 1; }
                }
            `,
            fireflies: `
                /* Feed Background - Fireflies */
                div[role="main"] {
                    background: linear-gradient(180deg, #1a2e1a 0%, #0a150a 100%) !important;
                    position: relative !important;
                    overflow: hidden !important;
                }
                div[role="main"]::before {
                    content: '' !important;
                    position: fixed !important;
                    width: 100% !important;
                    height: 100% !important;
                    top: 0 !important;
                    left: 0 !important;
                    background-image: 
                        radial-gradient(3px 3px at 15% 25%, rgba(253, 224, 71, 0.9), transparent),
                        radial-gradient(4px 4px at 35% 65%, rgba(253, 224, 71, 0.8), transparent),
                        radial-gradient(3px 3px at 55% 35%, rgba(250, 204, 21, 0.9), transparent),
                        radial-gradient(5px 5px at 75% 75%, rgba(253, 224, 71, 0.7), transparent),
                        radial-gradient(3px 3px at 85% 15%, rgba(250, 204, 21, 0.8), transparent),
                        radial-gradient(4px 4px at 25% 85%, rgba(253, 224, 71, 0.6), transparent),
                        radial-gradient(3px 3px at 65% 55%, rgba(250, 204, 21, 0.9), transparent),
                        radial-gradient(4px 4px at 45% 95%, rgba(253, 224, 71, 0.7), transparent) !important;
                    filter: blur(1px) !important;
                    animation: fireflyGlow 6s ease-in-out infinite !important;
                    pointer-events: none !important;
                    z-index: 0 !important;
                }
                div[role="main"] div[role="feed"] {
                    background: transparent !important;
                    position: relative !important;
                    z-index: 1 !important;
                }
                div[role="article"] {
                    box-shadow: 0 8px 32px rgba(253, 224, 71, 0.08), 0 4px 16px rgba(0, 0, 0, 0.3) !important;
                    border: 1px solid rgba(253, 224, 71, 0.1) !important;
                    position: relative !important;
                    z-index: 2 !important;
                }
                @keyframes fireflyGlow {
                    0%, 100% { opacity: 0.4; transform: scale(1); }
                    25% { opacity: 0.9; transform: scale(1.05); }
                    50% { opacity: 0.5; transform: scale(0.98); }
                    75% { opacity: 1; transform: scale(1.02); }
                }
            `
        },
        autoScrollControls: `
            #${AUTOSCROLL_PANEL_ID} {
                position: fixed !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                gap: 2px !important;
                padding: 6px 5px !important;
                border-radius: 16px !important;
                border: 1px solid rgba(255, 255, 255, 0.06) !important;
                background: rgba(15, 23, 42, 0.85) !important;
                backdrop-filter: blur(16px) saturate(140%) !important;
                -webkit-backdrop-filter: blur(16px) saturate(140%) !important;
                z-index: 2147483640 !important;
                pointer-events: auto !important;
                transition: all 250ms ease !important;
                opacity: 0.7 !important;
                top: 50% !important;
                left: 12px !important;
                transform: translateY(-50%) !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                cursor: grab !important;
            }

            #${AUTOSCROLL_PANEL_ID}:active {
                cursor: grabbing !important;
            }

            #${AUTOSCROLL_PANEL_ID}:hover {
                opacity: 0.9 !important;
                background: rgba(0, 0, 0, 0.48) !important;
                border-color: rgba(255, 255, 255, 0.12) !important;
            }

            #${AUTOSCROLL_PANEL_ID}.autoscroll-playing {
                opacity: 0.9 !important;
                background: rgba(15, 23, 42, 0.95) !important;
                border-color: rgba(6, 102, 255, 0.3) !important;
            }

            #${AUTOSCROLL_PANEL_ID}.autoscroll-playing:hover {
                opacity: 1 !important;
            }

            #${AUTOSCROLL_PANEL_ID} button {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 28px !important;
                height: 28px !important;
                min-width: unset !important;
                padding: 0 !important;
                border: none !important;
                border-radius: 50% !important;
                background: transparent !important;
                color: rgba(255, 255, 255, 0.75) !important;
                cursor: pointer !important;
                transition: all 120ms ease !important;
            }

            #${AUTOSCROLL_PANEL_ID} button:hover {
                background: rgba(255, 255, 255, 0.12) !important;
                color: #ffffff !important;
            }

            #${AUTOSCROLL_PANEL_ID} button:active {
                transform: scale(0.9) !important;
            }

            #${AUTOSCROLL_PANEL_ID} button svg {
                width: 14px !important;
                height: 14px !important;
                fill: currentColor !important;
            }

            #${AUTOSCROLL_PANEL_ID} button.active {
                background: #0666FF !important;
                color: #ffffff !important;
                box-shadow: 0 0 12px rgba(6, 102, 255, 0.45) !important;
                opacity: 1 !important;
            }

            #${AUTOSCROLL_PANEL_ID} button.active:hover {
                background: #0056e0 !important;
                box-shadow: 0 0 16px rgba(6, 102, 255, 0.6) !important;
            }

            /* Close button — smaller, top-right of panel */
            #${AUTOSCROLL_PANEL_ID} .autoscroll-close-btn {
                width: 18px !important;
                height: 18px !important;
                margin-top: 4px !important;
                opacity: 0 !important;
                transition: all 200ms ease !important;
            }
            #${AUTOSCROLL_PANEL_ID}:hover .autoscroll-close-btn {
                opacity: 1 !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-close-btn:hover {
                background: rgba(239, 68, 68, 0.2) !important;
                color: #ef4444 !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-close-btn svg {
                width: 10px !important;
                height: 10px !important;
            }

            /* Re-open FAB — appears when controller is hidden */
            #fb-toolkit-reopen-fab {
                position: fixed !important;
                bottom: 24px !important;
                left: 24px !important;
                width: 40px !important;
                height: 40px !important;
                border-radius: 50% !important;
                background: rgba(24, 24, 27, 0.88) !important;
                backdrop-filter: blur(16px) saturate(180%) !important;
                -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
                border: 1px solid rgba(255, 255, 255, 0.1) !important;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255,255,255,0.04) inset !important;
                cursor: pointer !important;
                z-index: 2147483640 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                padding: 0 !important;
                transition: all 300ms cubic-bezier(0.16, 1, 0.3, 1) !important;
                opacity: 0 !important;
                transform: scale(0.5) !important;
            }
            #fb-toolkit-reopen-fab.visible {
                opacity: 0.6 !important;
                transform: scale(1) !important;
            }
            #fb-toolkit-reopen-fab:hover {
                opacity: 1 !important;
                transform: scale(1.1) !important;
                box-shadow: 0 4px 20px rgba(6, 102, 255, 0.3), 0 0 0 1px rgba(6, 102, 255, 0.2) inset !important;
                border-color: rgba(6, 102, 255, 0.4) !important;
            }
            #fb-toolkit-reopen-fab img {
                width: 22px !important;
                height: 22px !important;
                border-radius: 4px !important;
                pointer-events: none !important;
            }
            #fb-toolkit-reopen-fab svg {
                width: 18px !important;
                height: 18px !important;
                fill: rgba(255, 255, 255, 0.85) !important;
                pointer-events: none !important;
            }

            #${AUTOSCROLL_PANEL_ID} .autoscroll-divider {
                width: 18px !important;
                height: 1px !important;
                background: rgba(255, 255, 255, 0.08) !important;
                margin: 1px 0 !important;
            }

            #${AUTOSCROLL_PANEL_ID} .autoscroll-speed-label {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                min-width: 22px !important;
                height: 18px !important;
                padding: 0 4px !important;
                border-radius: 8px !important;
                background: rgba(255, 255, 255, 0.06) !important;
                color: rgba(255, 255, 255, 0.7) !important;
                font-size: 9px !important;
                font-weight: 600 !important;
                letter-spacing: 0.3px !important;
                pointer-events: none !important;
                user-select: none !important;
            }

            /* Speed Popup */
            #${AUTOSCROLL_PANEL_ID} .autoscroll-speed-popup {
                position: absolute !important;
                left: 100% !important;
                top: -40px !important;
                margin-left: 12px !important;
                background: rgba(24, 24, 27, 0.95) !important;
                backdrop-filter: blur(16px) saturate(180%) !important;
                -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
                border: 1px solid rgba(255, 255, 255, 0.1) !important;
                border-radius: 12px !important;
                padding: 10px 6px !important;
                display: none !important;
                flex-direction: column !important;
                align-items: center !important;
                gap: 6px !important;
                box-shadow: 0 10px 40px rgba(0,0,0,0.5) !important;
                z-index: 2147483641 !important;
                opacity: 0 !important;
                transform: translateX(-10px) !important;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
                cursor: default !important;
                min-width: 38px !important;
            }

            #${AUTOSCROLL_PANEL_ID} .autoscroll-speed-popup.visible {
                display: flex !important;
                opacity: 1 !important;
                transform: translateX(0) !important;
            }

            #${AUTOSCROLL_PANEL_ID} .autoscroll-speed-val {
                font-size: 10px !important;
                font-weight: 600 !important;
                color: rgba(255, 255, 255, 0.45) !important;
                user-select: none !important;
                font-variant-numeric: tabular-nums !important;
                text-align: center !important;
                width: 100% !important;
                line-height: 1.2 !important;
            }

            #${AUTOSCROLL_PANEL_ID} .autoscroll-speed-slider {
                -webkit-appearance: slider-vertical !important;
                width: 4px !important;
                height: 100px !important;
                background: rgba(255, 255, 255, 0.1) !important;
                border-radius: 2px !important;
                outline: none !important;
                cursor: pointer !important;
            }

            #${AUTOSCROLL_PANEL_ID} .autoscroll-speed-slider::-webkit-slider-thumb {
                -webkit-appearance: none !important;
                width: 14px !important;
                height: 14px !important;
                background: #3b82f6 !important;
                border-radius: 50% !important;
                border: 2px solid #fff !important;
                box-shadow: 0 0 10px rgba(59, 130, 246, 0.5) !important;
            }

            /* Theme Popup */
            #${AUTOSCROLL_PANEL_ID} .autoscroll-theme-popup {
                position: absolute !important;
                left: 100% !important;
                top: 0 !important;
                margin-left: 12px !important;
                background: rgba(24, 24, 27, 0.95) !important;
                backdrop-filter: blur(16px) saturate(180%) !important;
                -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
                border: 1px solid rgba(255, 255, 255, 0.1) !important;
                border-radius: 12px !important;
                padding: 12px !important;
                width: 220px !important;
                max-height: 420px !important;
                overflow-y: auto !important;
                display: none !important;
                flex-direction: column !important;
                gap: 8px !important;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
                z-index: 2147483641 !important;
                opacity: 0 !important;
                transform: translateX(-10px) !important;
                transition: opacity 0.2s ease, transform 0.2s ease !important;
                cursor: default !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-theme-popup::-webkit-scrollbar {
                width: 4px !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-theme-popup::-webkit-scrollbar-thumb {
                background: rgba(255,255,255,0.2) !important;
                border-radius: 4px !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-theme-popup.visible {
                display: flex !important;
                opacity: 1 !important;
                transform: translateX(0) !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-theme-title {
                font-size: 10px !important;
                font-weight: 600 !important;
                color: rgba(255,255,255,0.5) !important;
                text-transform: uppercase !important;
                letter-spacing: 0.5px !important;
                padding-bottom: 6px !important;
                border-bottom: 1px solid rgba(255,255,255,0.1) !important;
                margin-bottom: 2px !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-theme-grid {
                display: grid !important;
                grid-template-columns: repeat(5, 1fr) !important;
                gap: 6px !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-wallpaper-grid {
                display: grid !important;
                grid-template-columns: repeat(2, 1fr) !important;
                gap: 8px !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-theme-item {
                aspect-ratio: 1 !important;
                border-radius: 6px !important;
                border: 2px solid transparent !important;
                cursor: pointer !important;
                transition: transform 0.15s ease, box-shadow 0.15s ease !important;
                position: relative !important;
                width: 100% !important;
                overflow: hidden !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-theme-item:hover {
                transform: scale(1.08) !important;
                z-index: 10 !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;
                border-color: rgba(255,255,255,0.25) !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-theme-item.active {
                border-color: #3b82f6 !important;
                box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3) !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-wallpaper-item {
                aspect-ratio: 16/10 !important;
                border-radius: 8px !important;
                border: 2px solid transparent !important;
                cursor: pointer !important;
                transition: transform 0.15s ease, box-shadow 0.15s ease !important;
                position: relative !important;
                width: 100% !important;
                overflow: hidden !important;
                background-size: cover !important;
                background-position: center !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-wallpaper-item::after {
                content: attr(data-label) !important;
                position: absolute !important;
                bottom: 0 !important;
                left: 0 !important;
                right: 0 !important;
                padding: 3px 6px !important;
                background: linear-gradient(transparent, rgba(0,0,0,0.7)) !important;
                color: rgba(255,255,255,0.9) !important;
                font-size: 9px !important;
                font-weight: 500 !important;
                letter-spacing: 0.3px !important;
                text-align: center !important;
                pointer-events: none !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-wallpaper-item:hover {
                transform: scale(1.05) !important;
                z-index: 10 !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;
                border-color: rgba(255,255,255,0.25) !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-wallpaper-item.active {
                border-color: #3b82f6 !important;
                box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3) !important;
            }

            /* Blur Slider */
            #${AUTOSCROLL_PANEL_ID} .autoscroll-blur-section {
                margin-top: 4px !important;
                padding-top: 8px !important;
                border-top: 1px solid rgba(255,255,255,0.1) !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-blur-header {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                margin-bottom: 6px !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-blur-label {
                font-size: 10px !important;
                font-weight: 600 !important;
                color: rgba(255,255,255,0.5) !important;
                text-transform: uppercase !important;
                letter-spacing: 0.5px !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-blur-value {
                font-size: 10px !important;
                font-weight: 600 !important;
                color: rgba(255,255,255,0.7) !important;
                font-variant-numeric: tabular-nums !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-blur-slider {
                -webkit-appearance: none !important;
                appearance: none !important;
                width: 100% !important;
                height: 4px !important;
                border-radius: 2px !important;
                background: rgba(255,255,255,0.15) !important;
                outline: none !important;
                cursor: pointer !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-blur-slider::-webkit-slider-thumb {
                -webkit-appearance: none !important;
                appearance: none !important;
                width: 14px !important;
                height: 14px !important;
                border-radius: 50% !important;
                background: #3b82f6 !important;
                border: 2px solid rgba(255,255,255,0.3) !important;
                cursor: pointer !important;
                box-shadow: 0 1px 4px rgba(0,0,0,0.3) !important;
                transition: transform 0.1s ease !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-blur-slider::-webkit-slider-thumb:hover {
                transform: scale(1.2) !important;
            }

            /* Width Slider */
            #${AUTOSCROLL_PANEL_ID} .autoscroll-width-section {
                margin-top: 4px !important;
                padding-top: 8px !important;
                border-top: 1px solid rgba(255,255,255,0.1) !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-width-header {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                margin-bottom: 6px !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-width-label {
                font-size: 10px !important;
                font-weight: 600 !important;
                color: rgba(255,255,255,0.5) !important;
                text-transform: uppercase !important;
                letter-spacing: 0.5px !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-width-value-container {
                display: flex !important;
                align-items: center !important;
                gap: 6px !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-width-value {
                font-size: 10px !important;
                font-weight: 600 !important;
                color: rgba(255,255,255,0.7) !important;
                font-variant-numeric: tabular-nums !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-width-reset {
                background: transparent !important;
                border: none !important;
                padding: 0 !important;
                cursor: pointer !important;
                color: rgba(255,255,255,0.4) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                transition: color 0.2s ease !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-width-reset:hover {
                color: #3b82f6 !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-width-reset svg {
                width: 10px !important;
                height: 10px !important;
                stroke: currentColor !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-width-slider {
                -webkit-appearance: none !important;
                appearance: none !important;
                width: 100% !important;
                height: 4px !important;
                border-radius: 2px !important;
                background: rgba(255,255,255,0.15) !important;
                outline: none !important;
                cursor: pointer !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-width-slider::-webkit-slider-thumb {
                -webkit-appearance: none !important;
                appearance: none !important;
                width: 14px !important;
                height: 14px !important;
                border-radius: 50% !important;
                background: #3b82f6 !important;
                border: 2px solid rgba(255,255,255,0.3) !important;
                cursor: pointer !important;
                box-shadow: 0 1px 4px rgba(0,0,0,0.3) !important;
                transition: transform 0.1s ease !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-width-slider::-webkit-slider-thumb:hover {
                transform: scale(1.2) !important;
            }

            /* Theme Toggle */
            #${AUTOSCROLL_PANEL_ID} .autoscroll-toggle-row {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                padding-bottom: 8px !important;
                margin-bottom: 4px !important;
                border-bottom: 1px solid rgba(255,255,255,0.1) !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-toggle-label {
                font-size: 11px !important;
                font-weight: 600 !important;
                color: rgba(255,255,255,0.85) !important;
                letter-spacing: 0.2px !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-toggle {
                position: relative !important;
                width: 32px !important;
                height: 18px !important;
                cursor: pointer !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-toggle input {
                opacity: 0 !important;
                width: 0 !important;
                height: 0 !important;
                position: absolute !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-toggle-track {
                position: absolute !important;
                top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
                border-radius: 9px !important;
                background: rgba(255,255,255,0.15) !important;
                transition: background 0.2s ease !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-toggle-track::after {
                content: '' !important;
                position: absolute !important;
                top: 2px !important;
                left: 2px !important;
                width: 14px !important;
                height: 14px !important;
                border-radius: 50% !important;
                background: rgba(255,255,255,0.7) !important;
                transition: transform 0.2s ease, background 0.2s ease !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-toggle input:checked + .autoscroll-toggle-track {
                background: #3b82f6 !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-toggle input:checked + .autoscroll-toggle-track::after {
                transform: translateX(14px) !important;
                background: #fff !important;
            }

            /* Particle Dropdown */
            #${AUTOSCROLL_PANEL_ID} .autoscroll-particle-section {
                margin-top: 4px !important;
                padding-top: 8px !important;
                border-top: 1px solid rgba(255,255,255,0.1) !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-particle-label {
                font-size: 10px !important;
                font-weight: 600 !important;
                color: rgba(255,255,255,0.5) !important;
                text-transform: uppercase !important;
                letter-spacing: 0.5px !important;
                margin-bottom: 6px !important;
                display: block !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-particle-select {
                -webkit-appearance: none !important;
                appearance: none !important;
                width: 100% !important;
                padding: 5px 24px 5px 8px !important;
                font-size: 11px !important;
                font-weight: 500 !important;
                color: rgba(255,255,255,0.85) !important;
                background: rgba(255,255,255,0.1) !important;
                border: 1px solid rgba(255,255,255,0.12) !important;
                border-radius: 6px !important;
                outline: none !important;
                cursor: pointer !important;
                transition: border-color 0.15s ease, background 0.15s ease !important;
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='rgba(255,255,255,0.5)' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") !important;
                background-repeat: no-repeat !important;
                background-position: right 8px center !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-particle-select:hover {
                border-color: rgba(255,255,255,0.25) !important;
                background-color: rgba(255,255,255,0.14) !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-particle-select:focus {
                border-color: #3b82f6 !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-particle-select option {
                background: #1e1e2e !important;
                color: rgba(255,255,255,0.85) !important;
            }

            /* Layout Settings Popup */
            #${AUTOSCROLL_PANEL_ID} .autoscroll-layout-popup {
                position: absolute !important;
                left: 100% !important;
                top: 0 !important;
                margin-left: 12px !important;
                background: rgba(24, 24, 27, 0.95) !important;
                backdrop-filter: blur(16px) saturate(180%) !important;
                -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
                border: 1px solid rgba(255, 255, 255, 0.1) !important;
                border-radius: 12px !important;
                padding: 12px !important;
                width: 210px !important;
                max-height: 400px !important;
                overflow-y: auto !important;
                display: none !important;
                flex-direction: column !important;
                gap: 4px !important;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
                z-index: 2147483641 !important;
                opacity: 0 !important;
                transform: translateX(-10px) !important;
                transition: opacity 0.2s ease, transform 0.2s ease !important;
                cursor: default !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-layout-popup::-webkit-scrollbar {
                width: 4px !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-layout-popup::-webkit-scrollbar-thumb {
                background: rgba(255,255,255,0.2) !important;
                border-radius: 4px !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-layout-popup.visible {
                display: flex !important;
                opacity: 1 !important;
                transform: translateX(0) !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-layout-title {
                font-size: 10px !important;
                font-weight: 600 !important;
                color: rgba(255,255,255,0.5) !important;
                text-transform: uppercase !important;
                letter-spacing: 0.5px !important;
                padding-bottom: 6px !important;
                border-bottom: 1px solid rgba(255,255,255,0.1) !important;
                margin-bottom: 4px !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-layout-row {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                padding: 5px 0 !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-layout-row:not(:last-child) {
                border-bottom: 1px solid rgba(255,255,255,0.05) !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-layout-label {
                font-size: 11px !important;
                font-weight: 500 !important;
                color: rgba(255,255,255,0.8) !important;
                letter-spacing: 0.1px !important;
                white-space: nowrap !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-layout-toggle {
                position: relative !important;
                width: 32px !important;
                height: 18px !important;
                cursor: pointer !important;
                flex-shrink: 0 !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-layout-toggle input {
                opacity: 0 !important;
                width: 0 !important;
                height: 0 !important;
                position: absolute !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-layout-track {
                position: absolute !important;
                top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
                border-radius: 9px !important;
                background: rgba(255,255,255,0.15) !important;
                transition: background 0.2s ease !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-layout-track::after {
                content: '' !important;
                position: absolute !important;
                top: 2px !important;
                left: 2px !important;
                width: 14px !important;
                height: 14px !important;
                border-radius: 50% !important;
                background: rgba(255,255,255,0.7) !important;
                transition: transform 0.2s ease, background 0.2s ease !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-layout-toggle input:checked + .autoscroll-layout-track {
                background: #3b82f6 !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-layout-toggle input:checked + .autoscroll-layout-track::after {
                transform: translateX(14px) !important;
                background: #fff !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-layout-note {
                font-size: 9px !important;
                color: rgba(255,255,255,0.35) !important;
                font-style: italic !important;
                padding-top: 4px !important;
                border-top: 1px solid rgba(255,255,255,0.08) !important;
                margin-top: 2px !important;
            }

            /* Hover Zoom Popup */
            #${AUTOSCROLL_PANEL_ID} .autoscroll-hoverzoom-popup {
                position: absolute !important;
                left: 100% !important;
                top: 0 !important;
                margin-left: 12px !important;
                background: rgba(20, 20, 22, 0.98) !important;
                backdrop-filter: blur(20px) saturate(180%) !important;
                -webkit-backdrop-filter: blur(20px) saturate(180%) !important;
                border: 1px solid rgba(255, 255, 255, 0.12) !important;
                border-radius: 14px !important;
                padding: 14px !important;
                width: 190px !important;
                display: none !important;
                flex-direction: column !important;
                gap: 8px !important;
                box-shadow: 0 8px 32px rgba(0,0,0,0.6) !important;
                z-index: 2147483641 !important;
                opacity: 0 !important;
                transform: translateX(-12px) !important;
                transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
                cursor: default !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-hoverzoom-popup.visible {
                display: flex !important;
                opacity: 1 !important;
                transform: translateX(0) !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-hoverzoom-popup .hz-popup-header {
                display: flex !important;
                align-items: center !important;
                gap: 6px !important;
                margin-bottom: 4px !important;
                padding-bottom: 8px !important;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-hoverzoom-popup .hz-popup-title {
                font-size: 11px !important;
                font-weight: 700 !important;
                color: rgba(255,255,255,0.9) !important;
                text-transform: uppercase !important;
                letter-spacing: 0.8px !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-hoverzoom-popup .hz-popup-row {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                padding: 4px 0 !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-hoverzoom-popup .hz-popup-label {
                font-size: 11px !important;
                font-weight: 600 !important;
                color: rgba(255,255,255,0.85) !important;
                white-space: nowrap !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-hoverzoom-popup .hz-mode-container {
                display: flex !important;
                flex-direction: column !important;
                gap: 6px !important;
                margin-top: 4px !important;
                padding-top: 8px !important;
                border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-hoverzoom-popup .hz-mode-control {
                display: flex !important;
                background: rgba(255, 255, 255, 0.05) !important;
                border-radius: 9px !important;
                padding: 2px !important;
                position: relative !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-hoverzoom-popup .hz-mode-btn {
                flex: 1 !important;
                padding: 6px 0 !important;
                border: none !important;
                background: transparent !important;
                color: rgba(255, 255, 255, 0.5) !important;
                font-size: 11px !important;
                font-weight: 600 !important;
                border-radius: 7px !important;
                cursor: pointer !important;
                transition: all 0.2s ease !important;
                text-align: center !important;
                position: relative !important;
                z-index: 1 !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-hoverzoom-popup .hz-mode-btn.active {
                background: #3b82f6 !important;
                color: #fff !important;
                box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4) !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-hoverzoom-popup .hz-mode-btn:hover:not(.active) {
                color: rgba(255, 255, 255, 0.9) !important;
                background: rgba(255, 255, 255, 0.05) !important;
            }
            #${AUTOSCROLL_PANEL_ID} .autoscroll-hoverzoom-popup .hz-mode-desc {
                font-size: 9px !important;
                line-height: 1.3 !important;
                color: rgba(255, 255, 255, 0.45) !important;
                font-style: italic !important;
                margin-top: 2px !important;
            }

            /* Theme Thumbnails */
            #${AUTOSCROLL_PANEL_ID} .thumb-cosmic { background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%) !important; }
            #${AUTOSCROLL_PANEL_ID} .thumb-ocean { background: linear-gradient(135deg, #0c1d3d 0%, #1a3a5c 35%, #134e5e 70%, #0d2538 100%) !important; }
            #${AUTOSCROLL_PANEL_ID} .thumb-sunset { background: linear-gradient(135deg, #1a0a1e 0%, #2d1b33 25%, #4a2040 50%, #2d1b33 75%, #1a0a1e 100%) !important; }
            #${AUTOSCROLL_PANEL_ID} .thumb-aurora { background: linear-gradient(135deg, #0d1f1a 0%, #1a3d32 30%, #234d3e 50%, #1a3d32 70%, #0d1f1a 100%) !important; }
            #${AUTOSCROLL_PANEL_ID} .thumb-midnight { background: linear-gradient(135deg, #020111 0%, #0a0520 35%, #16082a 70%, #0a0318 100%) !important; }
            #${AUTOSCROLL_PANEL_ID} .thumb-forest { background: linear-gradient(135deg, #0a1510 0%, #152620 35%, #1c3328 70%, #0d1a14 100%) !important; }
            #${AUTOSCROLL_PANEL_ID} .thumb-rose { background: linear-gradient(135deg, #1a0a0f 0%, #2a1520 35%, #351a28 70%, #1a0a12 100%) !important; }
            #${AUTOSCROLL_PANEL_ID} .thumb-dark { background: linear-gradient(135deg, #0a0a0a 0%, #101012 35%, #151518 70%, #0a0a0c 100%) !important; }
            #${AUTOSCROLL_PANEL_ID} .thumb-sky { background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 35%, #bae6fd 70%, #e8f4fd 100%) !important; }
            #${AUTOSCROLL_PANEL_ID} .thumb-cloud { background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 35%, #dee2e6 70%, #f1f3f5 100%) !important; }
            #${AUTOSCROLL_PANEL_ID} .thumb-mint { background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 35%, #bbf7d0 70%, #e8fbee 100%) !important; }
            #${AUTOSCROLL_PANEL_ID} .thumb-lavender { background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 35%, #e9d5ff 70%, #f5edff 100%) !important; }
            #${AUTOSCROLL_PANEL_ID} .thumb-lemon { background: linear-gradient(135deg, #fefce8 0%, #fef9c3 35%, #fef08a 70%, #fefadc 100%) !important; }
            #${AUTOSCROLL_PANEL_ID} .thumb-sakura { background: linear-gradient(135deg, #fff1f2 0%, #ffe4e6 35%, #fecdd3 70%, #fff5f5 100%) !important; }
            #${AUTOSCROLL_PANEL_ID} .thumb-ivory { background: linear-gradient(135deg, #fafaf9 0%, #f5f5f4 35%, #e7e5e4 70%, #fcfcfb 100%) !important; }
        `
    };

    function queueAnalyticsIncrement(deltaKey, amount = 1) {
        if (!pendingAnalyticsDelta[deltaKey]) {
            pendingAnalyticsDelta[deltaKey] = 0;
        }
        pendingAnalyticsDelta[deltaKey] += amount;

        if (analyticsFlushTimer) {
            return;
        }

        analyticsFlushTimer = setTimeout(() => {
            analyticsFlushTimer = null;
            flushAnalytics();
        }, 900);
    }

    function flushAnalytics() {
        const payload = {
            hiddenAds: pendingAnalyticsDelta.hiddenAds,
            hiddenSuggestions: pendingAnalyticsDelta.hiddenSuggestions,
            hiddenPeople: pendingAnalyticsDelta.hiddenPeople,
            hiddenKeywordPosts: pendingAnalyticsDelta.hiddenKeywordPosts
        };

        if (!payload.hiddenAds && !payload.hiddenSuggestions && !payload.hiddenPeople && !payload.hiddenKeywordPosts) {
            return;
        }

        pendingAnalyticsDelta.hiddenAds = 0;
        pendingAnalyticsDelta.hiddenSuggestions = 0;
        pendingAnalyticsDelta.hiddenPeople = 0;
        pendingAnalyticsDelta.hiddenKeywordPosts = 0;

        window.postMessage(
            {
                __fbToolkit: true,
                type: 'ANALYTICS_INCREMENT',
                delta: payload
            },
            '*'
        );
    }

    function getHomepageSettings() {
        return window.fb_toolkit?.homepage || {};
    }

    function getKeywordTerms(keywordFilterSettings) {
        const rawTerms = keywordFilterSettings?.terms;
        if (Array.isArray(rawTerms)) {
            return rawTerms
                .map((term) => String(term || '').trim().toLowerCase())
                .filter(Boolean);
        }

        if (typeof rawTerms === 'string') {
            return rawTerms
                .split(/[\n,]/)
                .map((term) => term.trim().toLowerCase())
                .filter(Boolean);
        }

        return [];
    }

    function getFeedArticles() {
        const nodes = new Set();

        FEED_ARTICLE_SELECTORS.forEach((selector) => {
            document.querySelectorAll(selector).forEach((node) => {
                if (node && node.nodeType === 1) {
                    nodes.add(node);
                }
            });
        });

        return Array.from(nodes);
    }

    function getPostCardElement(article) {
        if (!article) {
            return null;
        }

        return (
            article.closest('div[data-pagelet^="FeedUnit_"]') ||
            article.closest('div[aria-posinset]') ||
            article
        );
    }

    function normalizeText(rawText) {
        return String(rawText || '')
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            .normalize('NFKC')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getCardText(article, cardElement) {
        const cardText = cardElement?.innerText || cardElement?.textContent || '';
        if (cardText) {
            return normalizeText(cardText);
        }

        const articleText = article?.innerText || article?.textContent || '';
        return normalizeText(articleText);
    }

    function isHomepageRoute() {
        return location.pathname === '/' || location.pathname === '/home.php';
    }

    function isReelRoute() {
        const pathname = String(location.pathname || '').toLowerCase();
        return pathname.startsWith('/reel/') || pathname.includes('/reel/');
    }

    function isPhotoRoute() {
        const pathname = String(location.pathname || '').toLowerCase();
        return pathname.startsWith('/photo') || pathname.includes('/photo/');
    }

    function isMarketplaceRoute() {
        const pathname = String(location.pathname || '').toLowerCase();
        return pathname.startsWith('/marketplace');
    }

    function isHomepage() {
        const pathname = String(location.pathname || '').toLowerCase();
        // Homepage is either / or /home.php or /?sk=h_nor (alternative homepage routes)
        return pathname === '/' || pathname === '/home.php' || pathname.startsWith('/?');
    }

    function isMessagesRoute() {
        const pathname = String(location.pathname || '').toLowerCase();
        return pathname.startsWith('/messages');
    }

    function isMarketplaceItemRoute() {
        const pathname = String(location.pathname || '').toLowerCase();
        return pathname.startsWith('/marketplace/item/');
    }

    function isProfileRoute() {
        const pathname = String(location.pathname || '').toLowerCase();
        // Profile pages: /username, /profile.php?id=xxx, or /people/xxx
        // Exclude known non-profile paths
        const nonProfilePaths = [
            '/marketplace', '/watch', '/groups', '/events', '/pages',
            '/gaming', '/reel', '/photo', '/stories', '/settings',
            '/help', '/privacy', '/policies', '/ads', '/business',
            '/login', '/recover', '/checkpoint', '/notifications'
        ];

        if (nonProfilePaths.some(path => pathname.startsWith(path))) {
            return false;
        }

        // Check for profile.php
        if (pathname.startsWith('/profile.php')) {
            return true;
        }

        // Check for /people/ paths
        if (pathname.startsWith('/people/')) {
            return true;
        }

        // Check for username paths (single segment like /username or /username/about)
        const segments = pathname.split('/').filter(Boolean);
        if (segments.length >= 1 && segments.length <= 3) {
            // First segment should look like a username
            const firstSegment = segments[0];
            // Usernames are alphanumeric with dots
            if (/^[\w.]+$/.test(firstSegment) && firstSegment.length > 0) {
                return true;
            }
        }

        return false;
    }

    function isLikelyReelVideo(video) {
        if (!video || video.nodeType !== 1 || !video.isConnected) {
            return false;
        }

        if (isReelRoute()) {
            return true;
        }

        if (video.closest('a[href*="/reel/"]')) {
            return true;
        }

        if (
            video.closest(
                '[aria-label*="reel" i], [data-pagelet*="Reel"], [data-pagelet*="reel"], [id*="reel" i]'
            )
        ) {
            return true;
        }

        return Boolean(video.parentElement?.querySelector?.('a[href*="/reel/"]'));
    }

    function getReelVideos() {
        return Array.from(document.querySelectorAll('video')).filter((video) => isLikelyReelVideo(video));
    }

    function normalizeReelSpeed(rawValue) {
        const numeric = Number(rawValue);
        if (!Number.isFinite(numeric)) {
            return 1;
        }

        let closest = REEL_SPEED_OPTIONS[0];
        let closestDistance = Math.abs(numeric - closest);

        for (let index = 1; index < REEL_SPEED_OPTIONS.length; index += 1) {
            const candidate = REEL_SPEED_OPTIONS[index];
            const distance = Math.abs(numeric - candidate);
            if (distance < closestDistance) {
                closest = candidate;
                closestDistance = distance;
            }
        }

        return closest;
    }

    function isVideoInViewport(video) {
        if (!video || typeof video.getBoundingClientRect !== 'function') {
            return false;
        }

        const rect = video.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return false;
        }

        return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
    }

    function getVideoVisibleArea(video) {
        if (!video || typeof video.getBoundingClientRect !== 'function') {
            return 0;
        }

        const rect = video.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

        const width = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
        const height = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        return width * height;
    }

    function getPrimaryReelVideo(videos) {
        const list = Array.isArray(videos) ? videos : getReelVideos();
        if (!list.length) {
            return null;
        }

        const visibleVideos = list.filter((video) => isVideoInViewport(video));
        const activeVisible = visibleVideos.filter((video) => !video.paused && !video.ended);

        const pickLargest = (candidates) => {
            let bestVideo = null;
            let bestArea = -1;

            candidates.forEach((candidate) => {
                const area = getVideoVisibleArea(candidate);
                if (area > bestArea) {
                    bestArea = area;
                    bestVideo = candidate;
                }
            });

            return bestVideo;
        };

        return (
            pickLargest(activeVisible) ||
            pickLargest(visibleVideos) ||
            pickLargest(list) ||
            null
        );
    }

    function getVideoPlayerContainer(video) {
        if (!video || video.nodeType !== 1) {
            return null;
        }

        const directMatch = video.closest('div[aria-label="Video player"]');
        if (directMatch) {
            return directMatch;
        }

        const containers = document.querySelectorAll('div[aria-label="Video player"]');
        for (let index = 0; index < containers.length; index += 1) {
            const container = containers[index];
            if (container.contains(video)) {
                return container;
            }
        }

        return null;
    }

    function setVideoPlaybackSpeed(video, speed, sourceKey) {
        if (!video || video.nodeType !== 1) {
            return;
        }

        const normalizedSpeed = normalizeReelSpeed(speed);
        video.playbackRate = normalizedSpeed;
        video.defaultPlaybackRate = normalizedSpeed;

        if (sourceKey) {
            video.dataset.fbToolkitReelSpeedFor = sourceKey;
            video.dataset.fbToolkitReelSpeedValue = String(normalizedSpeed);
        }
    }

    function muteReelVideoForCurrentSource(video) {
        if (!video || video.nodeType !== 1) {
            return;
        }

        const sourceKey = video.currentSrc || video.src || video.getAttribute('src') || 'sourceless';
        if (video.dataset.fbToolkitReelMutedFor === sourceKey) {
            return;
        }

        video.defaultMuted = true;
        video.muted = true;

        try {
            if (typeof video.volume === 'number') {
                video.volume = 0;
            }
        } catch (error) {
            // Some players disallow programmatic volume changes.
        }

        video.dataset.fbToolkitReelMutedFor = sourceKey;
    }

    function unmuteReelVideo(video) {
        if (!video || video.nodeType !== 1) {
            return;
        }

        // Only unmute if we previously muted it
        if (video.dataset.fbToolkitReelMutedFor) {
            delete video.dataset.fbToolkitReelMutedFor;
        }

        video.defaultMuted = false;
        video.muted = false;

        try {
            if (typeof video.volume === 'number' && video.volume === 0) {
                video.volume = 1;
            }
        } catch (error) {
            // Some players disallow programmatic volume changes.
        }
    }

    function applyDefaultSpeedForCurrentSource(video, speed) {
        if (!video || video.nodeType !== 1) {
            return;
        }

        const normalizedSpeed = normalizeReelSpeed(speed);
        const sourceKey = video.currentSrc || video.src || video.getAttribute('src') || 'sourceless';

        if (
            video.dataset.fbToolkitReelSpeedFor === sourceKey &&
            normalizeReelSpeed(video.dataset.fbToolkitReelSpeedValue) === normalizedSpeed
        ) {
            return;
        }

        setVideoPlaybackSpeed(video, normalizedSpeed, sourceKey);
    }

    function removeReelControlPanel() {
        const panel = document.getElementById(REEL_CONTROL_PANEL_ID);
        if (panel) {
            panel.remove();
        }
    }

    function handleResetButtonClick(btn) {
        if (!btn) return;

        if (btn.dataset.confirmPending === 'true') {
            // Second click - confirmed, reset
            reelWatchCount = 0;
            delete btn.dataset.confirmPending;
            btn.classList.remove('confirm');
            btn.textContent = 'Reset';
            updateReelCounterDisplay();
            saveReelWatchCount();
        } else {
            // First click - ask for confirmation
            btn.dataset.confirmPending = 'true';
            btn.classList.add('confirm');
            btn.textContent = 'Sure?';

            // Auto-cancel after 3 seconds
            setTimeout(() => {
                if (btn && btn.dataset.confirmPending === 'true') {
                    delete btn.dataset.confirmPending;
                    btn.classList.remove('confirm');
                    btn.textContent = 'Reset';
                }
            }, 3000);
        }
    }

    function showCounterMenu(counterEl) {
        // Remove existing menu if any
        let menu = document.getElementById('fb-toolkit-counter-menu');
        if (menu) {
            menu.remove();
        }

        // Create menu
        menu = document.createElement('div');
        menu.id = 'fb-toolkit-counter-menu';
        menu.innerHTML = `
            <button type="button" class="danger" data-action="reset">🔄 Reset Counter</button>
        `;

        document.documentElement.appendChild(menu);

        // Position menu near counter
        const counterRect = counterEl.getBoundingClientRect();

        // First, add menu to DOM to get its height
        menu.style.visibility = 'hidden';
        menu.classList.add('show');
        const menuHeight = menu.offsetHeight;
        menu.style.visibility = '';

        // Position above the counter
        menu.style.left = `${counterRect.left}px`;
        menu.style.top = `${counterRect.top - menuHeight - 8}px`;

        // Show menu
        menu.classList.add('show');

        // Handle reset click
        const resetBtn = menu.querySelector('[data-action="reset"]');
        resetBtn.onclick = function (e) {
            e.preventDefault();
            e.stopPropagation();
            reelWatchCount = 0;
            updateReelCounterDisplay();
            saveReelWatchCount();
            menu.remove();
        };

        // Close menu when clicking outside
        const closeMenu = (e) => {
            if (!menu.contains(e.target) && e.target !== counterEl) {
                menu.remove();
                document.removeEventListener('mousedown', closeMenu);
            }
        };
        setTimeout(() => {
            document.addEventListener('mousedown', closeMenu);
        }, 10);
    }

    function handleReelControlClick(event) {
        // Handle counter reset
        const counter = event.target.closest('[data-fb-toolkit-action="reset-counter"]');
        if (counter) {
            if (counter.dataset.resetPending === 'true') {
                // Confirmed reset
                reelWatchCount = 0;
                delete counter.dataset.resetPending;
                updateReelCounterDisplay();
                saveReelWatchCount();
            } else {
                // First click - show confirmation
                counter.dataset.resetPending = 'true';
                counter.textContent = 'Reset?';
                counter.style.color = '#fca5a5'; // Red tint for warning

                // Auto-cancel after 3 seconds
                setTimeout(() => {
                    if (counter && counter.dataset.resetPending === 'true') {
                        delete counter.dataset.resetPending;
                        counter.style.color = ''; // Reset color
                        updateReelCounterDisplay(); // Restores the count number
                    }
                }, 3000);
            }
            return;
        }

        const button = event.target.closest('button[data-fb-toolkit-action]');
        if (!button) {
            return;
        }

        const targetVideo = getPrimaryReelVideo();
        const action = button.dataset.fbToolkitAction;

        // Handle mute toggle - REMOVED (not working reliably with Facebook)

        // Handle auto-next toggle
        if (action === 'auto-next') {
            reelAutoNextEnabled = !reelAutoNextEnabled;
            updateAutoNextButtonState(button, reelAutoNextEnabled);
            if (!reelAutoNextEnabled) hideAutoNextCountdown();

            // Save setting to storage via bridge
            window.postMessage({
                __fbToolkit: true,
                type: 'UPDATE_SETTING',
                payload: {
                    category: 'homepage',
                    feature: 'REELS_AUTO_NEXT',
                    value: { enable: reelAutoNextEnabled }
                }
            }, '*');

            if (reelAutoNextEnabled && targetVideo) {
                setupAutoNextListener(targetVideo);
            } else if (!reelAutoNextEnabled && reelAutoNextVideoRef) {
                // Clean up listener when disabled
                reelAutoNextVideoRef.removeEventListener('ended', handleVideoEnded);
            }
            return;
        }

        // Handle navigation buttons — bypass goToNextReel's cooldown so manual clicks always work
        if (action === 'nav-next') {
            hideAutoNextCountdown();
            reelAutoNextCooldownUntil = Date.now() + REEL_AUTO_NEXT_COOLDOWN_MS;
            if (reelAutoNextVideoRef) {
                delete reelAutoNextVideoRef.dataset.fbToolkitAutoNextTriggeredFor;
            }
            navigateReel('next');
            return;
        }
        if (action === 'nav-prev') {
            hideAutoNextCountdown();
            reelAutoNextCooldownUntil = Date.now() + REEL_AUTO_NEXT_COOLDOWN_MS;
            if (reelAutoNextVideoRef) {
                delete reelAutoNextVideoRef.dataset.fbToolkitAutoNextTriggeredFor;
            }
            navigateReel('prev');
            return;
        }

        // Handle immersive toggle
        if (action === 'immersive') {
            reelImmersiveEnabled = !reelImmersiveEnabled;
            button.classList.toggle('active', reelImmersiveEnabled);
            button.dataset.tooltip = reelImmersiveEnabled ? 'Immersive: ON' : 'Immersive';

            // Save setting to storage via bridge
            window.postMessage({
                __fbToolkit: true,
                type: 'UPDATE_SETTING',
                payload: {
                    category: 'homepage',
                    feature: 'REELS_IMMERSIVE',
                    value: { enable: reelImmersiveEnabled }
                }
            }, '*');

            if (reelImmersiveEnabled) {
                startImmersiveBackground();
            } else {
                stopImmersiveBackground();
            }
            return;
        }

        if (!targetVideo) {
            return;
        }

        if (action === 'restart') {
            targetVideo.currentTime = 0;
            return;
        }

        const rewindMatch = /^rewind-(\d+)$/.exec(action);
        if (rewindMatch) {
            const rewindSeconds = Number(rewindMatch[1]);
            targetVideo.currentTime = Math.max(0, (Number(targetVideo.currentTime) || 0) - rewindSeconds);
            return;
        }

        const forwardMatch = /^forward-(\d+)$/.exec(action);
        if (forwardMatch) {
            const forwardSeconds = Number(forwardMatch[1]);
            const duration = Number(targetVideo.duration);
            const nextTime = (Number(targetVideo.currentTime) || 0) + forwardSeconds;

            if (Number.isFinite(duration) && duration > 0) {
                targetVideo.currentTime = Math.min(duration, nextTime);

                // Failsafe: If we're at or near the end after forwarding, trigger auto-next
                if (reelAutoNextEnabled && nextTime >= duration - 0.5) {
                    // Clear any existing trigger flag
                    delete targetVideo.dataset.fbToolkitAutoNextTriggeredFor;

                    // Check after a short delay to let the video state settle
                    setTimeout(() => checkVideoEndAndNavigate(targetVideo), 200);
                    setTimeout(() => checkVideoEndAndNavigate(targetVideo), 500);
                }
            } else {
                targetVideo.currentTime = nextTime;
            }
        }
    }

    function updateAutoNextButtonState(button, isEnabled) {
        button.classList.toggle('active', isEnabled);
        button.title = isEnabled ? 'Auto-next: ON' : 'Auto-next: OFF';
    }

    function updateReelCounterDisplay() {
        const counter = document.querySelector(`#${REEL_CONTROL_PANEL_ID} .reel-counter`);
        if (counter) {
            counter.textContent = String(reelWatchCount);
            // Reset pending style if any
            if (counter.dataset.resetPending) {
                delete counter.dataset.resetPending;
                counter.classList.remove('confirm');
            }
        }
    }

    function saveReelWatchCount() {
        window.postMessage({
            __fbToolkit: true,
            type: 'UPDATE_SETTING',
            payload: {
                category: 'homepage',
                feature: 'REELS_WATCH_COUNT',
                value: { count: reelWatchCount }
            }
        }, '*');
    }

    function createTimeoutModal(count, threshold, customMessage) {
        // Remove existing modal if any
        const existing = document.getElementById('fb-toolkit-reels-timeout-modal');
        if (existing) {
            existing.remove();
        }

        console.log('[FB Toolkit] Timeout triggered - starting delay sequence');

        // STEP 1: Wait 2 seconds to ensure video is fully loaded
        setTimeout(() => {
            console.log('[FB Toolkit] Step 1: 2 second wait complete, now pausing videos');

            // Find ALL videos on the page and pause them ALL
            const allVideos = Array.from(document.querySelectorAll('video'));
            let pausedVideos = [];

            console.log('[FB Toolkit] Found', allVideos.length, 'videos');

            // STEP 2: Pause ALL videos
            allVideos.forEach((video, index) => {
                if (!video.paused) {
                    try {
                        video.pause();
                        pausedVideos.push(video);
                        console.log('[FB Toolkit] Paused video', index);
                    } catch (e) {
                        console.log('[FB Toolkit] Failed to pause video', index, e);
                    }
                }
            });

            // Try again after a tiny delay for any that might have auto-resumed
            setTimeout(() => {
                allVideos.forEach((video) => {
                    if (!video.paused) {
                        try {
                            video.pause();
                            if (!pausedVideos.includes(video)) {
                                pausedVideos.push(video);
                            }
                        } catch (e) { }
                    }
                });
            }, 200);

            // STEP 3: Wait 1 more second, then show the modal
            setTimeout(() => {
                console.log('[FB Toolkit] Step 3: 1 second wait complete, now showing modal');

                // Pause again right before showing modal in case any resumed
                allVideos.forEach((video) => {
                    if (!video.paused) {
                        try {
                            video.pause();
                            if (!pausedVideos.includes(video)) {
                                pausedVideos.push(video);
                            }
                        } catch (e) { }
                    }
                });

                const modal = document.createElement('div');
                modal.id = 'fb-toolkit-reels-timeout-modal';

                const defaultMessage = "Time to take a break! You've been watching reels for a while.";
                const message = customMessage && customMessage.trim() ? customMessage.trim() : defaultMessage;

                modal.innerHTML = `
                    <div class="modal-content">
                        <div class="modal-icon">☕</div>
                        <h2 class="modal-title">Time for a Break!</h2>
                        <p class="modal-message">${message}</p>
                        <div class="modal-count">You've watched <strong>${count}</strong> reels since your last break</div>
                        <div class="modal-paused-indicator">Video paused</div>
                        <div class="modal-buttons">
                            <button class="modal-btn modal-btn-primary" data-action="take-break">Take a Break</button>
                            <button class="modal-btn modal-btn-secondary" data-action="continue">▶ Continue</button>
                        </div>
                        <p class="modal-instruction">You can adjust this reminder in extension settings</p>
                    </div>
                `;

                document.documentElement.appendChild(modal);

                // Handle button clicks
                const takeBreakBtn = modal.querySelector('[data-action="take-break"]');
                const continueBtn = modal.querySelector('[data-action="continue"]');

                takeBreakBtn.onclick = () => {
                    modal.remove();
                    // Reset the timeout counter and timestamp
                    reelTimeoutCount = 0;
                    lastReelViewTime = Date.now();
                    // Navigate away from reels
                    window.location.href = '/';
                };

                continueBtn.onclick = () => {
                    modal.remove();
                    // Reset the timeout counter and timestamp so it starts fresh
                    reelTimeoutCount = 0;
                    lastReelViewTime = Date.now();
                    // Wait 1 second, then resume playing all paused videos
                    setTimeout(() => {
                        pausedVideos.forEach((video) => {
                            try {
                                video.play().catch(() => { });
                            } catch (e) { }
                        });
                        console.log('[FB Toolkit] Resumed', pausedVideos.length, 'videos after timeout modal');
                    }, 1000);
                };

                // Close on backdrop click
                modal.onclick = (e) => {
                    if (e.target === modal) {
                        modal.remove();
                        // Reset counter and timestamp on backdrop click too
                        reelTimeoutCount = 0;
                        lastReelViewTime = Date.now();
                        // Wait 1 second, then resume all paused videos
                        setTimeout(() => {
                            pausedVideos.forEach((video) => {
                                try {
                                    video.play().catch(() => { });
                                } catch (e) { }
                            });
                        }, 1000);
                    }
                };
            }, 1000); // 1 second delay before showing modal (after pause)
        }, 2000); // 2 second delay to ensure video is loaded
    }

    // Flag to prevent double-triggering of timeout modal
    let timeoutModalInProgress = false;

    function checkReelsTimeout(settings) {
        if (!settings.REELS_TIMEOUT?.enable) {
            return false;
        }

        // Prevent double-triggering
        if (timeoutModalInProgress) {
            return false;
        }

        const threshold = Math.max(1, Number(settings.REELS_TIMEOUT?.threshold) || 100);
        const customMessage = settings.REELS_TIMEOUT?.message || '';

        // Check if we've reached the threshold using the separate timeout counter
        if (reelTimeoutCount >= threshold) {
            // Set flag to prevent double-triggering
            timeoutModalInProgress = true;

            // Reset the counter IMMEDIATELY to prevent re-triggering
            reelTimeoutCount = 0;

            // Show the modal (which has its own 1-second delay)
            createTimeoutModal(threshold, threshold, customMessage);

            // Clear the flag after the modal has had time to appear and be handled
            setTimeout(() => {
                timeoutModalInProgress = false;
            }, 3000);

            return true;
        }

        return false;
    }

    function trackReelView() {
        const currentUrl = window.location.pathname;
        if (!currentUrl.startsWith('/reel/')) {
            return;
        }

        // Only count if this is a new reel URL
        if (currentUrl !== lastTrackedReelUrl) {
            lastTrackedReelUrl = currentUrl;

            // ── Auto-next navigation guard ──
            // Whenever we detect a new reel URL (by ANY means: scroll, keyboard, click, 
            // our buttons, etc.), set the cooldown so the auto-next system doesn't 
            // immediately skip this new reel based on stale video state from the 
            // previous reel.
            if (reelAutoNextEnabled) {
                reelAutoNextCooldownUntil = Date.now() + REEL_AUTO_NEXT_COOLDOWN_MS;
                if (reelAutoNextVideoRef) {
                    delete reelAutoNextVideoRef.dataset.fbToolkitAutoNextTriggeredFor;
                }
            }

            // Auto-reset timeout counter if user comes back after a break
            // Reset if more than 30 minutes (1800000ms) have passed since last view
            const now = Date.now();
            const RESET_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

            if (lastReelViewTime && (now - lastReelViewTime) > RESET_THRESHOLD_MS) {
                // User took a break, reset the timeout counter
                reelTimeoutCount = 0;
                console.log('[FB Toolkit] Timeout counter auto-reset after inactivity');
            }

            // Update the last view time
            lastReelViewTime = now;

            reelWatchCount++;
            reelTimeoutCount++; // Increment the separate timeout counter
            updateReelCounterDisplay();
            saveReelWatchCount();

            // Check if we should show timeout modal
            const settings = getHomepageSettings();
            if (settings) {
                checkReelsTimeout(settings);
            }
        }
    }

    function checkAndSkipSponsoredReel() {
        const currentUrl = window.location.pathname;
        if (!currentUrl.startsWith('/reel/')) {
            return false;
        }

        // Avoid double-skipping - check both URL and in-progress flag
        if (currentUrl === lastSkippedSponsoredUrl || sponsoredSkipInProgress) {
            return false;
        }

        // Extract reel ID from URL for Relay store lookup
        const reelIdMatch = currentUrl.match(/\/reel\/(\d+)/);
        const reelId = reelIdMatch ? reelIdMatch[1] : null;

        // Look for sponsored indicators ONLY within the reel player area
        // This prevents false positives from sponsored content in the background feed

        // Find the reel player container - expanded selectors for Edge compatibility
        const reelContainer = document.querySelector('[data-pagelet*="Reel"], [role="dialog"], [aria-label*="reel" i]')
            || document.querySelector('div[style*="position: fixed"]')
            || document.querySelector('[data-pagelet="ReelsPlayerPagelet"]')
            || document.body;

        // Track if any indicator was found
        let isSponsored = false;

        const sponsoredIndicators = [
            // 1. Relay Store Detection - Check for sponsored_data using reel ID
            () => {
                if (!reelId || !window.storeFinder) return false;
                try {
                    // Try multiple ID formats that Facebook might use
                    const idFormats = [
                        reelId,
                        `S:_I${reelId}:`,
                        `${reelId}:`,
                    ];
                    for (const id of idFormats) {
                        const hasAdId = window.storeFinder(id, '^sponsored_data.ad_id') ||
                            window.storeFinder(id, 'sponsored_data.ad_id') ||
                            window.storeFinder(id, '^sponsored_data') ||
                            window.storeFinder(id, 'is_sponsored');
                        if (hasAdId) {
                            console.log('[FB Toolkit] Relay store detected sponsored reel');
                            return true;
                        }
                    }
                } catch (e) {
                    // Relay store may not be ready
                }
                return false;
            },
            // 2. Link to ads/about page within container
            () => !!reelContainer.querySelector('a[href*="/ads/about"]'),
            // 3. Ad preview attribute
            () => !!reelContainer.querySelector('[data-ad-preview], [data-ad-comet-preview], [data-ad-rendering-role]'),
            // 4. Sponsored aria-label (multiple variations)
            () => !!reelContainer.querySelector('[aria-label*="Sponsored"], [aria-label*="sponsored"], [aria-label*="Advertisement"]'),
            // 5. "Why am I seeing this ad?" link
            () => !!reelContainer.querySelector('a[href*="ads/preferences"], a[href*="ad_preferences"]'),
            // 6. Look for "Sponsored" text (including obfuscated versions)
            () => {
                const sponsorLabels = reelContainer.querySelectorAll('span, a, div');
                for (const el of sponsorLabels) {
                    const text = el.textContent?.trim();
                    // Match "Sponsored" exactly or common obfuscations
                    if (text && /^Sponsor(ed|izado|isé)?$/i.test(text)) {
                        return true;
                    }
                    // Check for obfuscated "Sponsored" where letters are in separate spans
                    if (el.children.length >= 5 && el.children.length <= 12) {
                        const combined = Array.from(el.children)
                            .map(c => c.textContent || '')
                            .join('');
                        if (/^Sponsored$/i.test(combined.trim())) {
                            return true;
                        }
                    }
                }
                return false;
            },
            // 7. Check for ad tracking parameters in profile links
            () => {
                const profileLinks = reelContainer.querySelectorAll('a[href*="profile.php"], a[href*="/reel/"]');
                for (const link of profileLinks) {
                    const href = link.href || '';
                    // Ad links often have these tracking parameters
                    if (href.includes('__cft__') && (
                        href.includes('ad_id') ||
                        href.includes('sponsored') ||
                        href.includes('campaign')
                    )) {
                        return true;
                    }
                }
                return false;
            },
            // 8. Check for "Learn More", "Shop Now", etc. CTA buttons (common in ads)
            () => {
                const ctaButtons = reelContainer.querySelectorAll('a[role="link"], div[role="button"]');
                const adCTAPatterns = [
                    /^Shop\s*Now$/i,
                    /^Learn\s*More$/i,
                    /^Get\s*Offer$/i,
                    /^Sign\s*Up$/i,
                    /^Book\s*Now$/i,
                    /^Download$/i,
                    /^Install\s*Now$/i,
                    /^Get\s*App$/i,
                    /^Listen\s*Now$/i,
                    /^Watch\s*Now$/i,
                ];
                for (const btn of ctaButtons) {
                    const text = btn.textContent?.trim();
                    // Only flag if it's in a suspicious context (near bottom of reel)
                    if (text && adCTAPatterns.some(pattern => pattern.test(text))) {
                        const rect = btn.getBoundingClientRect();
                        // CTA buttons in ads are typically at the bottom
                        if (rect.bottom > window.innerHeight * 0.7) {
                            // Additional check: is this next to a username/page name?
                            const parent = btn.closest('div[class*="x9f619"]');
                            if (parent && parent.querySelector('a[aria-label*="Profile"], a[aria-label*="Owner"]')) {
                                console.log('[FB Toolkit] CTA button detected in reel context');
                                return true;
                            }
                        }
                    }
                }
                return false;
            },
            // 9. Check video source URL for ad-related patterns
            () => {
                const videos = reelContainer.querySelectorAll('video');
                for (const video of videos) {
                    const src = video.src || video.currentSrc || '';
                    // Ad videos sometimes have different URL patterns
                    if (src.includes('/ads/') || src.includes('ad_video') || src.includes('sponsored_video')) {
                        return true;
                    }
                }
                return false;
            },
            // 10. REMOVED — was matching all profile picture icons (false positive)
        ];

        isSponsored = sponsoredIndicators.some(check => {
            try { return check(); } catch (e) { return false; }
        });

        if (isSponsored) {
            // Set flags immediately to prevent re-entry
            lastSkippedSponsoredUrl = currentUrl;
            sponsoredSkipInProgress = true;

            console.log('[FB Toolkit] Skipping sponsored reel:', currentUrl);
            queueAnalyticsIncrement('hiddenAds');

            // Skip after a short delay, then clear the in-progress flag
            setTimeout(() => {
                goToNextReel();
                // Clear in-progress flag after navigation has started
                setTimeout(() => {
                    sponsoredSkipInProgress = false;
                }, 500);
            }, 300);

            return true;
        }

        return false;
    }

    // Enhanced check that runs multiple times to catch late-loading sponsored indicators
    function checkAndSkipSponsoredReelWithRetry() {
        const currentUrl = window.location.pathname;
        if (!currentUrl.startsWith('/reel/')) {
            return;
        }

        // Already skipped or in progress
        if (currentUrl === lastSkippedSponsoredUrl || sponsoredSkipInProgress) {
            return;
        }

        // Check immediately
        if (checkAndSkipSponsoredReel()) {
            return;
        }

        // Schedule retry checks for late-loading content (Edge may render slower)
        const retryDelays = [200, 500, 1000, 2000];
        for (const delay of retryDelays) {
            setTimeout(() => {
                // Only retry if still on the same URL and not already skipped
                if (window.location.pathname === currentUrl &&
                    currentUrl !== lastSkippedSponsoredUrl &&
                    !sponsoredSkipInProgress) {
                    checkAndSkipSponsoredReel();
                }
            }, delay);
        }
    }

    function setupAutoNextListener(video) {
        // Remove listener from previous video if any
        if (reelAutoNextVideoRef && reelAutoNextVideoRef !== video) {
            reelAutoNextVideoRef.removeEventListener('timeupdate', handleVideoTimeUpdate);
            reelAutoNextVideoRef.removeEventListener('ended', handleVideoEnded);
            reelAutoNextVideoRef.removeEventListener('seeked', handleVideoSeeked);
        }

        // Clear existing interval
        if (reelAutoNextIntervalId) {
            clearInterval(reelAutoNextIntervalId);
            reelAutoNextIntervalId = null;
        }

        reelAutoNextVideoRef = video;
        video.removeEventListener('timeupdate', handleVideoTimeUpdate);
        video.removeEventListener('ended', handleVideoEnded);
        video.removeEventListener('seeked', handleVideoSeeked);

        video.addEventListener('timeupdate', handleVideoTimeUpdate);
        video.addEventListener('ended', handleVideoEnded);
        video.addEventListener('seeked', handleVideoSeeked);

        // Also use interval as fallback for when tab is in background
        // (timeupdate events may not fire reliably when tab is not focused)
        reelAutoNextIntervalId = setInterval(() => {
            if (!reelAutoNextEnabled || !reelAutoNextVideoRef) {
                return;
            }
            checkVideoEndAndNavigate(reelAutoNextVideoRef);
        }, 300); // Fallback interval for background tab detection

        // Handle visibility change - Edge throttles timers aggressively in background
        // When tab becomes visible again, immediately check if we need to advance
        if (!window.__fbToolkitVisibilityHandlerAdded) {
            window.__fbToolkitVisibilityHandlerAdded = true;
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && reelAutoNextEnabled && reelAutoNextVideoRef) {
                    // Small delay to let video state update
                    setTimeout(() => {
                        checkVideoEndAndNavigate(reelAutoNextVideoRef);
                    }, 100);
                }
            });
        }

        // Intercept manual keyboard navigation (ArrowDown/ArrowUp) on reel pages.
        // When the user manually presses these keys, Facebook navigates but the 
        // auto-next system may still fire based on old video state. Setting cooldown here.
        if (!window.__fbToolkitArrowKeyHandlerAdded) {
            window.__fbToolkitArrowKeyHandlerAdded = true;
            document.addEventListener('keydown', (e) => {
                if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && window.location.pathname.startsWith('/reel/')) {
                    reelAutoNextCooldownUntil = Date.now() + REEL_AUTO_NEXT_COOLDOWN_MS;
                    if (reelAutoNextVideoRef) {
                        delete reelAutoNextVideoRef.dataset.fbToolkitAutoNextTriggeredFor;
                    }
                }
            }, true);
        }
    }

    function checkVideoEndAndNavigate(video) {
        if (!video || !reelAutoNextEnabled) return;

        // Cooldown guard: prevent rapid re-triggering after a recent auto-next
        if (Date.now() < reelAutoNextCooldownUntil) return;

        const duration = video.duration;
        const currentTime = video.currentTime;
        const currentSrc = video.currentSrc || video.src;

        // Check if already triggered for this specific video source
        if (video.dataset.fbToolkitAutoNextTriggeredFor === currentSrc) {
            return;
        }

        // Minimum playback guard: the video must have played for at least 1 second
        // This prevents skipping during reel transitions where video metadata is in flux
        if (!Number.isFinite(duration) || duration <= 0 || currentTime < 1) {
            return;
        }

        // Trigger when we're very close to the end
        // Only trigger within the last 0.3 seconds of the video
        const nearEnd = currentTime >= duration - 0.3;
        const pausedAtEnd = video.paused && currentTime >= duration - 0.5;

        if (nearEnd || pausedAtEnd) {
            video.dataset.fbToolkitAutoNextTriggeredFor = currentSrc;
            goToNextReel();
        }
    }

    function handleVideoTimeUpdate(event) {
        if (!reelAutoNextEnabled) {
            hideAutoNextCountdown();
            return;
        }

        // Cooldown guard
        if (Date.now() < reelAutoNextCooldownUntil) {
            hideAutoNextCountdown();
            return;
        }

        const video = event.target;
        const duration = video.duration;
        const currentTime = video.currentTime;
        const currentSrc = video.currentSrc || video.src;

        // Check if already triggered for this specific video source
        if (video.dataset.fbToolkitAutoNextTriggeredFor === currentSrc) {
            hideAutoNextCountdown();
            return;
        }

        // Minimum playback guard
        if (!Number.isFinite(duration) || duration <= 0 || currentTime < 1) {
            return;
        }

        const timeLeft = duration - currentTime;

        // Show countdown when within 3 seconds of ending
        if (timeLeft <= 3 && timeLeft > 0.15) {
            showAutoNextCountdown(timeLeft);
        } else if (timeLeft > 3) {
            hideAutoNextCountdown();
        }

        // Trigger very close to the end (0.15s) to handle looping videos
        if (currentTime >= duration - 0.15) {
            hideAutoNextCountdown();
            video.dataset.fbToolkitAutoNextTriggeredFor = currentSrc;
            goToNextReel();
        }
    }

    function handleVideoSeeked(event) {
        if (!reelAutoNextEnabled) return;

        // During cooldown, ignore seek events entirely — they're likely from reel transitions
        if (Date.now() < reelAutoNextCooldownUntil) return;

        const video = event.target;
        const currentSrc = video.currentSrc || video.src;

        // Clear the trigger flag when user seeks - allows auto-next to work again
        // if user seeks to near the end
        if (video.dataset.fbToolkitAutoNextTriggeredFor === currentSrc) {
            delete video.dataset.fbToolkitAutoNextTriggeredFor;
        }

        // DON'T immediately re-check here — this was causing false skips during
        // reel transitions (seeked fires -> flag cleared -> video still at old position
        // -> checkVideoEndAndNavigate fires -> instant skip).
        // The interval and timeupdate handlers will pick it up naturally.
    }

    function handleVideoEnded(event) {
        if (!reelAutoNextEnabled) return;

        // Cooldown guard
        if (Date.now() < reelAutoNextCooldownUntil) return;

        const video = event?.target;
        if (video) {
            const currentSrc = video.currentSrc || video.src;
            if (video.dataset.fbToolkitAutoNextTriggeredFor === currentSrc) {
                return;
            }
            video.dataset.fbToolkitAutoNextTriggeredFor = currentSrc;
        }

        goToNextReel();
    }

    function goToNextReel() {
        // Cooldown guard: auto-next callers are throttled.
        // Manual navigation (nav buttons) goes through navigateReel() directly.
        if (Date.now() < reelAutoNextCooldownUntil) return;

        // Set cooldown
        reelAutoNextCooldownUntil = Date.now() + REEL_AUTO_NEXT_COOLDOWN_MS;

        // Clear the trigger flag from the current video
        if (reelAutoNextVideoRef) {
            delete reelAutoNextVideoRef.dataset.fbToolkitAutoNextTriggeredFor;
        }

        // Visual feedback for auto-next
        const autoNextBtn = document.querySelector(`#${REEL_CONTROL_PANEL_ID} button[data-fb-toolkit-action="auto-next"]`);
        if (autoNextBtn) {
            autoNextBtn.classList.remove('triggered');
            void autoNextBtn.offsetWidth;
            autoNextBtn.classList.add('triggered');
            setTimeout(() => autoNextBtn.classList.remove('triggered'), 1000);
        }

        navigateReel('next');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // AUTO-NEXT COUNTDOWN
    // ══════════════════════════════════════════════════════════════════════════

    const AUTO_NEXT_ICON_HTML = `<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>`;

    function showAutoNextCountdown(timeLeft) {
        const autoNextBtn = document.querySelector(`#${REEL_CONTROL_PANEL_ID} button[data-fb-toolkit-action="auto-next"]`);
        if (!autoNextBtn) return;

        reelCountdownActive = true;

        const radius = 10;
        const circumference = 2 * Math.PI * radius;
        const progress = timeLeft / 3;
        const dashOffset = circumference * (1 - progress);

        let container = autoNextBtn.querySelector('.countdown-inline');
        if (!container) {
            // Replace the icon with countdown
            autoNextBtn.innerHTML = `
                <div class="countdown-inline">
                    <svg viewBox="0 0 24 24">
                        <circle class="cd-bg" cx="12" cy="12" r="${radius}"/>
                        <circle class="cd-ring" cx="12" cy="12" r="${radius}"
                            stroke-dasharray="${circumference}"
                            stroke-dashoffset="0"/>
                    </svg>
                    <span class="cd-num"></span>
                </div>
            `;
            container = autoNextBtn.querySelector('.countdown-inline');
        }

        const ring = container.querySelector('.cd-ring');
        if (ring) ring.setAttribute('stroke-dashoffset', String(dashOffset));

        const num = container.querySelector('.cd-num');
        if (num) num.textContent = Math.ceil(timeLeft);
    }

    function hideAutoNextCountdown() {
        if (!reelCountdownActive) return;
        reelCountdownActive = false;

        const autoNextBtn = document.querySelector(`#${REEL_CONTROL_PANEL_ID} button[data-fb-toolkit-action="auto-next"]`);
        if (autoNextBtn && autoNextBtn.querySelector('.countdown-inline')) {
            autoNextBtn.innerHTML = AUTO_NEXT_ICON_HTML;
        }
    }

    /**
     * Navigate to next or previous reel using multiple strategies for reliability.
     * @param {'next'|'prev'} direction
     */
    function navigateReel(direction) {
        const isNext = direction === 'next';
        const scrollAmount = isNext ? window.innerHeight : -window.innerHeight;

        // Find the scroll-snap container that wraps the reels.
        // Walk up from the current video element to find the scrollable parent.
        const video = reelAutoNextVideoRef || getPrimaryReelVideo();
        if (video) {
            let el = video.parentElement;
            while (el && el !== document.body && el !== document.documentElement) {
                const style = window.getComputedStyle(el);
                const overflowY = style.overflowY;
                const isScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay');
                // Check if this is the reel scroll container (scrollable + taller content)
                if (isScrollable && el.scrollHeight > el.clientHeight + 10) {
                    el.scrollBy({ top: scrollAmount, behavior: 'smooth' });
                    return;
                }
                el = el.parentElement;
            }
        }

        // Fallback: try common reel container selectors
        const containers = document.querySelectorAll('[data-pagelet*="Reel"], [role="main"]');
        for (const container of containers) {
            const style = window.getComputedStyle(container);
            const overflowY = style.overflowY;
            if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') 
                && container.scrollHeight > container.clientHeight + 10) {
                container.scrollBy({ top: scrollAmount, behavior: 'smooth' });
                return;
            }
        }

        // Fallback: try scrolling the document/body/html
        const docEl = document.documentElement;
        const body = document.body;
        if (docEl.scrollHeight > docEl.clientHeight + 10) {
            docEl.scrollBy({ top: scrollAmount, behavior: 'smooth' });
            return;
        }
        if (body.scrollHeight > body.clientHeight + 10) {
            body.scrollBy({ top: scrollAmount, behavior: 'smooth' });
            return;
        }

        // Last resort: dispatch a wheel event on the video or its container
        const target = video || document.querySelector('[data-pagelet*="Reel"]') || document.body;
        const wheelEvent = new WheelEvent('wheel', {
            deltaY: isNext ? 300 : -300,
            deltaMode: 0,
            bubbles: true,
            cancelable: true,
            view: window
        });
        target.dispatchEvent(wheelEvent);
    }

    function goToPreviousReel() {
        // Set cooldown (prevents auto-next from firing after manual nav)
        reelAutoNextCooldownUntil = Date.now() + REEL_AUTO_NEXT_COOLDOWN_MS;

        // Clear the trigger flag
        if (reelAutoNextVideoRef) {
            delete reelAutoNextVideoRef.dataset.fbToolkitAutoNextTriggeredFor;
        }

        navigateReel('prev');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // IMMERSIVE MODE — Blurred video background
    // ══════════════════════════════════════════════════════════════════════════

    function startImmersiveBackground() {
        stopImmersiveBackground(); // Clean up any existing

        // Add soft edge vignette to the video container so it blends with the background
        applyVideoEdgeBlend(true);

        // Create the fixed background container
        const bgDiv = document.createElement('div');
        bgDiv.id = REEL_IMMERSIVE_BG_ID;
        bgDiv.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            overflow: hidden;
            pointer-events: none;
        `;

        const canvas = document.createElement('canvas');
        canvas.style.cssText = `
            position: absolute;
            top: 50%; left: 50%;
            min-width: 110%; min-height: 110%;
            transform: translate(-50%, -50%) scale(1.2);
            filter: blur(20px) brightness(0.6) saturate(1.4);
            object-fit: cover;
        `;

        bgDiv.appendChild(canvas);

        /**
         * Find the best container for the immersive bg.
         * On SPA navigation, Facebook opens reels in a dialog/overlay with its own
         * stacking context. We must insert INSIDE that overlay so our bg is visible.
         * On direct page load (/reel/), there's no overlay — body works fine.
         */
        function findReelOverlay() {
            // Strategy 1: Look for a dialog element or role="dialog"
            const dialogs = document.querySelectorAll('div[role="dialog"], dialog');
            for (const dialog of dialogs) {
                if (dialog.querySelector('video')) {
                    return dialog;
                }
            }
            // Strategy 2: Look for a high z-index fixed container that contains a video
            const videos = document.querySelectorAll('video');
            for (const video of videos) {
                let el = video.parentElement;
                while (el && el !== document.body) {
                    const style = window.getComputedStyle(el);
                    const zIndex = parseInt(style.zIndex, 10);
                    if (style.position === 'fixed' && zIndex > 100) {
                        return el;
                    }
                    el = el.parentElement;
                }
            }
            return null;
        }

        let placed = false;
        function placeBackground() {
            const existing = document.getElementById(REEL_IMMERSIVE_BG_ID);
            if (!existing) return false; // was removed

            const overlay = findReelOverlay();
            if (overlay) {
                bgDiv.style.zIndex = '0';
                if (existing.parentElement !== overlay) {
                    overlay.insertBefore(bgDiv, overlay.firstChild);
                }
                // Elevate all other direct children of the overlay above the bg
                Array.from(overlay.children).forEach(child => {
                    if (child !== bgDiv && child.id !== REEL_IMMERSIVE_BG_ID) {
                        const cs = window.getComputedStyle(child);
                        // Only set if not already positioned with a z-index
                        if (!child.dataset.fbToolkitImmersiveElevated) {
                            if (cs.position === 'static') {
                                child.style.setProperty('position', 'relative', 'important');
                            }
                            child.style.setProperty('z-index', '1', 'important');
                            child.dataset.fbToolkitImmersiveElevated = 'true';
                        }
                    }
                });
                placed = true;
                return true;
            } else {
                // Fallback: insert in body with z-index 0 (body children naturally stack above)
                bgDiv.style.zIndex = '0';
                if (!existing.parentElement || existing.parentElement === document.body) {
                    document.body.insertBefore(bgDiv, document.body.firstChild);
                }
                return false;
            }
        }

        // Initial placement
        document.body.insertBefore(bgDiv, document.body.firstChild);
        placeBackground();

        // Draw frames at ~15fps (every 66ms)
        const ctx = canvas.getContext('2d');
        let lastVideoSrc = '';

        reelImmersiveIntervalId = setInterval(() => {
            if (!reelImmersiveEnabled) {
                stopImmersiveBackground();
                return;
            }

            // Re-attempt overlay placement if not yet found
            if (!placed) {
                placeBackground();
            }

            const video = reelAutoNextVideoRef || getPrimaryReelVideo();
            if (!video) return;

            // Only draw when video has enough data
            if (video.readyState < 2) return;

            // Update canvas dimensions if video source changed
            const currentSrc = video.currentSrc || video.src || '';
            if (currentSrc !== lastVideoSrc) {
                lastVideoSrc = currentSrc;
                canvas.width = video.videoWidth || 640;
                canvas.height = video.videoHeight || 360;
            }

            try {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            } catch (e) {
                // Cross-origin video — can't draw
            }
        }, 66);
    }

    function stopImmersiveBackground() {
        const existing = document.getElementById(REEL_IMMERSIVE_BG_ID);
        if (existing) existing.remove();
        if (reelImmersiveIntervalId) {
            clearInterval(reelImmersiveIntervalId);
            reelImmersiveIntervalId = null;
        }
        // Clean up elevated overlay children
        document.querySelectorAll('[data-fb-toolkit-immersive-elevated]').forEach(el => {
            el.style.removeProperty('position');
            el.style.removeProperty('z-index');
            delete el.dataset.fbToolkitImmersiveElevated;
        });
        applyVideoEdgeBlend(false);
    }

    /**
     * Add/remove a soft outer glow on the video container
     * so its edges blend smoothly into the blurred immersive background.
     */
    function applyVideoEdgeBlend(enable) {
        const video = reelAutoNextVideoRef || getPrimaryReelVideo();
        if (!video) return;

        // Find the closest sized container that wraps the video
        let container = video.parentElement;
        while (container && container !== document.body) {
            const rect = container.getBoundingClientRect();
            // Look for a container that's roughly video-sized (not full-screen)
            if (rect.width > 100 && rect.height > 200 && rect.width < window.innerWidth * 0.95) {
                break;
            }
            container = container.parentElement;
        }
        if (!container || container === document.body) container = video;

        if (enable) {
            // Soft outer glow that fades the video edges into the blurred background
            container.style.setProperty('box-shadow',
                '0 0 80px 30px rgba(0,0,0,0.7), 0 0 150px 60px rgba(0,0,0,0.4)',
                'important');
            // Ensure the video container stacks above the immersive bg
            container.style.setProperty('position', 'relative', 'important');
            container.style.setProperty('z-index', '2', 'important');
            container.dataset.fbToolkitImmersiveEdge = 'true';
        } else {
            // Clean up all elements with the edge blend
            document.querySelectorAll('[data-fb-toolkit-immersive-edge]').forEach(el => {
                el.style.removeProperty('box-shadow');
                el.style.removeProperty('z-index');
                el.style.removeProperty('position');
                delete el.dataset.fbToolkitImmersiveEdge;
            });
        }
    }

    function handleReelSpeedChange(event) {
        const select = event.target;
        if (!select || select.dataset.fbToolkitAction !== 'speed') {
            return;
        }

        const selectedSpeed = normalizeReelSpeed(select.value);
        const reelVideos = getReelVideos();
        reelVideos.forEach((video) => {
            const sourceKey = video.currentSrc || video.src || video.getAttribute('src') || 'sourceless';
            setVideoPlaybackSpeed(video, selectedSpeed, sourceKey);
        });
    }

    function createReelControlPanel() {
        const panel = document.createElement('div');
        panel.id = REEL_CONTROL_PANEL_ID;

        // SVG Icons for minimal design
        const icons = {
            chevronUp: `<svg viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>`,
            chevronDown: `<svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>`,
            restart: `<svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>`,
            rewind: `<svg viewBox="0 0 24 24"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>`,
            forward: `<svg viewBox="0 0 24 24"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>`,
            autoNext: `<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>`,
            immersive: `<svg viewBox="0 0 24 24"><path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5z"/></svg>`
        };

        panel.innerHTML = `
            <button type="button" data-fb-toolkit-action="nav-prev" data-tooltip="Previous">
                ${icons.chevronUp}
            </button>
            <button type="button" data-fb-toolkit-action="nav-next" data-tooltip="Next">
                ${icons.chevronDown}
            </button>
            <div class="reel-divider"></div>
            <button type="button" data-fb-toolkit-action="auto-next" data-tooltip="Auto-Next">
                ${icons.autoNext}
            </button>
            <div class="reel-divider"></div>
            <button type="button" data-fb-toolkit-action="immersive" data-tooltip="Immersive">
                ${icons.immersive}
            </button>
            <div class="reel-divider"></div>
            <button type="button" data-fb-toolkit-action="restart" data-tooltip="Restart">
                ${icons.restart}
            </button>
            <button type="button" data-fb-toolkit-action="rewind-10" data-tooltip="Rewind 10s">
                ${icons.rewind}
            </button>
            <button type="button" data-fb-toolkit-action="forward-10" data-tooltip="Forward 10s">
                ${icons.forward}
            </button>
            <div class="reel-divider"></div>
            <select data-fb-toolkit-action="speed" data-tooltip="Speed" aria-label="Playback speed">
                <option value="0.5">0.5×</option>
                <option value="0.75">0.75×</option>
                <option value="1" selected>1×</option>
                <option value="1.25">1.25×</option>
                <option value="1.5">1.5×</option>
                <option value="1.75">1.75×</option>
                <option value="2">2×</option>
            </select>
            <div class="reel-divider"></div>
            <div class="reel-counter" title="Reels watched - Click to reset counter">${reelWatchCount}</div>
        `;

        // Use mousedown for more reliable detection - shows context menu
        const counterEl = panel.querySelector('.reel-counter');
        if (counterEl) {
            counterEl.onmousedown = function (e) {
                e.preventDefault();
                e.stopPropagation();
                showCounterMenu(counterEl);
                return false;
            };
        }

        panel.addEventListener('click', (e) => {
            e.stopPropagation();
            handleReelControlClick(e);
        });
        panel.addEventListener('change', handleReelSpeedChange);
        document.documentElement.appendChild(panel);
        return panel;
    }

    function positionReelControlPanel(panel, targetVideo) {
        if (!panel || !targetVideo || typeof targetVideo.getBoundingClientRect !== 'function') {
            return;
        }

        const rawVideoRect = targetVideo.getBoundingClientRect();
        if (rawVideoRect.width <= 0 || rawVideoRect.height <= 0) {
            return;
        }

        const videoRect = (() => {
            const intrinsicWidth = Number(targetVideo.videoWidth) || 0;
            const intrinsicHeight = Number(targetVideo.videoHeight) || 0;
            if (intrinsicWidth <= 0 || intrinsicHeight <= 0) {
                return rawVideoRect;
            }

            const computedStyle = window.getComputedStyle(targetVideo);
            const objectFit = String(computedStyle.objectFit || 'fill').toLowerCase();
            if (objectFit !== 'contain' && objectFit !== '') {
                return rawVideoRect;
            }

            const containerAspect = rawVideoRect.width / rawVideoRect.height;
            const videoAspect = intrinsicWidth / intrinsicHeight;

            if (containerAspect > videoAspect) {
                const renderedWidth = rawVideoRect.height * videoAspect;
                const left = rawVideoRect.left + (rawVideoRect.width - renderedWidth) / 2;
                return {
                    left,
                    right: left + renderedWidth,
                    top: rawVideoRect.top,
                    bottom: rawVideoRect.bottom,
                    width: renderedWidth,
                    height: rawVideoRect.height
                };
            }

            const renderedHeight = rawVideoRect.width / videoAspect;
            const top = rawVideoRect.top + (rawVideoRect.height - renderedHeight) / 2;
            return {
                left: rawVideoRect.left,
                right: rawVideoRect.right,
                top,
                bottom: top + renderedHeight,
                width: rawVideoRect.width,
                height: renderedHeight
            };
        })();

        const panelRect = panel.getBoundingClientRect();
        const playerContainer = getVideoPlayerContainer(targetVideo);
        const playerRect = playerContainer?.getBoundingClientRect?.() || null;
        const anchorRect =
            playerRect && playerRect.width > 0 && playerRect.height > 0
                ? playerRect
                : videoRect;

        const gap = 8; // Gap between controls and video edge
        const edgePadding = 8;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

        // Position controls OUTSIDE the video, on the left side, aligned to bottom
        let left = videoRect.left - panelRect.width - gap;
        let top = videoRect.bottom - panelRect.height;

        // If not enough space on the left, fall back to edge padding
        if (left < edgePadding) {
            left = edgePadding;
        }

        // Vertical clamps
        if (top < edgePadding) {
            top = edgePadding;
        }
        if (top + panelRect.height > viewportHeight - edgePadding) {
            top = Math.max(edgePadding, viewportHeight - panelRect.height - edgePadding);
        }

        panel.style.left = `${Math.round(left)}px`;
        panel.style.top = `${Math.round(top)}px`;
    }

    function ensureReelControlPanel(controlsEnabled, reelVideos, preferredSpeed) {
        // Only show controls on /reel/ pages
        const isReelPage = window.location.pathname.startsWith('/reel/');

        if (!controlsEnabled || !isReelPage) {
            removeReelControlPanel();
            stopImmersiveBackground();
            return;
        }

        // Track this reel view
        trackReelView();

        const videos = Array.isArray(reelVideos) ? reelVideos : getReelVideos();
        let panel = document.getElementById(REEL_CONTROL_PANEL_ID);

        if (!panel) {
            panel = createReelControlPanel();
        }

        if (!videos.length) {
            panel.style.display = 'none';
            // Still start immersive — the canvas interval handles missing videos gracefully
            if (reelImmersiveEnabled && !document.getElementById(REEL_IMMERSIVE_BG_ID)) {
                startImmersiveBackground();
            }
            return;
        }

        panel.style.display = 'flex';

        // Update counter display
        updateReelCounterDisplay();

        const speedSelect = panel.querySelector('select[data-fb-toolkit-action="speed"]');
        if (!speedSelect) {
            return;
        }

        const primaryVideo = getPrimaryReelVideo(videos);
        if (primaryVideo) {
            positionReelControlPanel(panel, primaryVideo);

            // Sync auto-next button state and set up listener
            const autoNextButton = panel.querySelector('button[data-fb-toolkit-action="auto-next"]');
            if (autoNextButton) {
                updateAutoNextButtonState(autoNextButton, reelAutoNextEnabled);
            }

            // Sync immersive button state
            const immersiveButton = panel.querySelector('button[data-fb-toolkit-action="immersive"]');
            if (immersiveButton) {
                immersiveButton.classList.toggle('active', reelImmersiveEnabled);
                immersiveButton.dataset.tooltip = reelImmersiveEnabled ? 'Immersive: ON' : 'Immersive';
            }

            if (reelAutoNextEnabled) {
                setupAutoNextListener(primaryVideo);
            }
        }

        // Start immersive if enabled (only if not already running)
        if (reelImmersiveEnabled && !document.getElementById(REEL_IMMERSIVE_BG_ID)) {
            startImmersiveBackground();
        }
        const displaySpeed = normalizeReelSpeed(primaryVideo?.playbackRate || preferredSpeed || 1);
        speedSelect.value = String(displaySpeed);
    }

    function applyReelVideoPreferences() {
        const settings = getHomepageSettings();
        const startMutedEnabled = Boolean(settings.REELS_START_MUTED?.enable);
        const defaultSpeedEnabled = Boolean(settings.REELS_DEFAULT_SPEED?.enable);
        const defaultSpeed = normalizeReelSpeed(settings.REELS_DEFAULT_SPEED?.speed || 1);
        const controlsEnabled = Boolean(settings.REELS_VIDEO_CONTROLS?.enable);

        // Initialize auto-next from saved settings
        reelAutoNextEnabled = Boolean(settings.REELS_AUTO_NEXT?.enable);

        // Default immersive to ON for new users (only false if explicitly disabled)
        reelImmersiveEnabled = settings.REELS_IMMERSIVE?.enable !== undefined
            ? Boolean(settings.REELS_IMMERSIVE.enable)
            : true;

        // Initialize watch count from saved settings (only once to avoid overwriting local changes)
        if (!reelWatchCountInitialized) {
            reelWatchCount = Number(settings.REELS_WATCH_COUNT?.count) || 0;
            reelWatchCountInitialized = true;
        }

        // Track this reel view if on a reel page
        if (controlsEnabled) {
            trackReelView();

            // Auto-skip sponsored reels
            checkAndSkipSponsoredReelWithRetry();
        }

        if (!startMutedEnabled) {
            document.querySelectorAll('video[data-fb-toolkit-reel-muted-for]').forEach((videoNode) => {
                delete videoNode.dataset.fbToolkitReelMutedFor;
            });
        }

        if (!defaultSpeedEnabled) {
            document.querySelectorAll('video[data-fb-toolkit-reel-speed-for]').forEach((videoNode) => {
                delete videoNode.dataset.fbToolkitReelSpeedFor;
                delete videoNode.dataset.fbToolkitReelSpeedValue;
            });
        }

        const videos = getReelVideos();

        videos.forEach((video) => {
            if (startMutedEnabled) {
                muteReelVideoForCurrentSource(video);
            } else {
                // Unmute if the setting is disabled
                unmuteReelVideo(video);
            }

            if (defaultSpeedEnabled) {
                applyDefaultSpeedForCurrentSource(video, defaultSpeed);
            }
        });

        ensureReelControlPanel(controlsEnabled, videos, defaultSpeed);
    }

    function isAdPost(article, cardElement, text) {
        if (!article && !cardElement) {
            return false;
        }

        const root = cardElement || article;

        if (root.querySelector('a[href*="/ads/about/"], a[href*="facebook.com/ads/about/"]')) {
            return true;
        }

        if (root.querySelector('[data-ad-preview], [data-ad-comet-preview], [data-ad-rendering-role="story_message"]')) {
            return true;
        }

        return text.includes('sponsored');
    }

    function isSuggestionPost(text) {
        return SUGGESTION_MARKERS.some((marker) => text.includes(marker));
    }

    function isPeopleYouMayKnowPost(text) {
        return text.includes('people you may know');
    }

    function matchesKeyword(text, terms) {
        if (!terms.length) {
            return false;
        }
        return terms.some((term) => text.includes(term));
    }

    function setHiddenState(targetElement, className, shouldHide, trackerKey, analyticsKey) {
        if (!targetElement) {
            return;
        }

        if (shouldHide) {
            const wasHidden = targetElement.classList.contains(className);
            targetElement.classList.add(className);

            if (!wasHidden && !hiddenNodeTracker[trackerKey].has(targetElement)) {
                hiddenNodeTracker[trackerKey].add(targetElement);
                queueAnalyticsIncrement(analyticsKey);
            }
            return;
        }

        targetElement.classList.remove(className);
    }

    function applyContentFilters() {
        if (!isHomepageRoute()) {
            return;
        }

        const settings = getHomepageSettings();
        const hideAdsEnabled = Boolean(settings.HIDE_ADS?.enable);
        const hideSuggestionsEnabled = Boolean(settings.HIDE_SUGGESTIONS?.enable);
        const hidePeopleEnabled = Boolean(settings.HIDE_PEOPLE_YOU_MAY_KNOW?.enable);
        const keywordFilterEnabled = Boolean(settings.KEYWORD_FILTER?.enable);
        const keywordTerms = keywordFilterEnabled ? getKeywordTerms(settings.KEYWORD_FILTER) : [];

        const posts = getFeedArticles();
        posts.forEach((article) => {
            const cardElement = getPostCardElement(article);
            const text = getCardText(article, cardElement);

            const adMatch = hideAdsEnabled && isAdPost(article, cardElement, text);
            setHiddenState(cardElement, AD_HIDDEN_CLASS, adMatch, 'ads', 'hiddenAds');

            const suggestionMatch = !adMatch && hideSuggestionsEnabled && isSuggestionPost(text);
            setHiddenState(cardElement, SUGGESTION_HIDDEN_CLASS, suggestionMatch, 'suggestions', 'hiddenSuggestions');

            const peopleMatch = !adMatch && !suggestionMatch && hidePeopleEnabled && isPeopleYouMayKnowPost(text);
            setHiddenState(cardElement, PEOPLE_HIDDEN_CLASS, peopleMatch, 'people', 'hiddenPeople');

            const keywordMatch = !adMatch && !suggestionMatch && !peopleMatch && keywordFilterEnabled && matchesKeyword(text, keywordTerms);
            setHiddenState(cardElement, KEYWORD_HIDDEN_CLASS, keywordMatch, 'keywordPosts', 'hiddenKeywordPosts');
        });
    }

    function queueContentFilterRun() {
        if (contentFilterQueued) {
            return;
        }

        contentFilterQueued = true;
        requestAnimationFrame(() => {
            contentFilterQueued = false;
            applyContentFilters();
        });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MARKETPLACE AD FILTERING
    // ══════════════════════════════════════════════════════════════════════════

    let marketplaceFilterQueued = false;

    /**
     * Check if an element is a marketplace ad listing
     * Ads are identified by:
     * 1. Containing a "Sponsored" text badge
     * 2. External links with tracking parameters (utm_medium=paid)
     */
    function isMarketplaceAd(element) {
        if (!element) return false;

        // Check for "Sponsored" text
        const spans = element.querySelectorAll('span');
        for (const span of spans) {
            if (span.textContent === 'Sponsored') {
                return true;
            }
        }

        // Check for paid tracking links
        if (element.querySelector('a[href*="utm_medium=paid"]')) {
            return true;
        }

        // Check for Facebook redirect links with tracking (l.facebook.com/l.php)
        const fbRedirectLinks = element.querySelectorAll('a[href*="l.facebook.com/l.php"]');
        for (const link of fbRedirectLinks) {
            if (link.href && link.href.includes('utm_medium=paid')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get the marketplace listing container for a given element
     * The container is typically several levels up from the "Sponsored" badge
     */
    function getMarketplaceListingContainer(sponsoredSpan) {
        let current = sponsoredSpan;

        // Traverse up to find a suitable container
        // We want the outermost container that represents the listing but is still
        // within the grid/list structure
        for (let i = 0; i < 15; i++) {
            if (!current || !current.parentElement) break;
            current = current.parentElement;

            // Look for link-like containers that are direct children of grid items
            if (current.tagName === 'A' || current.getAttribute('role') === 'link') {
                // Go up one more to get the grid item container
                const parent = current.parentElement;
                if (parent) {
                    // Check if the parent looks like a grid item
                    const parentStyles = window.getComputedStyle(parent);
                    if (parentStyles.display === 'flex' || parentStyles.display === 'grid') {
                        return parent;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Apply marketplace ad filters - hides sponsored listings on marketplace pages
     */
    function applyMarketplaceAdFilters() {
        if (!isMarketplaceRoute()) {
            return;
        }

        const settings = getHomepageSettings();
        const hideAdsEnabled = Boolean(settings.HIDE_ADS?.enable);

        if (!hideAdsEnabled) {
            // Remove any previously hidden marketplace ads
            document.querySelectorAll('.' + MARKETPLACE_AD_HIDDEN_CLASS).forEach(el => {
                el.classList.remove(MARKETPLACE_AD_HIDDEN_CLASS);
            });
            return;
        }

        // Strategy 1: Find "Sponsored" spans and hide their parent container
        // The "Sponsored" badge is always visible on marketplace ads
        const allSpans = document.querySelectorAll('span');
        for (const span of allSpans) {
            if (span.textContent !== 'Sponsored') continue;

            // Traverse up to find a reasonable container
            // We look for a parent that is a direct child of a grid-like container
            let current = span;
            let container = null;

            for (let i = 0; i < 20; i++) {
                if (!current || !current.parentElement) break;
                current = current.parentElement;

                // Check if this element has siblings that look like marketplace items
                const parent = current.parentElement;
                if (parent) {
                    const siblings = Array.from(parent.children);
                    // If there are multiple siblings, and any sibling has a marketplace link,
                    // then `current` is likely a grid item
                    const hasMarketplaceLinks = siblings.some(sibling =>
                        sibling !== current &&
                        sibling.querySelector('a[href*="/marketplace/item/"]')
                    );

                    if (hasMarketplaceLinks && siblings.length > 1) {
                        container = current;
                        break;
                    }
                }
            }

            if (container && !container.classList.contains(MARKETPLACE_AD_HIDDEN_CLASS)) {
                container.classList.add(MARKETPLACE_AD_HIDDEN_CLASS);

                if (!hiddenNodeTracker.marketplaceAds.has(container)) {
                    hiddenNodeTracker.marketplaceAds.add(container);
                    queueAnalyticsIncrement('hiddenAds');
                }
            }
        }

        // Strategy 2: Find ads by the data-visualcompletion="ignore" attribute
        // This is used on ad images/videos
        const ignoreElements = document.querySelectorAll('div[data-visualcompletion="ignore"]');
        for (const el of ignoreElements) {
            // Skip if already inside a hidden container
            if (el.closest('.' + MARKETPLACE_AD_HIDDEN_CLASS)) continue;

            // Check if this element contains an img with external tracking
            const img = el.querySelector('img');
            if (!img) continue;

            // Check if the parent link goes to external sites (ads often do)
            const parentLink = el.closest('a');
            if (parentLink) {
                const href = parentLink.href || '';
                // Check for paid tracking or external redirects
                if (href.includes('utm_medium=paid') ||
                    href.includes('l.facebook.com/l.php') ||
                    (href.includes('utm_') && !href.includes('/marketplace/'))) {

                    // Find the grid item container
                    let container = el;
                    for (let i = 0; i < 15; i++) {
                        if (!container || !container.parentElement) break;
                        container = container.parentElement;

                        const parent = container.parentElement;
                        if (parent) {
                            const siblings = Array.from(parent.children);
                            const hasMarketplaceLinks = siblings.some(sibling =>
                                sibling !== container &&
                                sibling.querySelector('a[href*="/marketplace/item/"]')
                            );

                            if (hasMarketplaceLinks && siblings.length > 1) {
                                break;
                            }
                        }
                    }

                    if (container && container !== el && !container.classList.contains(MARKETPLACE_AD_HIDDEN_CLASS)) {
                        container.classList.add(MARKETPLACE_AD_HIDDEN_CLASS);

                        if (!hiddenNodeTracker.marketplaceAds.has(container)) {
                            hiddenNodeTracker.marketplaceAds.add(container);
                            queueAnalyticsIncrement('hiddenAds');
                        }
                    }
                }
            }
        }

        // Strategy 3: Directly target links with paid tracking parameters
        const trackingLinks = document.querySelectorAll('a[href*="utm_medium=paid"]');
        for (const link of trackingLinks) {
            // Skip if already inside a hidden container
            if (link.closest('.' + MARKETPLACE_AD_HIDDEN_CLASS)) continue;

            let container = link;
            for (let i = 0; i < 15; i++) {
                if (!container || !container.parentElement) break;
                container = container.parentElement;

                const parent = container.parentElement;
                if (parent) {
                    const siblings = Array.from(parent.children);
                    const hasMarketplaceLinks = siblings.some(sibling =>
                        sibling !== container &&
                        sibling.querySelector('a[href*="/marketplace/item/"]')
                    );

                    if (hasMarketplaceLinks && siblings.length > 1) {
                        break;
                    }
                }
            }

            if (container && container !== link && !container.classList.contains(MARKETPLACE_AD_HIDDEN_CLASS)) {
                container.classList.add(MARKETPLACE_AD_HIDDEN_CLASS);

                if (!hiddenNodeTracker.marketplaceAds.has(container)) {
                    hiddenNodeTracker.marketplaceAds.add(container);
                    queueAnalyticsIncrement('hiddenAds');
                }
            }
        }
    }

    function queueMarketplaceAdFilterRun() {
        if (marketplaceFilterQueued) {
            return;
        }

        marketplaceFilterQueued = true;
        requestAnimationFrame(() => {
            marketplaceFilterQueued = false;
            applyMarketplaceAdFilters();
        });
    }

    function queueReelVideoPreferenceRun() {
        if (reelPreferencesQueued) {
            return;
        }

        reelPreferencesQueued = true;
        requestAnimationFrame(() => {
            reelPreferencesQueued = false;
            applyReelVideoPreferences();
        });
    }

    /**
     * Apply sidebar visibility styles based on settings
     */
    function applyStyles() {
        const settings = getHomepageSettings();

        // Remove existing style element
        const existing = document.getElementById(STYLE_ID);
        if (existing) {
            existing.remove();
        }

        // Build CSS based on settings
        let css = HOMEPAGE_STYLES.baseHiddenStyles;

        // Disable layout controls on non-homepage pages to prevent breaking profile/page layouts
        // Layout controls should only affect the homepage feed
        const onPhotoPage = isPhotoRoute();
        const onMessagesPage = isMessagesRoute();
        const onHomepage = isHomepage();
        const onReelPage = isReelRoute();

        // Layout controls only apply to homepage feed
        const canApplyLayoutControls = onHomepage && !onPhotoPage && !onMessagesPage;

        // Always inject base transitions on hideable elements so both hide AND show animate smoothly
        if (canApplyLayoutControls) {
            css += `
                /* Base transitions for smooth layout animations (always active on homepage) */
                div[role="navigation"][class*="x9f619"]:has(ul),
                div[role="navigation"][aria-label="Facebook"], 
                div[role="navigation"][aria-label="Shortcuts"],
                div[data-pagelet="LeftRail"], 
                div[data-pagelet="LeftNav"] {
                    transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                                min-width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                                flex-basis 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                                padding 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                                margin 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                                opacity 0.3s ease,
                                transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
                }
                div[role="complementary"],
                div[data-pagelet="RightRail"] {
                    transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                                min-width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                                flex-basis 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                                padding 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                                margin 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                                opacity 0.3s ease,
                                transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
                }
                div:has(> span [aria-label="New message"][role="button"]) {
                    transition: opacity 0.3s ease, transform 0.3s ease;
                }
                div[role="banner"],
                div[data-pagelet="BlueBar"], 
                #pagelet_bluebar {
                    transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                                padding 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                                margin 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                                opacity 0.3s ease,
                                transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                }
                div[role="main"], 
                #content, 
                .x9f619.x1n2onr6.x1ja2u2z {
                    transition: margin-top 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                                padding-top 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                                top 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                }
                div[role="main"] [aria-label="Create a post"],
                div[role="main"] [aria-label="Stories"],
                div[role="main"] [aria-label="Reels"],
                div[role="main"] [aria-label="Reels and short videos"] {
                    transition: max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                                opacity 0.25s ease,
                                margin 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                                padding 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                                transform 0.3s ease;
                }
            `;
        }

        if (settings.HIDE_LEFT_SIDEBAR?.enable && canApplyLayoutControls) {
            css += HOMEPAGE_STYLES.hideLeftSidebar;
        }

        if (settings.HIDE_NAV_BAR?.enable && canApplyLayoutControls) {
            css += HOMEPAGE_STYLES.hideNavBar;
        }

        // Keep the right rail visible on Reels pages (comments), Photo pages, and Messages
        if (settings.HIDE_RIGHT_SIDEBAR?.enable && canApplyLayoutControls && !onReelPage) {
            css += HOMEPAGE_STYLES.hideRightSidebar;
        }

        if (settings.FULL_WIDTH_FEED?.enable && canApplyLayoutControls) {
            const feedWidth = settings.FEED_WIDTH?.width || 100;
            css += HOMEPAGE_STYLES.fullWidthFeed(feedWidth);
        }

        if (settings.HIDE_WHATS_ON_YOUR_MIND?.enable) {
            css += HOMEPAGE_STYLES.hideWhatsOnYourMind;
        }

        if (settings.HIDE_STORIES?.enable) {
            css += HOMEPAGE_STYLES.hideStories;
        }

        if (settings.HIDE_REELS?.enable) {
            css += HOMEPAGE_STYLES.hideReels;
        }

        if (settings.REELS_VIDEO_CONTROLS?.enable) {
            css += HOMEPAGE_STYLES.reelsControls;
        }

        // Always inject timeout modal styles (they're only shown when needed)
        css += HOMEPAGE_STYLES.reelsTimeoutModal;


        if (settings.HIDE_SUGGESTIONS?.enable) {
            css += HOMEPAGE_STYLES.hideSuggestions;
        }

        if (settings.HIDE_ADS?.enable) {
            css += HOMEPAGE_STYLES.hideAds;
        }

        if (settings.CUSTOM_FONT?.enable) {
            const family = settings.CUSTOM_FONT?.family || 'default';
            const size = settings.CUSTOM_FONT?.size || 100;
            css += HOMEPAGE_STYLES.customFont(family, size);
        }

        if (settings.COMPACT_MODE?.enable) {
            css += HOMEPAGE_STYLES.compactMode;
        }

        // Auto scroll controls (homepage only)
        if (settings.AUTO_SCROLL?.enable && onHomepage) {
            css += HOMEPAGE_STYLES.autoScrollControls;
        }

        // Apply Feed Background gradient or wallpaper (skip on marketplace pages)
        // If "Homepage Only" is enabled, also skip on any non-homepage pages
        const themeHomeOnly = settings.THEME_HOME_ONLY?.enable;
        const shouldApplyTheme = settings.FEED_BACKGROUND?.enable &&
            !isMarketplaceRoute() &&
            (!themeHomeOnly || isHomepage());

        if (shouldApplyTheme) {
            // Common styles to make containers transparent to see background
            css += `
                /* Make containers transparent to see background */
                div[role="main"],
                div[role="main"] > div,
                div[role="main"] > div > div,
                div[role="main"] > div > div > div,
                div[role="main"] div[role="feed"],
                div[role="main"] .x1hc1f62,
                div[role="main"] .x11t971q,
                div[role="main"] .x1iyjqo2,
                div[role="main"] .x1iyjqo2 > .x1iyjqo2 {
                    background-color: transparent !important;
                    background-image: none !important;
                }

                /* Glassmorphism for feed posts only - not nested comments */
                div[role="main"] div[role="feed"] > div > div > div[role="article"],
                div[role="main"] div[data-pagelet^="FeedUnit_"] > div > div[role="article"] {
                    position: relative !important;
                    z-index: 2 !important;
                    background: rgba(15, 23, 42, 0.6) !important;
                    backdrop-filter: blur(20px) saturate(180%) !important;
                    -webkit-backdrop-filter: blur(20px) saturate(180%) !important;
                    border: 1px solid rgba(255, 255, 255, 0.1) !important;
                    border-radius: 12px !important;
                    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3) !important;
                    margin-bottom: 20px !important;
                }
                
                /* Reset nested articles (comments, replies) */
                div[role="article"] div[role="article"] {
                    position: static !important;
                    z-index: auto !important;
                    background: transparent !important;
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                    border: none !important;
                    border-radius: 0 !important;
                    box-shadow: none !important;
                    margin-bottom: 0 !important;
                }
            `;

            const blurAmount = settings.WALLPAPER_BLUR_INTENSITY?.amount || 0;
            const zoomEnabled = settings.WALLPAPER_ZOOM?.enable;

            if (settings.FEED_BACKGROUND.wallpaper) {
                css += `
                    body {
                        background-color: #0f172a !important;
                    }
                    body::before {
                        content: "" !important;
                        position: fixed !important;
                        top: -5% !important;
                        left: -5% !important;
                        width: 110% !important;
                        height: 110% !important;
                        background-image: url('${settings.FEED_BACKGROUND.wallpaper}') !important;
                        background-size: cover !important;
                        background-position: center !important;
                        background-attachment: fixed !important;
                        background-repeat: no-repeat !important;
                        z-index: -1 !important;
                        ${blurAmount > 0 ? 'filter: blur(' + blurAmount + 'px) !important;' : ''}
                        ${zoomEnabled ? 'animation: slowZoom 60s ease-in-out infinite !important;' : ''}
                        transform: scale(1);
                        transition: filter 0.3s ease !important;
                    }

                    @keyframes slowZoom {
                        0% { transform: scale(1); }
                        50% { transform: scale(1.15); }
                        100% { transform: scale(1); }
                    }
                `;
            } else {
                const gradient = settings.FEED_BACKGROUND.gradient || 'cosmic';
                const gradientIntensity = settings.GRADIENT_INTENSITY?.amount || 100;

                // Gradient definitions
                const gradientDefs = {
                    cosmic: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
                    ocean: 'linear-gradient(135deg, #0c1d3d 0%, #1a3a5c 35%, #134e5e 70%, #0d2538 100%)',
                    sunset: 'linear-gradient(135deg, #1a0a1e 0%, #2d1b33 25%, #4a2040 50%, #2d1b33 75%, #1a0a1e 100%)',
                    aurora: 'linear-gradient(135deg, #0d1f1a 0%, #1a3d32 30%, #234d3e 50%, #1a3d32 70%, #0d1f1a 100%)',
                    midnight: 'linear-gradient(135deg, #020111 0%, #0a0520 35%, #16082a 70%, #0a0318 100%)',
                    forest: 'linear-gradient(135deg, #0a1510 0%, #152620 35%, #1c3328 70%, #0d1a14 100%)',
                    rose: 'linear-gradient(135deg, #1a0a0f 0%, #2a1520 35%, #351a28 70%, #1a0a12 100%)',
                    dark: 'linear-gradient(135deg, #0a0a0a 0%, #101012 35%, #151518 70%, #0a0a0c 100%)',
                    cloud: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 35%, #dee2e6 70%, #f1f3f5 100%)',
                    sky: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 35%, #bae6fd 70%, #e8f4fd 100%)',
                    mint: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 35%, #bbf7d0 70%, #e8fbee 100%)',
                    lavender: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 35%, #e9d5ff 70%, #f5edff 100%)',
                    lemon: 'linear-gradient(135deg, #fefce8 0%, #fef9c3 35%, #fef08a 70%, #fefadc 100%)',
                    sakura: 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 35%, #fecdd3 70%, #fff5f5 100%)',
                    ivory: 'linear-gradient(135deg, #fafaf9 0%, #f5f5f4 35%, #e7e5e4 70%, #fcfcfb 100%)'
                };

                const gradientValue = gradientDefs[gradient] || gradientDefs.cosmic;
                const isLightTheme = ['cloud', 'sky', 'mint', 'lavender', 'lemon', 'sakura', 'ivory'].includes(gradient);

                // Calculate saturation from intensity (100% = full color, 20% = desaturated)
                const saturation = gradientIntensity / 100;

                css += `
                    body {
                        background: ${gradientValue} !important;
                        background-attachment: fixed !important;
                    }
                    body::after {
                        content: "" !important;
                        position: fixed !important;
                        top: 0 !important;
                        left: 0 !important;
                        width: 100% !important;
                        height: 100% !important;
                        background: ${isLightTheme ? 'rgba(255,255,255,' : 'rgba(0,0,0,'}${1 - saturation}) !important;
                        pointer-events: none !important;
                        z-index: -1 !important;
                    }
                `;

                // For light themes, adjust post card styling
                if (isLightTheme) {
                    css += `
                        div[role="main"] div[role="feed"] > div > div > div[role="article"],
                        div[role="main"] div[data-pagelet^="FeedUnit_"] > div > div[role="article"] {
                            background: rgba(255, 255, 255, 0.85) !important;
                            color: #1c1e21 !important;
                            border: 1px solid rgba(0, 0, 0, 0.08) !important;
                            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08) !important;
                        }
                        div[role="main"] div[role="feed"] > div > div > div[role="article"] *,
                        div[role="main"] div[data-pagelet^="FeedUnit_"] > div > div[role="article"] * {
                            color: inherit !important;
                        }
                    `;
                }
            }
        }

        // Apply Card Borders last so they are not overridden by feed background styles (skip on marketplace)
        if (settings.CARD_BORDERS?.enable && !isMarketplaceRoute()) {
            const border = settings.CARD_BORDERS.border || 'glow';
            if (HOMEPAGE_STYLES.cardBorders[border]) {
                css += HOMEPAGE_STYLES.cardBorders[border];
            }
        }

        // Animated Particles Overlay (skip on marketplace pages)
        const onMarketplacePage = isMarketplaceRoute();
        const particlePattern = settings.PARTICLE_PATTERN?.pattern || 'none';
        const existingParticles = document.getElementById('fb-toolkit-particles');

        if (particlePattern !== 'none' && !onMarketplacePage) {
            const blurEnabled = settings.WALLPAPER_BLUR?.enable;
            const blurAmount = settings.WALLPAPER_BLUR_INTENSITY?.amount || 0;

            css += `
                #fb-toolkit-particles {
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    pointer-events: none !important;
                    z-index: 1 !important;
                    ${blurEnabled ? 'filter: blur(' + Math.min(blurAmount, 8) + 'px) !important;' : ''}
                }
            `;

            // Remove existing canvas if pattern or speed changed
            const currentPattern = existingParticles?.dataset.pattern;
            const currentSpeed = existingParticles?.dataset.speed;
            const newSpeed = String(settings.PARTICLE_SPEED?.speed || 1);

            if (existingParticles && (currentPattern !== particlePattern || currentSpeed !== newSpeed)) {
                existingParticles.remove();
            }

            if (!document.getElementById('fb-toolkit-particles')) {
                const canvas = document.createElement('canvas');
                canvas.id = 'fb-toolkit-particles';
                canvas.dataset.pattern = particlePattern;
                canvas.dataset.speed = newSpeed;
                document.body.insertBefore(canvas, document.body.firstChild);

                const ctx = canvas.getContext('2d');
                let particles = [];

                function resizeCanvas() {
                    canvas.width = window.innerWidth;
                    canvas.height = window.innerHeight;
                }
                resizeCanvas();
                window.addEventListener('resize', resizeCanvas);

                // Pattern-specific particle configs
                // Speed multiplier from user settings (default 1x)
                const speedMultiplier = settings.PARTICLE_SPEED?.speed || 1;

                const configs = {
                    bubbles: { count: 40, sizeMin: 3, sizeMax: 12, speed: 0.3 * speedMultiplier, hueMin: 200, hueMax: 260, opacityMin: 0.1, opacityMax: 0.4 },
                    stars: { count: 120, sizeMin: 0.5, sizeMax: 2.5, speed: 0.05 * speedMultiplier, hueMin: 200, hueMax: 280, opacityMin: 0.1, opacityMax: 0.9 },
                    snow: { count: 80, sizeMin: 2, sizeMax: 5, speed: 1.2 * speedMultiplier, hueMin: 0, hueMax: 0, opacityMin: 0.4, opacityMax: 0.8 },
                    rain: { count: 120, sizeMin: 1, sizeMax: 2, lengthMin: 15, lengthMax: 30, speed: 8 * speedMultiplier, hueMin: 200, hueMax: 220, opacityMin: 0.3, opacityMax: 0.6 },
                    fireflies: { count: 30, sizeMin: 2, sizeMax: 4, speed: 0.5 * speedMultiplier, hueMin: 50, hueMax: 70, opacityMin: 0.2, opacityMax: 0.8 }
                };
                const config = configs[particlePattern] || configs.bubbles;

                class Particle {
                    constructor() { this.reset(true); }
                    reset(initial) {
                        this.size = Math.random() * (config.sizeMax - config.sizeMin) + config.sizeMin;
                        this.opacity = Math.random() * (config.opacityMax - config.opacityMin) + config.opacityMin;
                        this.hue = Math.random() * (config.hueMax - config.hueMin) + config.hueMin;

                        if (particlePattern === 'stars') {
                            this.x = Math.random() * canvas.width;
                            this.y = Math.random() * canvas.height;
                            // Very subtle drift for stars
                            this.speedX = (Math.random() - 0.5) * config.speed;
                            this.speedY = (Math.random() - 0.5) * config.speed;
                            // Twinkle params
                            this.pulseSpeed = Math.random() * 0.05 + 0.005;
                            this.pulsePhase = Math.random() * Math.PI * 2;
                        } else if (particlePattern === 'snow') {
                            this.x = Math.random() * canvas.width;
                            this.y = initial ? Math.random() * canvas.height : -this.size;
                            this.speedX = (Math.random() - 0.5) * config.speed * 0.5;
                            this.speedY = Math.random() * config.speed + 0.5;
                        } else if (particlePattern === 'rain') {
                            this.x = Math.random() * canvas.width;
                            this.y = initial ? Math.random() * canvas.height : -config.lengthMax;
                            this.length = Math.random() * (config.lengthMax - config.lengthMin) + config.lengthMin;
                            this.speedX = (Math.random() - 0.3) * 1.5; // Slight wind drift
                            this.speedY = Math.random() * config.speed * 0.5 + config.speed;
                        } else if (particlePattern === 'fireflies') {
                            this.x = Math.random() * canvas.width;
                            this.y = Math.random() * canvas.height;
                            this.speedX = (Math.random() - 0.5) * config.speed;
                            this.speedY = (Math.random() - 0.5) * config.speed;
                            this.pulseSpeed = Math.random() * 0.02 + 0.01;
                            this.pulsePhase = Math.random() * Math.PI * 2;
                        } else {
                            this.x = Math.random() * canvas.width;
                            this.y = Math.random() * canvas.height;
                            this.speedX = (Math.random() - 0.5) * config.speed;
                            this.speedY = (Math.random() - 0.5) * config.speed;
                        }
                    }
                    update() {
                        this.x += this.speedX;
                        this.y += this.speedY;

                        if (particlePattern === 'stars') {
                            // Wrap around for stars
                            if (this.x < -10) this.x = canvas.width + 10;
                            if (this.x > canvas.width + 10) this.x = -10;
                            if (this.y < -10) this.y = canvas.height + 10;
                            if (this.y > canvas.height + 10) this.y = -10;

                            // Twinkle effect
                            this.pulsePhase += this.pulseSpeed;
                            this.opacity = (Math.sin(this.pulsePhase) + 1) / 2 * (config.opacityMax - config.opacityMin) + config.opacityMin;
                        } else if (particlePattern === 'snow') {
                            if (this.y > canvas.height + this.size) this.reset(false);
                            if (this.x < -this.size) this.x = canvas.width + this.size;
                            if (this.x > canvas.width + this.size) this.x = -this.size;
                        } else if (particlePattern === 'rain') {
                            if (this.y > canvas.height + this.length) this.reset(false);
                            if (this.x < -10) this.x = canvas.width + 10;
                            if (this.x > canvas.width + 10) this.x = -10;
                        } else if (particlePattern === 'fireflies') {
                            this.pulsePhase += this.pulseSpeed;
                            this.opacity = (Math.sin(this.pulsePhase) + 1) / 2 * (config.opacityMax - config.opacityMin) + config.opacityMin;
                            if (this.x < 0 || this.x > canvas.width) this.speedX *= -1;
                            if (this.y < 0 || this.y > canvas.height) this.speedY *= -1;
                        } else {
                            if (this.x < 0 || this.x > canvas.width) this.speedX *= -1;
                            if (this.y < 0 || this.y > canvas.height) this.speedY *= -1;
                        }
                    }
                    draw() {
                        ctx.beginPath();
                        if (particlePattern === 'stars') {
                            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                            // Subtle glow for stars
                            ctx.shadowBlur = this.size * 2;
                            ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
                            ctx.fillStyle = 'hsla(' + this.hue + ', 60%, 90%, ' + this.opacity + ')';
                            ctx.fill();
                            ctx.shadowBlur = 0;
                        } else if (particlePattern === 'snow') {
                            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                            ctx.fillStyle = 'rgba(255, 255, 255, ' + this.opacity + ')';
                            ctx.fill();
                        } else if (particlePattern === 'rain') {
                            // Draw rain as elongated streaks
                            ctx.moveTo(this.x, this.y);
                            ctx.lineTo(this.x + this.speedX * 0.5, this.y + this.length);
                            ctx.strokeStyle = 'hsla(' + this.hue + ', 40%, 70%, ' + this.opacity + ')';
                            ctx.lineWidth = this.size;
                            ctx.lineCap = 'round';
                            ctx.stroke();
                        } else if (particlePattern === 'fireflies') {
                            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                            const glow = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size * 3);
                            glow.addColorStop(0, 'hsla(' + this.hue + ', 100%, 70%, ' + this.opacity + ')');
                            glow.addColorStop(1, 'hsla(' + this.hue + ', 100%, 50%, 0)');
                            ctx.fillStyle = glow;
                            ctx.arc(this.x, this.y, this.size * 3, 0, Math.PI * 2);
                            ctx.fill();
                        } else {
                            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                            ctx.fillStyle = 'hsla(' + this.hue + ', 70%, 60%, ' + this.opacity + ')';
                            ctx.fill();
                        }
                    }
                }

                // Shooting Star Class
                class ShootingStar {
                    constructor() {
                        this.reset();
                        this.waitTime = new Date().getTime() + Math.random() * 2000;
                    }
                    reset() {
                        this.x = Math.random() * canvas.width * 1.5 - canvas.width * 0.25;
                        this.y = Math.random() * (canvas.height * 0.3); // Top 30%
                        this.len = Math.random() * 100 + 50;
                        this.speed = Math.random() * 15 + 10;
                        this.size = Math.random() * 2 + 0.5;
                        this.active = false;

                        // Angle: always shooting down/diagonal left or right
                        const dir = Math.random() > 0.5 ? 1 : -1;
                        const angle = Math.PI / 2 + (Math.PI / 4) * dir + (Math.random() - 0.5) * 0.5;

                        // Force mostly left-to-right or right-to-left downward
                        this.speedX = Math.cos(angle) * this.speed;
                        this.speedY = Math.abs(Math.sin(angle) * this.speed); // Always down
                    }
                    update() {
                        if (this.active) {
                            this.x += this.speedX;
                            this.y += this.speedY;
                            if (this.x < -this.len || this.x > canvas.width + this.len || this.y > canvas.height + this.len) {
                                this.active = false;
                                this.waitTime = new Date().getTime() + Math.random() * 5000 + 3000; // Wait 3-8s
                            }
                        } else {
                            if (this.waitTime < new Date().getTime()) {
                                this.reset();
                                this.active = true;
                                this.x = Math.random() * canvas.width;
                                this.y = Math.random() * (canvas.height * 0.4) - 50;
                            }
                        }
                    }
                    draw() {
                        if (this.active) {
                            ctx.save();
                            ctx.translate(this.x, this.y);
                            ctx.rotate(Math.atan2(this.speedY, this.speedX));

                            // Head
                            ctx.beginPath();
                            ctx.arc(0, 0, this.size, 0, Math.PI * 2);
                            ctx.fillStyle = 'white';
                            ctx.shadowColor = 'white';
                            ctx.shadowBlur = 10;
                            ctx.fill();

                            // Trail
                            const grad = ctx.createLinearGradient(0, 0, -this.len, 0);
                            grad.addColorStop(0, "rgba(255,255,255,0.8)");
                            grad.addColorStop(1, "rgba(255,255,255,0)");

                            ctx.beginPath();
                            ctx.moveTo(0, 0);
                            ctx.lineTo(-this.len, 0);
                            ctx.strokeStyle = grad;
                            ctx.lineWidth = this.size;
                            ctx.lineCap = 'round';
                            ctx.stroke();

                            ctx.restore();
                        }
                    }
                }

                for (let i = 0; i < config.count; i++) {
                    particles.push(new Particle());
                }

                let shootingStars = [];
                if (particlePattern === 'stars') {
                    // Add 2 shooting star controllers
                    shootingStars.push(new ShootingStar());
                    shootingStars.push(new ShootingStar());
                }

                function animateParticles() {
                    if (!document.getElementById('fb-toolkit-particles')) return;
                    ctx.clearRect(0, 0, canvas.width, canvas.height);

                    particles.forEach(function (p) { p.update(); p.draw(); });

                    if (particlePattern === 'stars') {
                        shootingStars.forEach(function (s) { s.update(); s.draw(); });
                    }

                    requestAnimationFrame(animateParticles);
                }
                animateParticles();
            }
        } else if (existingParticles || onMarketplacePage) {
            // Remove particles if pattern is 'none' or we're on marketplace
            const particles = document.getElementById('fb-toolkit-particles');
            if (particles) particles.remove();
        }

        // Only inject if we have styles to apply
        if (css) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = css;

            // Wait for head to be available
            const inject = () => {
                const head = document.head || document.querySelector('head');
                if (head) {
                    head.appendChild(style);
                } else {
                    // Try again shortly if head isn't ready
                    setTimeout(inject, 10);
                }
            };
            inject();
        }

        queueContentFilterRun();
        queueReelVideoPreferenceRun();

        // Initialize hover zoom if enabled
        initHoverZoom(settings.HOVER_ZOOM?.enable, settings.HOVER_ZOOM?.excludeUrls, settings.HOVER_ZOOM?.enablePin, settings.HOVER_ZOOM?.mode);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // HOVER ZOOM FEATURE
    // ══════════════════════════════════════════════════════════════════════════

    const HOVER_ZOOM_STYLES_ID = 'fb-toolkit-hover-zoom-styles';
    const HOVER_ZOOM_POPUP_ID = 'fb-toolkit-hover-zoom-popup';
    let hoverZoomEnabled = false;
    let hoverZoomMode = 'popup'; // 'popup' or 'inline'
    let hoverZoomExcludeUrls = [];
    let hoverZoomUpscaleSmall = true;
    let hoverZoomEnablePin = false;
    let hoverZoomDebounceTimer = null;
    let currentHoverImage = null;
    let currentZoomLevel = 1;
    let zoomOriginX = 50;
    let zoomOriginY = 50;
    // Pan state
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panOffsetX = 0;
    let panOffsetY = 0;

    // ── Ctrl-key temporary hover zoom activation ──
    let ctrlKeyHeld = false;
    let ctrlHoverZoomActive = false; // true when Ctrl temporarily activated hover zoom

    /**
     * Returns true if hover zoom should be active right now.
     * Either the feature is enabled in settings, or the user is holding the Ctrl key.
     */
    function isHoverZoomActive() {
        return hoverZoomEnabled || ctrlKeyHeld;
    }

    // Always-active keyboard listeners for Ctrl-key hover zoom trigger
    function handleCtrlHoverZoomKeyDown(e) {
        if (e.key !== 'Control' || ctrlKeyHeld) return;
        ctrlKeyHeld = true;

        // If hover zoom is already enabled via settings, nothing extra to do
        if (hoverZoomEnabled) return;

        // Temporarily activate popup-mode hover zoom
        ctrlHoverZoomActive = true;
        injectHoverZoomStyles();
        document.addEventListener('mouseenter', handleImageMouseEnter, true);
        document.addEventListener('mouseleave', handleImageMouseLeave, true);
        document.addEventListener('keydown', handleHoverZoomKeydown, true);
        document.addEventListener('click', handleHoverZoomClick, true);
        document.addEventListener('wheel', handleHoverZoomWheel, { passive: false, capture: true });
        document.addEventListener('mousedown', handlePanStart, true);
        document.addEventListener('mousemove', handlePanMove, true);
        document.addEventListener('mouseup', handlePanEnd, true);
        window.addEventListener('scroll', handleHoverZoomScroll, { passive: true, capture: true });
        showCtrlHoverZoomToast();
    }

    function handleCtrlHoverZoomKeyUp(e) {
        if (e.key !== 'Control') return;
        ctrlKeyHeld = false;

        // If we temporarily activated hover zoom, tear it down
        if (ctrlHoverZoomActive) {
            ctrlHoverZoomActive = false;
            hideCtrlHoverZoomToast();
            hideHoverZoom();
            removeHoverZoomPopup();
            removeHoverZoomListeners();
            removeHoverZoomStyles();
        }
    }

    // Handle window blur (e.g., user Alt+Tabs away while holding Ctrl)
    function handleCtrlHoverZoomBlur() {
        if (ctrlKeyHeld) {
            ctrlKeyHeld = false;
            if (ctrlHoverZoomActive) {
                ctrlHoverZoomActive = false;
                hideCtrlHoverZoomToast();
                hideHoverZoom();
                removeHoverZoomPopup();
                removeHoverZoomListeners();
                removeHoverZoomStyles();
            }
        }
    }

    // Register global Ctrl listeners (always active, regardless of hover zoom setting)
    document.addEventListener('keydown', handleCtrlHoverZoomKeyDown, true);
    document.addEventListener('keyup', handleCtrlHoverZoomKeyUp, true);
    window.addEventListener('blur', handleCtrlHoverZoomBlur);

    /**
     * Check if the current page URL should have hover zoom disabled based on user-defined patterns
     */
    function isHoverZoomExcludedPage() {
        const currentUrl = location.href;

        // Hard-coded default exclusions (Global)
        const defaultExclusions = [
            '/messages/',
            '/checkpoint/',
            '/ads/',
            '/business/',
            '/gaming/',
            '/messenger_media/'
        ];

        for (const pattern of defaultExclusions) {
            if (currentUrl.includes(pattern)) return true;
        }

        // User-defined exclude patterns are ONLY honored for Popup mode, as per user request
        if (hoverZoomMode !== 'popup') return false;

        if (hoverZoomExcludeUrls.length === 0) return false;

        // Check if any of the user-defined exclude patterns match
        for (const pattern of hoverZoomExcludeUrls) {
            if (pattern && currentUrl.includes(pattern)) {
                return true;
            }
        }
        return false;
    }

    function getHoverZoomStyles() {
        return `
            #${HOVER_ZOOM_POPUP_ID} {
                position: fixed;
                z-index: 2147483646;
                pointer-events: none;
                opacity: 0;
                transform: scale(0.92) translateY(8px);
                transition: opacity 180ms ease, transform 180ms ease;
                max-width: 80vw;
                max-height: 80vh;
                border-radius: 16px;
                overflow: hidden;
                box-shadow: 
                    0 32px 64px rgba(0, 0, 0, 0.5),
                    0 16px 32px rgba(0, 0, 0, 0.3),
                    0 0 0 1px rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(20px) saturate(180%);
                -webkit-backdrop-filter: blur(20px) saturate(180%);
                background: rgba(15, 23, 42, 0.85);
                padding: 8px;
            }

            #${HOVER_ZOOM_POPUP_ID}.visible {
                opacity: 1;
                transform: scale(1) translateY(0);
            }

            #${HOVER_ZOOM_POPUP_ID} img {
                display: block;
                max-width: 100%;
                max-height: calc(80vh - 16px);
                width: auto;
                height: auto;
                object-fit: contain;
                border-radius: 10px;
                transition: transform 150ms ease-out;
                transform-origin: center center;
            }

            #${HOVER_ZOOM_POPUP_ID} img.upscaled {
                min-width: 400px;
                min-height: 400px;
                object-fit: contain;
                image-rendering: auto;
            }

            #${HOVER_ZOOM_POPUP_ID}.zoomed {
                pointer-events: auto;
                cursor: zoom-out;
            }

            #${HOVER_ZOOM_POPUP_ID}.zoomed img {
                cursor: grab;
            }

            #${HOVER_ZOOM_POPUP_ID}.panning img {
                cursor: grabbing;
                transition: none;
            }

            /* Zoom indicator */
            #${HOVER_ZOOM_POPUP_ID} .zoom-indicator {
                position: absolute;
                top: 14px;
                right: 14px;
                background: rgba(0, 0, 0, 0.6);
                color: #fff;
                padding: 4px 10px;
                border-radius: 8px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 11px;
                font-weight: 600;
                opacity: 0;
                transition: opacity 200ms ease;
                pointer-events: none;
                z-index: 11;
            }

            #${HOVER_ZOOM_POPUP_ID}.zoomed .zoom-indicator {
                opacity: 1;
            }

            #${HOVER_ZOOM_POPUP_ID}::before {
                content: '';
                position: absolute;
                inset: 0;
                border-radius: 16px;
                padding: 1px;
                background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%);
                -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                -webkit-mask-composite: xor;
                mask-composite: exclude;
                pointer-events: none;
            }

            /* Loading state */
            #${HOVER_ZOOM_POPUP_ID}.loading {
                min-width: 150px;
                min-height: 150px;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            #${HOVER_ZOOM_POPUP_ID}.loading::after {
                content: '';
                width: 32px;
                height: 32px;
                border: 3px solid rgba(255, 255, 255, 0.1);
                border-top-color: rgba(99, 102, 241, 0.8);
                border-radius: 50%;
                animation: hoverZoomSpin 0.8s linear infinite;
            }

            @keyframes hoverZoomSpin {
                to { transform: rotate(360deg); }
            }

            /* ASTRA watermark */
            #${HOVER_ZOOM_POPUP_ID} .astra-watermark {
                position: absolute;
                bottom: 14px;
                left: 14px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 10px;
                font-weight: 600;
                letter-spacing: 1.5px;
                text-transform: uppercase;
                color: rgba(255, 255, 255, 0.4);
                pointer-events: none;
                user-select: none;
                z-index: 10;
            }

            /* Zoom controls bar */
            #${HOVER_ZOOM_POPUP_ID} .zoom-controls {
                pointer-events: auto;
                position: absolute;
                bottom: 14px;
                left: 50%;
                transform: translateX(-50%);
                display: flex;
                align-items: center;
                gap: 6px;
                background: rgba(0, 0, 0, 0.65);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                border-radius: 24px;
                padding: 5px 12px;
                opacity: 0;
                transition: opacity 250ms ease;
                z-index: 12;
                user-select: none;
            }

            #${HOVER_ZOOM_POPUP_ID}.visible .zoom-controls {
                opacity: 1;
            }

            #${HOVER_ZOOM_POPUP_ID} .zoom-controls button {
                width: 22px;
                height: 22px;
                border: none;
                background: rgba(255,255,255,0.12);
                border-radius: 50%;
                color: #fff;
                font-size: 14px;
                font-weight: 700;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 150ms ease;
                padding: 0;
                line-height: 1;
            }

            #${HOVER_ZOOM_POPUP_ID} .zoom-controls button:hover {
                background: rgba(255,255,255,0.3);
            }

            #${HOVER_ZOOM_POPUP_ID} .zoom-controls .zoom-slider {
                width: 70px;
                height: 3px;
                -webkit-appearance: none;
                appearance: none;
                background: rgba(255,255,255,0.2);
                border-radius: 2px;
                outline: none;
                cursor: pointer;
                margin: 0;
            }

            #${HOVER_ZOOM_POPUP_ID} .zoom-controls .zoom-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 12px;
                height: 12px;
                background: #fff;
                border-radius: 50%;
                cursor: pointer;
                box-shadow: 0 1px 3px rgba(0,0,0,0.4);
            }

            #${HOVER_ZOOM_POPUP_ID} .zoom-controls .zoom-level-text {
                color: rgba(255,255,255,0.8);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 10px;
                font-weight: 600;
                min-width: 26px;
                text-align: center;
                user-select: none;
            }

            /* Pinned image floating window */
            .astra-pinned-image {
                position: fixed;
                z-index: 2147483645;
                background: rgba(15, 23, 42, 0.92);
                border-radius: 12px;
                overflow: hidden;
                box-shadow:
                    0 20px 50px rgba(0, 0, 0, 0.5),
                    0 8px 20px rgba(0, 0, 0, 0.3),
                    0 0 0 1px rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                padding: 0;
                min-width: 120px;
                min-height: 120px;
                display: flex;
                flex-direction: column;
                transition: box-shadow 200ms ease;
            }

            .astra-pinned-image:hover {
                box-shadow:
                    0 24px 60px rgba(0, 0, 0, 0.6),
                    0 12px 28px rgba(0, 0, 0, 0.35),
                    0 0 0 1px rgba(99, 102, 241, 0.4);
            }

            .astra-pinned-image .pinned-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 6px 8px;
                background: rgba(0, 0, 0, 0.4);
                cursor: grab;
                user-select: none;
                flex-shrink: 0;
            }

            .astra-pinned-image .pinned-header:active {
                cursor: grabbing;
            }

            .astra-pinned-image .pinned-label {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 10px;
                font-weight: 600;
                letter-spacing: 1px;
                text-transform: uppercase;
                color: rgba(255, 255, 255, 0.5);
                pointer-events: none;
            }

            .astra-pinned-image .pinned-close {
                width: 20px;
                height: 20px;
                border: none;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 50%;
                color: rgba(255, 255, 255, 0.7);
                font-size: 14px;
                font-weight: 700;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                line-height: 1;
                transition: background 150ms ease, color 150ms ease;
            }

            .astra-pinned-image .pinned-close:hover {
                background: rgba(239, 68, 68, 0.8);
                color: #fff;
            }

            .astra-pinned-image .pinned-body {
                flex: 1;
                overflow: hidden;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 6px;
            }

            .astra-pinned-image .pinned-body img {
                display: block;
                width: 100%;
                height: 100%;
                object-fit: contain;
                border-radius: 6px;
                pointer-events: none;
            }

            .astra-pinned-image .pinned-resize {
                position: absolute;
                bottom: 0;
                right: 0;
                width: 18px;
                height: 18px;
                cursor: nwse-resize;
                background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.25) 50%);
                border-radius: 0 0 12px 0;
            }

            .astra-pinned-image .pinned-resize:hover {
                background: linear-gradient(135deg, transparent 50%, rgba(99,102,241,0.5) 50%);
            }
        `;
    }

    function injectHoverZoomStyles() {
        if (document.getElementById(HOVER_ZOOM_STYLES_ID)) return;

        const style = document.createElement('style');
        style.id = HOVER_ZOOM_STYLES_ID;
        style.textContent = getHoverZoomStyles();

        const head = document.head || document.querySelector('head');
        if (head) head.appendChild(style);
    }

    function removeHoverZoomStyles() {
        const style = document.getElementById(HOVER_ZOOM_STYLES_ID);
        if (style) style.remove();
    }

    function createHoverZoomPopup() {
        let popup = document.getElementById(HOVER_ZOOM_POPUP_ID);
        if (!popup) {
            popup = document.createElement('div');
            popup.id = HOVER_ZOOM_POPUP_ID;

            // Add ASTRA watermark
            const watermark = document.createElement('span');
            watermark.className = 'astra-watermark';
            watermark.textContent = 'ASTRA';
            popup.appendChild(watermark);

            // Add zoom indicator
            const zoomIndicator = document.createElement('span');
            zoomIndicator.className = 'zoom-indicator';
            zoomIndicator.textContent = '1.0x';
            popup.appendChild(zoomIndicator);

            // Add zoom controls bar
            const zoomControls = document.createElement('div');
            zoomControls.className = 'zoom-controls';
            zoomControls.innerHTML = `
                <button class="zoom-out-btn" title="Zoom Out">&minus;</button>
                <input type="range" class="zoom-slider" min="1" max="5" step="0.1" value="1">
                <button class="zoom-in-btn" title="Zoom In">+</button>
                <span class="zoom-level-text">1.0x</span>
                <button class="pin-btn" title="Pin Image" style="margin-left:4px;font-size:12px;display:none;">📌</button>
            `;

            const slider = zoomControls.querySelector('.zoom-slider');
            const zoomOutBtn = zoomControls.querySelector('.zoom-out-btn');
            const zoomInBtn = zoomControls.querySelector('.zoom-in-btn');

            slider.addEventListener('input', (e) => {
                e.stopPropagation();
                applyZoomFromControls(popup, parseFloat(e.target.value));
            });

            zoomOutBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const nz = Math.max(1, currentZoomLevel - 0.5);
                slider.value = nz;
                applyZoomFromControls(popup, nz);
            });

            zoomInBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const nz = Math.min(5, currentZoomLevel + 0.5);
                slider.value = nz;
                applyZoomFromControls(popup, nz);
            });

            let sliderDragging = false;
            slider.addEventListener('mousedown', () => { sliderDragging = true; });
            document.addEventListener('mouseup', () => {
                if (sliderDragging) {
                    sliderDragging = false;
                    clearTimeout(hoverZoomDebounceTimer);
                }
            }, true);

            // Prevent hover dismissal when interacting with controls
            zoomControls.addEventListener('mouseenter', () => {
                clearTimeout(hoverZoomDebounceTimer);
            });
            zoomControls.addEventListener('mouseleave', () => {
                if (sliderDragging) return; // Don't dismiss while dragging slider
                if (!popup.classList.contains('zoomed')) {
                    hoverZoomDebounceTimer = setTimeout(() => hideHoverZoom(), 400);
                }
            });

            // Pin button handler
            const pinBtn = zoomControls.querySelector('.pin-btn');
            pinBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                pinHoverZoomImage();
            });

            popup.appendChild(zoomControls);

            // Add dismissal when leaving the popup container (especially when zoomed)
            popup.addEventListener('mouseleave', handlePopupMouseLeave);

            document.body.appendChild(popup);
        }
        return popup;
    }

    function applyZoomFromControls(popup, newZoom) {
        currentZoomLevel = Math.max(1, Math.min(5, newZoom));
        const popupImg = popup.querySelector('img');
        if (!popupImg) return;

        const indicator = popup.querySelector('.zoom-indicator');
        if (indicator) indicator.textContent = `${currentZoomLevel.toFixed(1)}x`;
        const zlt = popup.querySelector('.zoom-level-text');
        if (zlt) zlt.textContent = `${currentZoomLevel.toFixed(1)}x`;
        const sl = popup.querySelector('.zoom-slider');
        if (sl) sl.value = currentZoomLevel;

        if (currentZoomLevel > 1) {
            popup.classList.add('zoomed');
            popupImg.style.transformOrigin = `${zoomOriginX}% ${zoomOriginY}%`;
            popupImg.style.transform = `scale(${currentZoomLevel}) translate(${panOffsetX}px, ${panOffsetY}px)`;
        } else {
            popup.classList.remove('zoomed', 'panning');
            panOffsetX = 0;
            panOffsetY = 0;
            popupImg.style.transform = '';
            popupImg.style.transformOrigin = '';
        }
    }

    function clearPopupContent(popup) {
        // Remove all children except the watermark, zoom indicator, and zoom controls
        Array.from(popup.children).forEach(child => {
            if (!child.classList.contains('astra-watermark') && !child.classList.contains('zoom-indicator') && !child.classList.contains('zoom-controls')) {
                child.remove();
            }
        });
    }

    function removeHoverZoomPopup() {
        const popup = document.getElementById(HOVER_ZOOM_POPUP_ID);
        if (popup) popup.remove();
        currentHoverImage = null;
    }

    function getFullResImageUrl(img) {
        // Try to get the largest image from srcset (these are pre-signed at each resolution)
        const srcset = img.getAttribute('srcset');
        if (srcset) {
            const sources = srcset.split(',').map(src => {
                const parts = src.trim().split(/\s+/);
                const url = parts[0];
                const descriptor = parts[1] || '1x';
                // Parse width descriptor (e.g., '1080w') or pixel density (e.g., '2x')
                let size = 1;
                if (descriptor.endsWith('w')) {
                    size = parseInt(descriptor, 10) || 1;
                } else if (descriptor.endsWith('x')) {
                    size = parseFloat(descriptor) * 1000 || 1000;
                }
                return { url, size };
            });
            // Sort by size descending and pick the largest
            sources.sort((a, b) => b.size - a.size);
            if (sources.length > 0 && sources[0].url) {
                return sources[0].url;
            }
        }

        // Try data-src attribute (lazy-loaded images)
        const dataSrc = img.dataset.src;
        if (dataSrc) return dataSrc;

        // Fall back to current src - don't try to modify resolution as Facebook CDN
        // URLs have signatures tied to the resolution and modifying them causes 403 errors
        return img.src;
    }

    function isFeedImage(img) {
        if (!img || img.nodeType !== 1) return false;

        // Check if it's an actual content image (not UI elements, icons, avatars)
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;

        // Skip tiny images (icons, avatars are usually small)
        if (width < 100 || height < 100) return false;

        // Skip profile pictures and avatars
        const closestLink = img.closest('a');
        if (closestLink) {
            const href = closestLink.getAttribute('href') || '';
            if (href.includes('/profile.php') || href.match(/^\/[\w.]+$/)) {
                // Check if it's a small circular avatar
                const imgRect = img.getBoundingClientRect();
                if (imgRect.width < 120 && imgRect.height < 120) return false;
            }
        }

        // Skip images that are inside avatar containers
        if (img.closest('[data-visualcompletion="ignore-dynamic"]')) {
            const imgRect = img.getBoundingClientRect();
            if (imgRect.width < 100) return false;
        }

        // Must be inside the main content area, article, or dialog (for post modals)
        const inFeed = img.closest('div[role="main"]') ||
            img.closest('div[role="article"]') ||
            img.closest('div[role="dialog"]');
        if (!inFeed) return false;

        return true;
    }

    /**
     * Check if an image is a Story thumbnail (the main story image, not the small profile icon)
     */
    function isStoryThumbnail(img) {
        if (!img || img.nodeType !== 1) return false;

        // Must be inside the Stories section
        if (!img.closest('[aria-label="Stories"]')) return false;

        const rect = img.getBoundingClientRect();

        // Story thumbnails are typically ~112px wide x ~200px tall
        // Profile icons on stories are small (~40px)
        // Only allow images that are reasonably sized (not the tiny profile icons)
        if (rect.width < 80 || rect.height < 100) return false;

        // Check that it's inside a story link
        const closestLink = img.closest('a');
        if (closestLink) {
            const href = closestLink.getAttribute('href') || '';
            if (href.includes('/stories/')) return true;
        }

        return true;
    }

    /**
     * Find the main story thumbnail image within a story card container
     * Returns the largest image (the story thumbnail), excluding small profile icons
     */
    function findStoryThumbnailImage(storyLink) {
        if (!storyLink) return null;

        const images = storyLink.querySelectorAll('img');
        if (images.length === 0) return null;

        // Find the largest image by area (width * height)
        let largestImg = null;
        let largestArea = 0;

        for (const img of images) {
            const rect = img.getBoundingClientRect();
            const area = rect.width * rect.height;

            // Skip tiny images (profile icons are typically 40x40 = 1600 area)
            // Story thumbnails are typically ~112x200 = ~22400 area
            if (area > largestArea && rect.width > 60 && rect.height > 80) {
                largestArea = area;
                largestImg = img;
            }
        }

        return largestImg;
    }

    function isProfileOrCoverPhoto(img) {
        if (!img || img.nodeType !== 1) return false;

        // Must be on a profile page
        if (!isProfileRoute()) return false;

        const rect = img.getBoundingClientRect();

        // Skip very small images (icons, tiny thumbnails)
        if (rect.width < 80 || rect.height < 80) return false;

        // Skip images in nav/header (Facebook UI elements)
        if (img.closest('nav, [role="navigation"], [role="banner"]')) return false;

        // Check for specific profile/cover photo indicators
        // 1. Cover photo
        if (img.getAttribute('data-imgperflogname') === 'profileCoverPhoto') return true;

        // 2. Profile photo — typically in a link to the profile or in an SVG container
        const parentLink = img.closest('a[href]');
        if (parentLink) {
            const href = parentLink.getAttribute('href') || '';
            // Profile photo links to the profile page or a photo page
            if (href.includes('/photo') || href.includes('/profile')) return true;
        }

        // 3. Images inside photo links on the profile (sidebar photos, albums, timeline photos)
        if (img.closest('a[href*="/photo"]') || img.closest('a[href*="/photos/"]')) return true;

        return false;
    }

    /**
     * Find the visible bounding rect of the cover photo by checking for the
     * clipping ancestor (overflow:hidden container) instead of the raw IMG rect.
     * Facebook uses a very tall IMG (often 1700+ px) but clips it inside a
     * much smaller container (~130–350px visible height).
     */
    function findCoverPhotoVisibleRect(coverImg) {
        if (!coverImg) return null;
        let parent = coverImg.parentElement;
        const imgRect = coverImg.getBoundingClientRect();
        for (let i = 0; i < 6; i++) {
            if (!parent || parent === document.body) break;
            const parentRect = parent.getBoundingClientRect();
            // The clipping container is the first ancestor that is significantly shorter
            // than the raw image (i.e., it clips the image)
            if (parentRect.height < imgRect.height * 0.6 && parentRect.height > 50) {
                return parentRect;
            }
            parent = parent.parentElement;
        }
        // Fallback: use the IMG rect but cap height to a reasonable cover photo height
        return imgRect;
    }

    /**
     * Check if element is in the cover photo area (including "Learn more" overlay on locked profiles)
     */
    function isCoverPhotoArea(element) {
        if (!element || element.nodeType !== 1) return false;
        if (!isProfileRoute()) return false;

        // Check if it's the cover photo image directly
        if (element.tagName === 'IMG' && element.getAttribute('data-imgperflogname') === 'profileCoverPhoto') {
            return true;
        }

        // Quick reject: get element position early
        const elRect = element.getBoundingClientRect();

        // Exclude navigation, tabs, links (the profile tab bar: All, About, Friends, Photos, etc.)
        if (element.closest('[role="tablist"], [role="tab"], nav, [role="navigation"]')) return false;
        // Exclude plain text links that aren't photo-specific
        if (element.tagName === 'A' || element.closest('a')) {
            const link = element.tagName === 'A' ? element : element.closest('a');
            const href = link.getAttribute('href') || '';
            // Allow only if the link points to a photo
            if (!href.includes('/photo')) return false;
        }

        // Check if it's an overlay with a cover-related aria-label
        const ariaLabel = element.getAttribute('aria-label') || '';
        if (ariaLabel.toLowerCase().includes('cover')) {
            if (elRect.width > 300 && elRect.height > 100 && elRect.top < 500) {
                return true;
            }
        }

        // Find the cover photo and its VISIBLE container rect
        const coverImg = document.querySelector('img[data-imgperflogname="profileCoverPhoto"]');
        if (!coverImg) return false;

        const visibleRect = findCoverPhotoVisibleRect(coverImg);
        if (!visibleRect) return false;

        // Check if the hovered element is STRICTLY within the visible cover container
        const elCenterX = (elRect.left + elRect.right) / 2;
        const elCenterY = (elRect.top + elRect.bottom) / 2;
        if (elCenterX >= visibleRect.left && elCenterX <= visibleRect.right &&
            elCenterY >= visibleRect.top && elCenterY <= visibleRect.bottom) {
            return true;
        }

        return false;
    }

    /**
     * Find the cover photo image from an element in the cover area
     */
    function findCoverPhotoImage(element) {
        // Direct case: element is the cover image
        if (element.tagName === 'IMG' && element.getAttribute('data-imgperflogname') === 'profileCoverPhoto') {
            return element;
        }

        // Check parent containers for the cover image (walk up aggressively)
        let curr = element;
        for (let i = 0; i < 15; i++) {
            if (!curr || curr === document.body) break;

            const coverImg = curr.querySelector('img[data-imgperflogname="profileCoverPhoto"]');
            if (coverImg) return coverImg;

            if (curr.parentElement) {
                const siblingCover = curr.parentElement.querySelector('img[data-imgperflogname="profileCoverPhoto"]');
                if (siblingCover) return siblingCover;
            }

            curr = curr.parentElement;
        }

        // Fallback: find the largest image near the top of the profile page
        if (isProfileRoute()) {
            const allImgs = document.querySelectorAll('img');
            let bestImg = null;
            let bestArea = 0;
            for (const img of allImgs) {
                const r = img.getBoundingClientRect();
                if (r.top < 500 && r.width > 300 && r.height > 100) {
                    const area = r.width * r.height;
                    if (area > bestArea) {
                        bestArea = area;
                        bestImg = img;
                    }
                }
            }
            if (bestImg) return bestImg;
        }

        return null;
    }

    /**
     * Check if an element is an SVG-based profile picture (Facebook uses SVG for circular profile pics)
     */
    function isSvgProfilePicture(element) {
        if (!element || element.nodeType !== 1) return false;

        // Check if it's an SVG or if we're inside an SVG
        // For SVG child elements (image, g, mask, circle, etc.), use ownerSVGElement
        let svg = null;
        if (element.tagName === 'svg' || element.tagName === 'SVG') {
            svg = element;
        } else if (element.ownerSVGElement) {
            svg = element.ownerSVGElement;
        } else if (element.closest && element.closest('svg')) {
            svg = element.closest('svg');
        }

        if (!svg) return false;

        // Must have an <image> element inside
        const imageEl = svg.querySelector('image');
        if (!imageEl) return false;

        // Check if the SVG has role="img" (Facebook profile pics do)
        if (svg.getAttribute('role') !== 'img') return false;

        // Must have an xlink:href or href with image URL
        const href = imageEl.getAttribute('xlink:href') || imageEl.getAttribute('href');
        if (!href || !href.includes('fbcdn.net')) return false;

        const rect = svg.getBoundingClientRect();
        // Skip tiny icons
        if (rect.width < 50 || rect.height < 50) return false;

        return true;
    }

    /**
     * Extract image URL from SVG profile picture
     */
    function getSvgImageUrl(element) {
        const svg = element.tagName === 'svg' ? element : element.closest('svg');
        if (!svg) return null;

        const imageEl = svg.querySelector('image');
        if (!imageEl) return null;

        // Use the original URL - Facebook's CDN URL signatures are tied to the resolution
        // Attempting to modify the stp parameter causes 403 errors
        const href = imageEl.getAttribute('xlink:href') || imageEl.getAttribute('href');
        return href || null;
    }

    /**
     * Get the SVG element from any element inside it
     */
    function getSvgElement(element) {
        if (element.tagName === 'svg' || element.tagName === 'SVG') return element;
        if (element.ownerSVGElement) return element.ownerSVGElement;
        if (element.closest) return element.closest('svg');
        return null;
    }

    function positionPopup(popup, img) {
        const rect = img.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Calculate popup dimensions (estimate based on max constraints)
        const maxWidth = viewportWidth * 0.8;
        const maxHeight = viewportHeight * 0.8;

        // Prefer positioning to the right of the image, or left if not enough space
        let left, top;

        // Horizontal positioning
        if (rect.right + maxWidth + 20 < viewportWidth) {
            // Position to the right
            left = rect.right + 16;
        } else if (rect.left - maxWidth - 20 > 0) {
            // Position to the left
            left = rect.left - maxWidth - 16;
        } else {
            // Center horizontally
            left = Math.max(10, (viewportWidth - maxWidth) / 2);
        }

        // Vertical positioning - center vertically relative to image
        top = rect.top + (rect.height / 2) - (maxHeight / 2);
        // Clamp to viewport
        top = Math.max(10, Math.min(top, viewportHeight - maxHeight - 10));

        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
    }

    function showHoverZoom(img) {
        if (!isHoverZoomActive() || !img) return;
        if (currentHoverImage === img) return;

        // Make sure the image is still visible in the viewport
        const rect = img.getBoundingClientRect();
        if (rect.top > window.innerHeight || rect.bottom < 0 ||
            rect.left > window.innerWidth || rect.right < 0) {
            return;
        }

        const fullUrl = getFullResImageUrl(img);

        currentHoverImage = img;
        const popup = createHoverZoomPopup();

        // Show loading state
        clearPopupContent(popup);
        popup.classList.add('loading');
        popup.classList.remove('visible');
        positionPopup(popup, img);

        // Show popup with animation
        requestAnimationFrame(() => {
            popup.classList.add('visible');
        });

        // Load the full image
        const fullImg = new Image();
        fullImg.onload = () => {
            if (currentHoverImage !== img) return; // User moved away
            popup.classList.remove('loading');
            clearPopupContent(popup);
            // Upscale small images if enabled
            if (hoverZoomUpscaleSmall && fullImg.naturalWidth < 400 && fullImg.naturalHeight < 400) {
                fullImg.classList.add('upscaled');
            }
            popup.appendChild(fullImg);
            // Reposition based on actual image size
            requestAnimationFrame(() => {
                positionPopup(popup, img);
            });
        };
        fullImg.onerror = () => {
            if (currentHoverImage !== img) return;
            popup.classList.remove('loading', 'visible');
        };
        fullImg.src = fullUrl;
    }

    function showHoverZoomForSvg(svg) {
        if (!isHoverZoomActive() || !svg) return;
        if (currentHoverImage === svg) return;

        // Make sure the SVG is still visible in the viewport
        const rect = svg.getBoundingClientRect();
        if (rect.top > window.innerHeight || rect.bottom < 0 ||
            rect.left > window.innerWidth || rect.right < 0) {
            return;
        }

        const fullUrl = getSvgImageUrl(svg);
        if (!fullUrl) return;

        currentHoverImage = svg;
        const popup = createHoverZoomPopup();

        // Show loading state
        clearPopupContent(popup);
        popup.classList.add('loading');
        popup.classList.remove('visible');
        positionPopup(popup, svg);

        // Show popup with animation
        requestAnimationFrame(() => {
            popup.classList.add('visible');
        });

        // Load the full image
        const fullImg = new Image();
        fullImg.onload = () => {
            if (currentHoverImage !== svg) return; // User moved away
            popup.classList.remove('loading');
            clearPopupContent(popup);
            // Upscale small images if enabled
            if (hoverZoomUpscaleSmall && fullImg.naturalWidth < 400 && fullImg.naturalHeight < 400) {
                fullImg.classList.add('upscaled');
            }
            popup.appendChild(fullImg);
            // Reposition based on actual image size
            requestAnimationFrame(() => {
                positionPopup(popup, svg);
            });
        };
        fullImg.onerror = () => {
            if (currentHoverImage !== svg) return;
            popup.classList.remove('loading', 'visible');
        };
        fullImg.src = fullUrl;
    }

    function hideHoverZoom() {
        const popup = document.getElementById(HOVER_ZOOM_POPUP_ID);
        if (popup) {
            popup.classList.remove('visible', 'zoomed', 'panning');
            // Reset zoom and pan state
            currentZoomLevel = 1;
            zoomOriginX = 50;
            zoomOriginY = 50;
            panOffsetX = 0;
            panOffsetY = 0;
            isPanning = false;
            const img = popup.querySelector('img');
            if (img) {
                img.style.transform = '';
                img.style.transformOrigin = '';
            }
            const indicator = popup.querySelector('.zoom-indicator');
            if (indicator) indicator.textContent = '1.0x';
            // Reset zoom slider controls
            const sl = popup.querySelector('.zoom-slider');
            if (sl) sl.value = 1;
            const zlt = popup.querySelector('.zoom-level-text');
            if (zlt) zlt.textContent = '1.0x';
            setTimeout(() => {
                if (!popup.classList.contains('visible')) {
                    clearPopupContent(popup);
                    popup.classList.remove('loading');
                }
            }, 200);
        }
        currentHoverImage = null;
    }

    // ── Pinned Images ──────────────────────────────────────────────────────
    const PINNED_STORAGE_KEY = 'astra-pinned-images';
    let pinnedImages = []; // Track pinned image data
    let pinnedIdCounter = 0;

    function savePinnedImages() {
        try {
            const data = pinnedImages.map(p => ({ src: p.src, x: p.x, y: p.y, w: p.w, h: p.h }));
            localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(data));
        } catch (e) { /* storage full or unavailable */ }
    }

    function loadPinnedImages() {
        try {
            const raw = localStorage.getItem(PINNED_STORAGE_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (!Array.isArray(data)) return;
            for (const item of data) {
                if (item.src) {
                    createPinnedWindow(item.src, item);
                }
            }
        } catch (e) { /* corrupted data */ }
    }

    function pinHoverZoomImage() {
        const popup = document.getElementById(HOVER_ZOOM_POPUP_ID);
        if (!popup) return;

        const popupImg = popup.querySelector('img');
        if (!popupImg || !popupImg.src) return;

        const imgSrc = popupImg.src;

        // Close the hover zoom popup
        hideHoverZoom();

        // Start observer for SPA persistence (lazy init)
        ensurePinnedObserver();

        // Create pinned floating window
        createPinnedWindow(imgSrc);
    }

    function createPinnedWindow(imgSrc, savedState) {
        const id = `astra-pinned-${pinnedIdCounter++}`;
        const win = document.createElement('div');
        win.className = 'astra-pinned-image';
        win.id = id;

        // Default position & size
        const initW = savedState?.w || 320;
        const initH = savedState?.h || 280;
        const initX = savedState?.x ?? (window.innerWidth - initW - 40);
        const initY = savedState?.y ?? 40;

        win.style.width = initW + 'px';
        win.style.height = initH + 'px';
        win.style.left = initX + 'px';
        win.style.top = initY + 'px';

        // Header (draggable)
        const header = document.createElement('div');
        header.className = 'pinned-header';

        const label = document.createElement('span');
        label.className = 'pinned-label';
        label.textContent = '📌 Pinned';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'pinned-close';
        closeBtn.title = 'Close';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => {
            win.remove();
            const idx = pinnedImages.findIndex(p => p.id === id);
            if (idx !== -1) pinnedImages.splice(idx, 1);
            savePinnedImages();
        });

        header.appendChild(label);
        header.appendChild(closeBtn);

        // Body (image)
        const body = document.createElement('div');
        body.className = 'pinned-body';
        const img = document.createElement('img');
        img.src = imgSrc;
        body.appendChild(img);

        // Resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'pinned-resize';

        win.appendChild(header);
        win.appendChild(body);
        win.appendChild(resizeHandle);

        document.body.appendChild(win);

        // Store for persistence
        pinnedImages.push({ id, src: imgSrc, x: initX, y: initY, w: initW, h: initH });
        savePinnedImages();

        // ── Drag logic ──
        let isDragging = false;
        let dragStartX = 0, dragStartY = 0, dragOriginX = 0, dragOriginY = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target === closeBtn) return;
            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            dragOriginX = win.offsetLeft;
            dragOriginY = win.offsetTop;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;
            const newX = Math.max(0, Math.min(window.innerWidth - win.offsetWidth, dragOriginX + dx));
            const newY = Math.max(0, Math.min(window.innerHeight - win.offsetHeight, dragOriginY + dy));
            win.style.left = newX + 'px';
            win.style.top = newY + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                const data = pinnedImages.find(p => p.id === id);
                if (data) {
                    data.x = win.offsetLeft;
                    data.y = win.offsetTop;
                    savePinnedImages();
                }
            }
        });

        // ── Resize logic ──
        let isResizing = false;
        let resizeStartX = 0, resizeStartY = 0, resizeOriginW = 0, resizeOriginH = 0;

        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            resizeOriginW = win.offsetWidth;
            resizeOriginH = win.offsetHeight;
            e.preventDefault();
            e.stopPropagation();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const dx = e.clientX - resizeStartX;
            const dy = e.clientY - resizeStartY;
            const newW = Math.max(120, resizeOriginW + dx);
            const newH = Math.max(120, resizeOriginH + dy);
            win.style.width = newW + 'px';
            win.style.height = newH + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                const data = pinnedImages.find(p => p.id === id);
                if (data) {
                    data.w = win.offsetWidth;
                    data.h = win.offsetHeight;
                    savePinnedImages();
                }
            }
        });

        return win;
    }

    // Re-inject pinned images after SPA navigation (Facebook removes DOM elements)
    function restorePinnedImages() {
        for (const pinData of pinnedImages) {
            if (!document.getElementById(pinData.id)) {
                createPinnedWindow(pinData.src, pinData);
            }
        }
    }

    // Observe for SPA navigations that might remove pinned images
    let pinnedObserver = null;
    function ensurePinnedObserver() {
        if (pinnedObserver) return;
        if (!document.body) return;
        pinnedObserver = new MutationObserver(() => {
            for (const pinData of pinnedImages) {
                if (!document.getElementById(pinData.id)) {
                    createPinnedWindow(pinData.src, pinData);
                }
            }
        });
        pinnedObserver.observe(document.body, { childList: true, subtree: false });
    }

    // Listen for PIN_IMAGES from popup (via bridge.js → window.postMessage)
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.__fbToolkit !== true || data.type !== 'PIN_IMAGES') return;
        if (!Array.isArray(data.urls)) return;

        ensurePinnedObserver();
        const offset = 30; // Offset each pinned window so they don't stack
        data.urls.forEach((url, i) => {
            if (typeof url === 'string' && url.trim().length > 0) {
                createPinnedWindow(url.trim(), {
                    x: window.innerWidth - 320 - 40 - (i * offset),
                    y: 40 + (i * offset)
                });
            }
        });
    });

    // Listen for UPDATE_FEED_WIDTH from popup (via bridge.js → window.postMessage)
    // This provides smooth real-time updates without a full stylesheet rebuild
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.__fbToolkit !== true || data.type !== 'UPDATE_FEED_WIDTH') return;
        const width = Number(data.width);
        if (!isNaN(width)) {
            document.documentElement.style.setProperty('--fb-feed-width', width + '%');
        }
    });

    function handleImageMouseEnter(e) {
        if (!isHoverZoomActive()) return;

        // Skip if current page URL matches any exclude patterns
        if (isHoverZoomExcludedPage()) return;

        // If the popup is already visible and the mouse is over it, don't switch images.
        // This prevents pointer-events:none from causing image switching when
        // the cursor passes over background images while viewing the popup.
        const existingPopup = document.getElementById(HOVER_ZOOM_POPUP_ID);
        if (existingPopup && existingPopup.classList.contains('visible')) {
            const pr = existingPopup.getBoundingClientRect();
            if (e.clientX >= pr.left && e.clientX <= pr.right &&
                e.clientY >= pr.top && e.clientY <= pr.bottom) {
                return;
            }
        }

        const target = e.target;

        // Handle regular IMG elements
        if (target.tagName === 'IMG') {
            // Allow hover zoom on feed images, profile/cover photos, OR story thumbnails
            if (!isFeedImage(target) && !isProfileOrCoverPhoto(target) && !isStoryThumbnail(target)) return;

            // Skip if this is already the current hover image
            if (currentHoverImage === target) return;

            // Debounce to prevent flickering
            clearTimeout(hoverZoomDebounceTimer);
            hoverZoomDebounceTimer = setTimeout(() => {
                showHoverZoom(target);
            }, 200);
            return;
        }

        // Handle SVG-based profile pictures (Facebook uses SVG for circular profile pics)
        if (isSvgProfilePicture(target)) {
            const svg = getSvgElement(target);
            if (!svg || currentHoverImage === svg) return;

            clearTimeout(hoverZoomDebounceTimer);
            hoverZoomDebounceTimer = setTimeout(() => {
                showHoverZoomForSvg(svg);
            }, 200);
            return;
        }

        // Handle cover photo area (including "Learn more" overlay on locked profiles)
        if (isCoverPhotoArea(target)) {
            const coverImg = findCoverPhotoImage(target);
            if (!coverImg || currentHoverImage === coverImg) return;

            clearTimeout(hoverZoomDebounceTimer);
            hoverZoomDebounceTimer = setTimeout(() => {
                showHoverZoom(coverImg);
            }, 200);
            return;
        }

        // Handle story cards (hovering over any element within a story card container)
        const storyLink = target.closest('a[href*="/stories/"]');
        if (storyLink) {
            // Find the largest image in the story card (the thumbnail, not the profile icon)
            const storyImg = findStoryThumbnailImage(storyLink);
            if (!storyImg || currentHoverImage === storyImg) return;

            clearTimeout(hoverZoomDebounceTimer);
            hoverZoomDebounceTimer = setTimeout(() => {
                showHoverZoom(storyImg);
            }, 200);
            return;
        }

        // Handle photo links (e.g., sidebar photos on profile pages)
        // Facebook often places overlay elements on top of images, so we need to find the img inside the photo link
        const photoLink = target.closest('a[href*="/photo"]');
        if (photoLink) {
            // Skip if this is a navigation/tab link (e.g., the "Photos" tab in the profile bar)
            if (photoLink.closest('[role="tablist"], [role="tab"], nav, [role="navigation"]')) return;

            const photoImg = photoLink.querySelector('img');
            if (!photoImg || currentHoverImage === photoImg) return;

            // Verify it's a reasonable size (not a tiny icon)
            const rect = photoImg.getBoundingClientRect();
            if (rect.width < 50 || rect.height < 50) return;

            clearTimeout(hoverZoomDebounceTimer);
            hoverZoomDebounceTimer = setTimeout(() => {
                showHoverZoom(photoImg);
            }, 200);
            return;
        }
    }

    function handleImageMouseLeave(e) {
        const target = e.target;
        const relatedTarget = e.relatedTarget;

        // Only handle leaves from elements we track
        const isTrackedElement = target.tagName === 'IMG' ||
            isSvgProfilePicture(target) ||
            target.closest('a[href*="/photo"]') ||
            target.closest('a[href*="/stories/"]') ||
            isCoverPhotoArea(target);

        if (!isTrackedElement) return;

        // Don't auto-hide if zoomed in - user must manually close
        const popup = document.getElementById(HOVER_ZOOM_POPUP_ID);
        if (popup && popup.classList.contains('zoomed')) {
            return;
        }

        // Check if mouse moved to the popup itself - don't hide
        if (relatedTarget && popup && (popup.contains(relatedTarget) || popup === relatedTarget)) {
            return;
        }

        // Check if mouse is geometrically over the popup (pointer-events: none means relatedTarget won't be popup)
        if (popup && popup.classList.contains('visible')) {
            const pr = popup.getBoundingClientRect();
            if (e.clientX >= pr.left && e.clientX <= pr.right && e.clientY >= pr.top && e.clientY <= pr.bottom) {
                return;
            }
        }

        // Check if we're still hovering over an element within the same image container
        if (relatedTarget && target.tagName === 'IMG') {
            const imgContainer = target.closest('a') || target.parentElement;
            if (imgContainer && imgContainer.contains(relatedTarget)) {
                return;
            }
        }

        // Grace period: give the user time to travel from the source image to the popup.
        // During the grace period, track mouse position — if cursor reaches the popup, cancel hiding.
        clearTimeout(hoverZoomDebounceTimer);

        const onTravelMove = (moveEvt) => {
            const p = document.getElementById(HOVER_ZOOM_POPUP_ID);
            if (!p || !p.classList.contains('visible')) return;
            const r = p.getBoundingClientRect();
            if (moveEvt.clientX >= r.left && moveEvt.clientX <= r.right &&
                moveEvt.clientY >= r.top && moveEvt.clientY <= r.bottom) {
                // Cursor reached the popup — cancel hide
                clearTimeout(hoverZoomDebounceTimer);
                document.removeEventListener('mousemove', onTravelMove, true);
            }
        };

        document.addEventListener('mousemove', onTravelMove, true);

        hoverZoomDebounceTimer = setTimeout(() => {
            document.removeEventListener('mousemove', onTravelMove, true);
            hideHoverZoom();
        }, 300);
    }

    function handlePopupMouseLeave(e) {
        const popup = document.getElementById(HOVER_ZOOM_POPUP_ID);
        if (!popup) return;

        // If not zoomed and mouse returns to the original image, don't dismiss
        // (allows natural navigation back to the source image)
        // When zoomed, always dismiss immediately on leave.
        if (!popup.classList.contains('zoomed') && currentHoverImage && e.relatedTarget) {
            if (currentHoverImage === e.relatedTarget || currentHoverImage.contains(e.relatedTarget)) return;
            const container = currentHoverImage.closest('a') || currentHoverImage.parentElement;
            if (container && container.contains(e.relatedTarget)) return;
        }

        // Close immediately when cursor leaves the popup
        clearTimeout(hoverZoomDebounceTimer);
        hideHoverZoom();
    }

    function handleHoverZoomKeydown(e) {
        if (e.key === 'Escape') {
            clearTimeout(hoverZoomDebounceTimer);
            hideHoverZoom();
        }
    }

    function handleHoverZoomClick(e) {
        // Don't process click if we were just panning
        if (isPanning) {
            isPanning = false;
            return;
        }

        // Skip clicks on the zoom controls (slider, buttons) — let them handle themselves
        const popup = document.getElementById(HOVER_ZOOM_POPUP_ID);
        if (popup) {
            const zoomControls = popup.querySelector('.zoom-controls');
            if (zoomControls && zoomControls.contains(e.target)) {
                return;
            }
        }

        // If zoomed, reset zoom on click instead of closing
        if (popup && popup.classList.contains('zoomed')) {
            applyZoomFromControls(popup, 1);
            e.stopPropagation();
            return;
        }
        // Dismiss hover zoom on any click
        clearTimeout(hoverZoomDebounceTimer);
        hideHoverZoom();
    }

    function handleHoverZoomWheel(e) {
        const popup = document.getElementById(HOVER_ZOOM_POPUP_ID);
        if (!popup || !popup.classList.contains('visible')) return;

        const popupImg = popup.querySelector('img');
        if (!popupImg) return;

        // Check if mouse is over the popup
        const popupRect = popup.getBoundingClientRect();
        if (e.clientX < popupRect.left || e.clientX > popupRect.right ||
            e.clientY < popupRect.top || e.clientY > popupRect.bottom) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        // If scrolling down (deltaY > 0) and not zoomed in, close the popup
        if (e.deltaY > 0 && currentZoomLevel <= 1) {
            clearTimeout(hoverZoomDebounceTimer);
            hideHoverZoom();
            return;
        }

        // Calculate zoom - smaller increments for gradual zoom
        const zoomDelta = e.deltaY < 0 ? 0.1 : -0.1;
        const newZoom = Math.max(1, Math.min(5, currentZoomLevel + zoomDelta));

        if (newZoom === currentZoomLevel) return;

        // Calculate mouse position relative to image for zoom origin
        const imgRect = popupImg.getBoundingClientRect();
        const mouseXRel = (e.clientX - imgRect.left) / imgRect.width * 100;
        const mouseYRel = (e.clientY - imgRect.top) / imgRect.height * 100;

        // Update zoom origin based on mouse position
        zoomOriginX = Math.max(0, Math.min(100, mouseXRel));
        zoomOriginY = Math.max(0, Math.min(100, mouseYRel));

        currentZoomLevel = newZoom;

        // Apply transform with pan offset
        popupImg.style.transformOrigin = `${zoomOriginX}% ${zoomOriginY}%`;
        popupImg.style.transform = `scale(${currentZoomLevel}) translate(${panOffsetX}px, ${panOffsetY}px)`;

        // Update zoom indicator and sync slider controls
        const indicator = popup.querySelector('.zoom-indicator');
        if (indicator) indicator.textContent = `${currentZoomLevel.toFixed(1)}x`;
        const sl = popup.querySelector('.zoom-slider');
        if (sl) sl.value = currentZoomLevel;
        const zlt = popup.querySelector('.zoom-level-text');
        if (zlt) zlt.textContent = `${currentZoomLevel.toFixed(1)}x`;

        // Toggle zoomed class
        if (currentZoomLevel > 1) {
            popup.classList.add('zoomed');
        } else {
            popup.classList.remove('zoomed', 'panning');
            panOffsetX = 0;
            panOffsetY = 0;
            popupImg.style.transform = '';
            popupImg.style.transformOrigin = '';
        }
    }

    function handlePanStart(e) {
        const popup = document.getElementById(HOVER_ZOOM_POPUP_ID);
        if (!popup || !popup.classList.contains('zoomed')) return;
        if (e.target.tagName !== 'IMG') return;

        e.preventDefault();
        isPanning = true;
        panStartX = e.clientX - panOffsetX;
        panStartY = e.clientY - panOffsetY;
        popup.classList.add('panning');
    }

    function handlePanMove(e) {
        if (!isPanning) return;

        const popup = document.getElementById(HOVER_ZOOM_POPUP_ID);
        if (!popup) return;

        const popupImg = popup.querySelector('img');
        if (!popupImg) return;

        e.preventDefault();
        panOffsetX = e.clientX - panStartX;
        panOffsetY = e.clientY - panStartY;

        // Apply transform with current zoom and new pan
        popupImg.style.transform = `scale(${currentZoomLevel}) translate(${panOffsetX}px, ${panOffsetY}px)`;
    }

    function handlePanEnd(e) {
        if (!isPanning) return;

        const popup = document.getElementById(HOVER_ZOOM_POPUP_ID);
        if (popup) {
            popup.classList.remove('panning');
        }
        // Keep isPanning true briefly to prevent click from firing
        setTimeout(() => {
            isPanning = false;
        }, 50);
    }

    function handleHoverZoomScroll() {
        const popup = document.getElementById(HOVER_ZOOM_POPUP_ID);
        if (!popup || !popup.classList.contains('visible')) return;
        if (popup.classList.contains('zoomed')) return;

        // Only dismiss if the original image has scrolled out of view
        if (currentHoverImage) {
            const rect = currentHoverImage.getBoundingClientRect();
            if (rect.bottom > -100 && rect.top < window.innerHeight + 100) {
                return; // Image still partially visible, keep popup
            }
        }
        clearTimeout(hoverZoomDebounceTimer);
        hideHoverZoom();
    }

    let _prevHoverZoomEnabled = null;
    let _prevHoverZoomMode = null;
    let inlineZoomActiveContainer = null;
    let inlineZoomActiveImage = null;
    let inlineZoomDragData = { isDragging: false, startX: 0, startY: 0, translateX: 0, translateY: 0, didMove: false };
    let inlineZoomLevel = 1;
    let inlineZoomOriginalRect = null;
    let inlineSliderInteracting = false;

    function initHoverZoom(enabled, excludeUrlsStr, enablePin, mode) {
        hoverZoomEnabled = Boolean(enabled);
        hoverZoomMode = mode || 'popup';
        hoverZoomUpscaleSmall = true; // Always enabled
        hoverZoomEnablePin = false; // Forced false as per user request to hide all pin functionality

        const stateChanged = (_prevHoverZoomEnabled !== null && (_prevHoverZoomEnabled !== hoverZoomEnabled || _prevHoverZoomMode !== hoverZoomMode));
        const modeChanged = _prevHoverZoomMode !== null && _prevHoverZoomMode !== hoverZoomMode;

        _prevHoverZoomEnabled = hoverZoomEnabled;
        _prevHoverZoomMode = hoverZoomMode;

        // Parse exclude URLs
        if (excludeUrlsStr && typeof excludeUrlsStr === 'string') {
            hoverZoomExcludeUrls = excludeUrlsStr.split('\n').map(url => url.trim()).filter(url => url.length > 0);
        } else {
            hoverZoomExcludeUrls = [];
        }

        // Cleanup before re-initializing or when disabling
        if (modeChanged || !hoverZoomEnabled) {
            removeHoverZoomListeners();
            removeInlineZoomListeners();
            hideHoverZoom();
            removeHoverZoomPopup();
            removeHoverZoomStyles();
        }

        if (hoverZoomEnabled) {
            if (hoverZoomMode === 'inline') {
                initInlineZoom();
            } else {
                initPopupZoom();
                loadPinnedImages();
            }
        }

        syncAutoScrollHoverZoomBtn(stateChanged);
    }

    function initPopupZoom() {
        injectHoverZoomStyles();
        document.addEventListener('mouseenter', handleImageMouseEnter, true);
        document.addEventListener('mouseleave', handleImageMouseLeave, true);
        document.addEventListener('keydown', handleHoverZoomKeydown, true);
        document.addEventListener('click', handleHoverZoomClick, true);
        document.addEventListener('wheel', handleHoverZoomWheel, { passive: false, capture: true });
        document.addEventListener('mousedown', handlePanStart, true);
        document.addEventListener('mousemove', handlePanMove, true);
        document.addEventListener('mouseup', handlePanEnd, true);
        window.addEventListener('scroll', handleHoverZoomScroll, { passive: true, capture: true });
    }

    function removeHoverZoomListeners() {
        document.removeEventListener('mouseenter', handleImageMouseEnter, true);
        document.removeEventListener('mouseleave', handleImageMouseLeave, true);
        document.removeEventListener('keydown', handleHoverZoomKeydown, true);
        document.removeEventListener('click', handleHoverZoomClick, true);
        document.removeEventListener('wheel', handleHoverZoomWheel, { passive: false, capture: true });
        document.removeEventListener('mousedown', handlePanStart, true);
        document.removeEventListener('mousemove', handlePanMove, true);
        document.removeEventListener('mouseup', handlePanEnd, true);
        window.removeEventListener('scroll', handleHoverZoomScroll, { passive: true, capture: true });
    }

    function initInlineZoom() {
        document.addEventListener('mouseenter', handleInlineZoomMouseEnter, true);
        document.addEventListener('wheel', handleInlineZoomWheel, { passive: false, capture: true });
        document.addEventListener('mousedown', handleInlineZoomDragStart, true);
        document.addEventListener('mousemove', handleInlineZoomDragMove, true);
        document.addEventListener('mouseup', handleInlineZoomDragEnd, true);
        document.addEventListener('mouseleave', handleInlineZoomMouseLeave, true);
    }

    function removeInlineZoomListeners() {
        document.removeEventListener('mouseenter', handleInlineZoomMouseEnter, true);
        document.removeEventListener('wheel', handleInlineZoomWheel, { passive: false, capture: true });
        document.removeEventListener('mousedown', handleInlineZoomDragStart, true);
        document.removeEventListener('mousemove', handleInlineZoomDragMove, true);
        document.removeEventListener('mouseup', handleInlineZoomDragEnd, true);
        document.removeEventListener('mouseleave', handleInlineZoomMouseLeave, true);
        resetInlineZoom();
    }

    function handleInlineZoomMouseEnter(e) {
        if (!isHoverZoomActive() || hoverZoomMode !== 'inline') return;
        const target = e.target;
        if (target.tagName !== 'IMG') return;

        // Detect content images (galleries use smaller tiles)
        if (target.offsetWidth < 150 && !isFeedImage(target)) return;

        // Skip excluded pages
        if (isHoverZoomExcludedPage()) return;

        // Use the image itself as the zoom target — no container manipulation needed
        if (inlineZoomActiveImage === target) return;
        resetInlineZoom();

        // Capture the image's current bounding rect for clip-path calculations
        const rect = target.getBoundingClientRect();
        inlineZoomOriginalRect = { width: rect.width, height: rect.height };

        inlineZoomActiveImage = target;
        // Store a reference element for the slider (find nearest positioned ancestor)
        inlineZoomActiveContainer = target.closest('a[role="link"]') || target.parentElement;
        inlineZoomLevel = 1;
        inlineZoomDragData = { isDragging: false, startX: 0, startY: 0, translateX: 0, translateY: 0, didMove: false };

        target.style.transition = 'transform 150ms ease-out';
        target.style.cursor = 'zoom-in';
        target.style.zIndex = '5';

        // Show slider on whichever ancestor has position:relative and visible size
        let sliderHost = findSliderHost(target);
        showInlineSlider(sliderHost);
    }

    /**
     * Finds the best ancestor to host the zoom slider overlay.
     * Walks up from the image to find a positioned element with real dimensions.
     */
    function findSliderHost(img) {
        let el = img.parentElement;
        for (let i = 0; i < 6; i++) {
            if (!el || el === document.body) break;
            const cs = window.getComputedStyle(el);
            if (el.offsetWidth >= 100 && el.offsetHeight >= 100 &&
                (cs.position === 'relative' || cs.position === 'absolute')) {
                return el;
            }
            el = el.parentElement;
        }
        // Fallback: use the image's parent
        return img.parentElement;
    }

    function handleInlineZoomMouseLeave(e) {
        const target = e.target;
        if (inlineZoomActiveImage && (target === inlineZoomActiveImage || target === inlineZoomActiveContainer)) {
            const related = e.relatedTarget;
            // Stay active if we moved to a child of the same container
            if (related && inlineZoomActiveContainer && inlineZoomActiveContainer.contains(related)) return;
            if (related === inlineZoomActiveImage) return;
            resetInlineZoom();
        }
    }

    function handleInlineZoomWheel(e) {
        if (inlineSliderInteracting) return;
        if (!inlineZoomActiveImage) return;
        e.preventDefault();
        e.stopPropagation();

        const delta = e.deltaY > 0 ? -0.2 : 0.2;
        inlineZoomLevel = Math.max(1, Math.min(5, inlineZoomLevel + delta));

        updateInlineZoomTransform();
        updateInlineSlider();
    }

    function handleInlineZoomDragStart(e) {
        // Don't intercept events when user is interacting with inline zoom controls
        if (inlineSliderInteracting) return;
        if (e.target.closest && e.target.closest('#fb-toolkit-inline-zoom-slider')) return;
        if (!inlineZoomActiveImage || inlineZoomLevel <= 1) return;
        inlineZoomDragData.isDragging = true;
        inlineZoomDragData.didMove = false;
        inlineZoomDragData.startX = e.clientX - inlineZoomDragData.translateX;
        inlineZoomDragData.startY = e.clientY - inlineZoomDragData.translateY;
        inlineZoomActiveImage.style.transition = 'none';
        inlineZoomActiveImage.style.cursor = 'grabbing';
        e.preventDefault();
        e.stopPropagation();
    }

    function handleInlineZoomDragMove(e) {
        if (inlineSliderInteracting) return;
        if (!inlineZoomDragData.isDragging || !inlineZoomActiveImage) return;

        const newX = e.clientX - inlineZoomDragData.startX;
        const newY = e.clientY - inlineZoomDragData.startY;

        if (Math.abs(newX - inlineZoomDragData.translateX) > 5 || Math.abs(newY - inlineZoomDragData.translateY) > 5) {
            inlineZoomDragData.didMove = true;
        }

        inlineZoomDragData.translateX = newX;
        inlineZoomDragData.translateY = newY;
        updateInlineZoomTransform();
    }

    function handleInlineZoomDragEnd(e) {
        if (!inlineZoomDragData.isDragging) return;

        if (inlineZoomDragData.didMove) {
            const clickInterceptor = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
            };
            document.addEventListener('click', clickInterceptor, { capture: true, once: true });
            if (inlineZoomActiveImage) {
                inlineZoomActiveImage.addEventListener('click', clickInterceptor, { capture: true, once: true });
            }
        }

        inlineZoomDragData.isDragging = false;
        if (inlineZoomActiveImage) {
            inlineZoomActiveImage.style.transition = 'transform 150ms ease-out';
            inlineZoomActiveImage.style.cursor = inlineZoomLevel > 1 ? 'grab' : 'zoom-in';
        }
    }

    function updateInlineZoomTransform() {
        if (!inlineZoomActiveImage) return;
        const tx = inlineZoomDragData.translateX / inlineZoomLevel;
        const ty = inlineZoomDragData.translateY / inlineZoomLevel;
        inlineZoomActiveImage.style.transform = `scale(${inlineZoomLevel}) translate(${tx}px, ${ty}px)`;
        inlineZoomActiveImage.style.cursor = inlineZoomLevel > 1 ? 'grab' : 'zoom-in';
    }

    function resetInlineZoom() {
        if (inlineZoomActiveImage) {
            inlineZoomActiveImage.style.transform = '';
            inlineZoomActiveImage.style.transition = '';
            inlineZoomActiveImage.style.cursor = '';
            inlineZoomActiveImage.style.clipPath = '';
            inlineZoomActiveImage.style.zIndex = '';
        }
        removeInlineSlider();
        inlineZoomActiveContainer = null;
        inlineZoomActiveImage = null;
        inlineZoomOriginalRect = null;
    }

    function showInlineSlider(container) {
        removeInlineSlider();
        const controls = document.createElement('div');
        controls.id = 'fb-toolkit-inline-zoom-slider';
        Object.assign(controls.style, {
            position: 'absolute',
            bottom: '14px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(12px)',
            webkitBackdropFilter: 'blur(12px)',
            borderRadius: '24px',
            padding: '5px 12px',
            zIndex: '10',
            pointerEvents: 'auto',
            userSelect: 'none',
            opacity: '0',
            transition: 'opacity 250ms ease'
        });

        controls.innerHTML = `
            <button class="iz-zoom-out" title="Zoom Out" style="
                width:22px;height:22px;border:none;background:rgba(255,255,255,0.12);
                border-radius:50%;color:#fff;font-size:14px;font-weight:700;cursor:pointer;
                display:flex;align-items:center;justify-content:center;
                transition:background 150ms ease;padding:0;line-height:1;
            ">&minus;</button>
            <input type="range" class="iz-zoom-slider" min="1" max="5" step="0.1" value="1" style="
                width:70px;height:3px;-webkit-appearance:none;appearance:none;
                background:rgba(255,255,255,0.2);border-radius:2px;outline:none;
                cursor:pointer;margin:0;
            ">
            <button class="iz-zoom-in" title="Zoom In" style="
                width:22px;height:22px;border:none;background:rgba(255,255,255,0.12);
                border-radius:50%;color:#fff;font-size:14px;font-weight:700;cursor:pointer;
                display:flex;align-items:center;justify-content:center;
                transition:background 150ms ease;padding:0;line-height:1;
            ">+</button>
            <span class="iz-zoom-level" style="
                color:rgba(255,255,255,0.8);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                font-size:10px;font-weight:600;min-width:26px;text-align:center;user-select:none;
            ">1.0x</span>
        `;

        // Inject thumb style
        const thumbStyle = document.createElement('style');
        thumbStyle.id = 'fb-toolkit-inline-zoom-thumb-style';
        thumbStyle.textContent = `
            #fb-toolkit-inline-zoom-slider .iz-zoom-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 12px; height: 12px;
                background: #fff; border-radius: 50%;
                cursor: pointer;
                box-shadow: 0 1px 3px rgba(0,0,0,0.4);
            }
            #fb-toolkit-inline-zoom-slider button:hover {
                background: rgba(255,255,255,0.3) !important;
            }
        `;
        document.head.appendChild(thumbStyle);

        const slider = controls.querySelector('.iz-zoom-slider');
        const zoomOutBtn = controls.querySelector('.iz-zoom-out');
        const zoomInBtn = controls.querySelector('.iz-zoom-in');
        const levelText = controls.querySelector('.iz-zoom-level');

        slider.addEventListener('input', (e) => {
            e.stopPropagation();
            inlineZoomLevel = parseFloat(e.target.value);
            inlineZoomDragData.translateX = 0;
            inlineZoomDragData.translateY = 0;
            updateInlineZoomTransform();
            levelText.textContent = inlineZoomLevel.toFixed(1) + 'x';
        });

        zoomOutBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            inlineZoomLevel = Math.max(1, inlineZoomLevel - 0.5);
            slider.value = inlineZoomLevel;
            updateInlineZoomTransform();
            levelText.textContent = inlineZoomLevel.toFixed(1) + 'x';
        });

        zoomInBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            inlineZoomLevel = Math.min(5, inlineZoomLevel + 0.5);
            slider.value = inlineZoomLevel;
            updateInlineZoomTransform();
            levelText.textContent = inlineZoomLevel.toFixed(1) + 'x';
        });

        // Track when user is interacting with the controls to block image dragging
        controls.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            inlineSliderInteracting = true;
        });
        controls.addEventListener('mousemove', (e) => { if (e.buttons) e.stopPropagation(); });
        document.addEventListener('mouseup', function sliderRelease() {
            if (inlineSliderInteracting) {
                inlineSliderInteracting = false;
            }
        });

        container.appendChild(controls);

        // Fade in
        requestAnimationFrame(() => {
            controls.style.opacity = '1';
        });
    }

    function updateInlineSlider() {
        const controls = document.getElementById('fb-toolkit-inline-zoom-slider');
        if (!controls) return;
        const slider = controls.querySelector('.iz-zoom-slider');
        const levelText = controls.querySelector('.iz-zoom-level');
        if (slider) slider.value = inlineZoomLevel;
        if (levelText) levelText.textContent = inlineZoomLevel.toFixed(1) + 'x';
    }

    function removeInlineSlider() {
        const slider = document.getElementById('fb-toolkit-inline-zoom-slider');
        if (slider) slider.remove();
        const thumbStyle = document.getElementById('fb-toolkit-inline-zoom-thumb-style');
        if (thumbStyle) thumbStyle.remove();
    }

    function syncAutoScrollHoverZoomBtn(showToast) {
        const panel = document.getElementById(AUTOSCROLL_PANEL_ID);
        if (!panel) return;

        const btn = panel.querySelector('#autoscroll-hoverzoom-btn');
        const icon = panel.querySelector('#autoscroll-hoverzoom-icon');
        if (!btn || !icon) return;

        if (hoverZoomEnabled) {
            icon.innerHTML = '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>';
            btn.classList.add('active');
            btn.title = 'Disable Hover Zoom';
            btn.style.opacity = '';
        } else {
            icon.innerHTML = '<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>';
            btn.classList.remove('active');
            btn.title = 'Enable Hover Zoom';
            btn.style.opacity = '0.5';
        }

        btn.style.pointerEvents = '';

        // Also sync the hoverzoom popup controls if they exist
        const hzToggle = panel.querySelector('#autoscroll-hz-enable-toggle');
        if (hzToggle) hzToggle.checked = hoverZoomEnabled;
        const hzModeBtns = panel.querySelectorAll('.hz-mode-btn');
        hzModeBtns.forEach(b => b.classList.toggle('active', b.dataset.hzMode === hoverZoomMode));

        if (showToast) {
            showHoverZoomToast(!hoverZoomEnabled);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // AUTO SCROLL PANEL SYNC — Keep controller UI in sync with popup settings
    // ══════════════════════════════════════════════════════════════════════════

    function syncAutoScrollPanelState() {
        const panel = document.getElementById(AUTOSCROLL_PANEL_ID);
        if (!panel) return;

        const settings = getHomepageSettings();

        // ── Sync Layout Toggles ──
        const layoutFeatures = [
            'HIDE_LEFT_SIDEBAR', 'HIDE_RIGHT_SIDEBAR', 'HIDE_NAV_BAR',
            'HIDE_REELS', 'HIDE_SUGGESTIONS', 'HIDE_PEOPLE_YOU_MAY_KNOW',
            'HIDE_WHATS_ON_YOUR_MIND', 'HIDE_STORIES'
        ];

        layoutFeatures.forEach(feature => {
            const toggle = panel.querySelector(`input[data-layout="${feature}"]`);
            if (toggle) {
                toggle.checked = Boolean(settings[feature]?.enable);
            }
        });

        // ── Sync Theme Toggle ──
        const themeToggle = panel.querySelector('#autoscroll-theme-toggle');
        if (themeToggle) {
            themeToggle.checked = Boolean(settings.FEED_BACKGROUND?.enable);
        }

        // ── Sync Theme Grid Active States ──
        const currentBg = settings.FEED_BACKGROUND || {};
        panel.querySelectorAll('.autoscroll-theme-item').forEach(item => {
            // Find the gradient ID from the class (e.g., 'thumb-cosmic' -> 'cosmic')
            const classes = Array.from(item.classList);
            const thumbClass = classes.find(c => c.startsWith('thumb-'));
            const gradientId = thumbClass ? thumbClass.replace('thumb-', '') : null;
            const isActive = currentBg.enable && gradientId && currentBg.gradient === gradientId && !currentBg.wallpaper;
            item.classList.toggle('active', isActive);
        });

        panel.querySelectorAll('.autoscroll-wallpaper-item').forEach(item => {
            // Wallpaper items have the URL in their background-image style
            const bgStyle = item.style.backgroundImage || '';
            const isActive = currentBg.enable && currentBg.wallpaper && bgStyle.includes(currentBg.wallpaper.substring(0, 60));
            item.classList.toggle('active', isActive);
        });

        // ── Sync Particle Select ──
        const particleSelect = panel.querySelector('#autoscroll-particle-select');
        if (particleSelect) {
            particleSelect.value = settings.PARTICLE_PATTERN?.pattern || 'none';
        }

        // ── Sync Blur Slider ──
        const blurSlider = panel.querySelector('#autoscroll-blur-slider');
        const blurValue = panel.querySelector('#autoscroll-blur-value');
        if (blurSlider) {
            const blurAmount = settings.WALLPAPER_BLUR_INTENSITY?.amount || 0;
            blurSlider.value = blurAmount;
            if (blurValue) blurValue.textContent = blurAmount + 'px';
        }

        // ── Sync Feed Width Slider ──
        const widthSlider = panel.querySelector('#autoscroll-width-slider');
        const widthValue = panel.querySelector('#autoscroll-width-value');
        if (widthSlider) {
            const feedWidth = settings.FEED_WIDTH?.width || 60;
            widthSlider.value = feedWidth;
            if (widthValue) widthValue.textContent = feedWidth + '%';
        }

        // ── Sync Speed Slider ──
        const speedSlider = panel.querySelector('#autoscroll-speed-slider');
        const speedVal = panel.querySelector('#autoscroll-speed-val');
        if (speedSlider) {
            const speed = settings.AUTO_SCROLL?.speed || 2;
            speedSlider.value = speed;
            if (speedVal) speedVal.textContent = speed + 'x';
        }

        // ── Sync Hover Zoom ──
        syncAutoScrollHoverZoomBtn(false);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // AUTO SCROLL FEATURE
    // ══════════════════════════════════════════════════════════════════════════

    function manageAutoScrollPanel() {
        const settings = getHomepageSettings();
        const enabled = settings.AUTO_SCROLL?.enable && isHomepage();
        const panel = document.getElementById(AUTOSCROLL_PANEL_ID);

        if (!enabled) {
            // Clean up
            if (panel) panel.remove();
            if (autoScrollIntervalId) {
                cancelAnimationFrame(autoScrollIntervalId);
                autoScrollIntervalId = null;
            }
            autoScrollActive = false;
            autoScrollPanelHidden = false;
            // Also remove re-open FAB if the feature was disabled from popup
            const fab = document.getElementById('fb-toolkit-reopen-fab');
            if (fab) fab.remove();
            return;
        }

        // If user manually hid the panel via close button, don't recreate it
        if (autoScrollPanelHidden && !panel) {
            return;
        }

        if (!panel) {
            // Create the panel
            const el = document.createElement('div');
            el.id = AUTOSCROLL_PANEL_ID;

            const speed = settings.AUTO_SCROLL?.speed || 2;

            el.innerHTML = `
                <button id="autoscroll-toggle-btn" title="Play / Pause Auto Scroll">
                    <svg viewBox="0 0 24 24" id="autoscroll-icon-play"><polygon points="6,4 20,12 6,20"/></svg>
                </button>
                <div class="autoscroll-divider"></div>
                <div style="position: relative;">
                    <button id="autoscroll-speed-btn" title="Adjust Scroll Speed">
                        <svg viewBox="0 0 24 24"><path d="M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.28-10.43zM10.5 15a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm9.13-10.36L15 8.13L13.5 6.63l4.64-4.64a.5.5 0 0 1 .7.7z"/></svg>
                    </button>
                    <div class="autoscroll-speed-popup" id="autoscroll-speed-popup">
                        <div class="autoscroll-speed-val" id="autoscroll-speed-val">${speed}x</div>
                        <input type="range" class="autoscroll-speed-slider" id="autoscroll-speed-slider" min="0.5" max="10" step="0.5" value="${speed}">
                    </div>
                </div>
                <div class="autoscroll-divider"></div>
                <button id="autoscroll-theme-btn" title="Change Theme">
                    <svg viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
                </button>
                <div class="autoscroll-theme-popup" id="autoscroll-theme-popup">
                    <div class="autoscroll-toggle-row">
                        <span class="autoscroll-toggle-label">Theme</span>
                        <label class="autoscroll-toggle">
                            <input type="checkbox" id="autoscroll-theme-toggle">
                            <span class="autoscroll-toggle-track"></span>
                        </label>
                    </div>
                    <div class="autoscroll-theme-title">Gradients</div>
                    <div class="autoscroll-theme-grid" id="autoscroll-gradient-grid"></div>
                    <div class="autoscroll-theme-title" style="margin-top:8px;padding-top:4px;">Wallpapers</div>
                    <div class="autoscroll-wallpaper-grid" id="autoscroll-wallpaper-grid"></div>
                    <div class="autoscroll-particle-section">
                        <span class="autoscroll-particle-label">Particles</span>
                        <select class="autoscroll-particle-select" id="autoscroll-particle-select">
                            <option value="none">None</option>
                            <option value="bubbles">Floating Bubbles</option>
                            <option value="stars">Rising Stars</option>
                            <option value="snow">Snowfall</option>
                            <option value="rain">Rain</option>
                            <option value="fireflies">Fireflies</option>
                        </select>
                    </div>
                    <div class="autoscroll-blur-section" id="autoscroll-blur-section">
                        <div class="autoscroll-blur-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <span class="autoscroll-blur-label">Blur</span>
                            <span class="autoscroll-blur-value" id="autoscroll-blur-value">0px</span>
                        </div>
                        <input type="range" class="autoscroll-blur-slider" id="autoscroll-blur-slider" min="0" max="40" value="0" step="1">
                    </div>

                </div>
                <div class="autoscroll-divider"></div>
                <div style="position: relative;">
                    <button id="autoscroll-layout-btn" title="Layout Settings">
                        <svg viewBox="0 0 24 24"><path d="M3 3h8v8H3V3zm0 10h8v8H3v-8zm10-10h8v8h-8V3zm0 10h8v8h-8v-8zM5 5v4h4V5H5zm0 10v4h4v-4H5zm10-10v4h4V5h-4zm0 10v4h4v-4h-4z"/></svg>
                    </button>
                    <div class="autoscroll-layout-popup" id="autoscroll-layout-popup">
                        <div class="autoscroll-layout-title">Layout Controls</div>
                        <div class="autoscroll-layout-row">
                            <span class="autoscroll-layout-label">Hide Left Sidebar</span>
                            <label class="autoscroll-layout-toggle">
                                <input type="checkbox" data-layout="HIDE_LEFT_SIDEBAR">
                                <span class="autoscroll-layout-track"></span>
                            </label>
                        </div>
                        <div class="autoscroll-layout-row">
                            <span class="autoscroll-layout-label">Hide Right Sidebar</span>
                            <label class="autoscroll-layout-toggle">
                                <input type="checkbox" data-layout="HIDE_RIGHT_SIDEBAR">
                                <span class="autoscroll-layout-track"></span>
                            </label>
                        </div>
                        <div class="autoscroll-layout-row">
                            <span class="autoscroll-layout-label">Hide Nav Bar</span>
                            <label class="autoscroll-layout-toggle">
                                <input type="checkbox" data-layout="HIDE_NAV_BAR">
                                <span class="autoscroll-layout-track"></span>
                            </label>
                        </div>
                        <div class="autoscroll-layout-row">
                            <span class="autoscroll-layout-label">Hide Reels</span>
                            <label class="autoscroll-layout-toggle">
                                <input type="checkbox" data-layout="HIDE_REELS">
                                <span class="autoscroll-layout-track"></span>
                            </label>
                        </div>
                        <div class="autoscroll-layout-row">
                            <span class="autoscroll-layout-label">Hide Suggestions</span>
                            <label class="autoscroll-layout-toggle">
                                <input type="checkbox" data-layout="HIDE_SUGGESTIONS">
                                <span class="autoscroll-layout-track"></span>
                            </label>
                        </div>
                        <div class="autoscroll-layout-row">
                            <span class="autoscroll-layout-label">Hide People You May Know</span>
                            <label class="autoscroll-layout-toggle">
                                <input type="checkbox" data-layout="HIDE_PEOPLE_YOU_MAY_KNOW">
                                <span class="autoscroll-layout-track"></span>
                            </label>
                        </div>
                        <div class="autoscroll-layout-row">
                            <span class="autoscroll-layout-label">Hide What's on Your Mind</span>
                            <label class="autoscroll-layout-toggle">
                                <input type="checkbox" data-layout="HIDE_WHATS_ON_YOUR_MIND">
                                <span class="autoscroll-layout-track"></span>
                            </label>
                        </div>
                        <div class="autoscroll-layout-row">
                            <span class="autoscroll-layout-label">Hide Stories</span>
                            <label class="autoscroll-layout-toggle">
                                <input type="checkbox" data-layout="HIDE_STORIES">
                                <span class="autoscroll-layout-track"></span>
                            </label>
                        </div>
                        <div class="autoscroll-layout-note" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08);"></div>
                        <div class="autoscroll-width-section" id="autoscroll-width-section">
                            <div class="autoscroll-width-header">
                                <span class="autoscroll-width-label">Feed Width</span>
                                <div class="autoscroll-width-value-container">
                                    <button id="autoscroll-width-reset-btn" class="autoscroll-width-reset" title="Restore to Default (60%)">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                                    </button>
                                    <span class="autoscroll-width-value" id="autoscroll-width-value">${settings.FEED_WIDTH?.width || 60}%</span>
                                </div>
                            </div>
                            <input type="range" class="autoscroll-width-slider" id="autoscroll-width-slider" min="50" max="100" value="${settings.FEED_WIDTH?.width || 100}" step="5">
                        </div>
                        <div class="autoscroll-layout-note">Homepage layout only</div>
                    </div>
                </div>
                <div class="autoscroll-divider"></div>
                <div style="position: relative;">
                <button id="autoscroll-hoverzoom-btn" title="Toggle Hover Zoom" class="${hoverZoomEnabled ? 'active' : ''}">
                    <svg viewBox="0 0 24 24" id="autoscroll-hoverzoom-icon">${!hoverZoomEnabled ? '<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>' : '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>'}</svg>
                </button>
                    <div class="autoscroll-hoverzoom-popup" id="autoscroll-hoverzoom-popup">
                        <div class="hz-popup-header">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="color:#3b82f6;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            <div class="hz-popup-title">Hover Zoom</div>
                        </div>
                        <div class="hz-popup-row">
                            <span class="hz-popup-label">Enable Feature</span>
                            <label class="autoscroll-layout-toggle">
                                <input type="checkbox" id="autoscroll-hz-enable-toggle" ${hoverZoomEnabled ? 'checked' : ''}>
                                <span class="autoscroll-layout-track"></span>
                            </label>
                        </div>
                        <div class="hz-mode-container">
                            <span class="hz-popup-label">Interaction Mode</span>
                            <div class="hz-mode-control">
                                <button class="hz-mode-btn ${hoverZoomMode === 'popup' ? 'active' : ''}" data-hz-mode="popup">Popup</button>
                                <button class="hz-mode-btn ${hoverZoomMode === 'inline' ? 'active' : ''}" data-hz-mode="inline">Inline</button>
                            </div>
                            <div class="hz-mode-desc" id="autoscroll-hz-mode-desc">
                                ${hoverZoomMode === 'popup' ? 'Opens a floating preview window' : 'Zoom and pan directly in the feed'}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="autoscroll-divider"></div>
                <button id="autoscroll-refresh-btn" title="Refresh Page">
                    <svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                </button>
                <button id="autoscroll-top-btn" title="Scroll to Top">
                    <svg viewBox="0 0 24 24"><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/></svg>
                </button>
                <button class="autoscroll-close-btn" id="autoscroll-close-btn" title="Close Controller">
                    <svg viewBox="0 0 24 24"><path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/></svg>
                </button>
            `;

            document.body.appendChild(el);

            // ── Theme Pop Logic ──
            const themeBtn = el.querySelector('#autoscroll-theme-btn');
            const themePopup = el.querySelector('#autoscroll-theme-popup');
            const gradientGrid = el.querySelector('#autoscroll-gradient-grid');
            const wallpaperGrid = el.querySelector('#autoscroll-wallpaper-grid');

            const gradientThemes = [
                { id: 'cosmic', class: 'thumb-cosmic', title: 'Cosmic' },
                { id: 'ocean', class: 'thumb-ocean', title: 'Ocean' },
                { id: 'sunset', class: 'thumb-sunset', title: 'Sunset' },
                { id: 'aurora', class: 'thumb-aurora', title: 'Aurora' },
                { id: 'midnight', class: 'thumb-midnight', title: 'Midnight' },
                { id: 'forest', class: 'thumb-forest', title: 'Forest' },
                { id: 'rose', class: 'thumb-rose', title: 'Rose' },
                { id: 'dark', class: 'thumb-dark', title: 'Dark' },
                { id: 'sky', class: 'thumb-sky', title: 'Sky' },
                { id: 'cloud', class: 'thumb-cloud', title: 'Cloud' },
                { id: 'mint', class: 'thumb-mint', title: 'Mint' },
                { id: 'lavender', class: 'thumb-lavender', title: 'Lavender' },
                { id: 'lemon', class: 'thumb-lemon', title: 'Lemon' },
                { id: 'sakura', class: 'thumb-sakura', title: 'Sakura' },
                { id: 'ivory', class: 'thumb-ivory', title: 'Ivory' }
            ];

            const natureWallpapers = [
                { id: 'leaves', title: 'Nature Leaves', url: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&w=400&q=80' },
                { id: 'forest-vibe', title: 'Deep Forest', url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=400&q=80' },
                { id: 'mountain', title: 'Misty Peaks', url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=400&q=80' },
                { id: 'lake', title: 'Serene Lake', url: 'https://images.unsplash.com/photo-1439853949127-fa647821eba0?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1439853949127-fa647821eba0?auto=format&fit=crop&w=400&q=80' },
                { id: 'autumn', title: 'Autumn Glow', url: 'https://images.unsplash.com/photo-1523712999610-f77fbcfc3843?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1523712999610-f77fbcfc3843?auto=format&fit=crop&w=400&q=80' },
                { id: 'waterfall', title: 'Wild Falls', url: 'https://images.unsplash.com/photo-1432405972618-c60b0225b8f9?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1432405972618-c60b0225b8f9?auto=format&fit=crop&w=400&q=80' },
                { id: 'beach', title: 'Sunset Beach', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=400&q=80' },
                { id: 'flowers', title: 'Spring Flowers', url: 'https://images.unsplash.com/photo-1559150180-a0b6c0a1193d?auto=format&fit=crop&w=1920&q=90', thumb: 'https://images.unsplash.com/photo-1559150180-a0b6c0a1193d?auto=format&fit=crop&w=400&q=80' }
            ];

            function renderThemeItem(container, theme, isWallpaper = false) {
                const item = document.createElement('div');
                if (isWallpaper) {
                    item.className = 'autoscroll-wallpaper-item';
                    item.style.backgroundImage = `url('${theme.thumb}')`;
                    item.setAttribute('data-label', theme.title);
                } else {
                    item.className = 'autoscroll-theme-item ' + (theme.class || '');
                }
                item.title = theme.title;

                // Check active state
                const current = settings.FEED_BACKGROUND || {};
                const currentGradient = current.gradient;
                const currentWallpaper = current.wallpaper;

                let isActive = false;
                if (current.enable) {
                    if (isWallpaper) {
                        isActive = (currentWallpaper === theme.url);
                    } else {
                        isActive = (currentGradient === theme.id && !current.wallpaper);
                    }
                }

                if (isActive) item.classList.add('active');

                item.addEventListener('click', (e) => {
                    e.stopPropagation();

                    if (!window.fb_toolkit.homepage.FEED_BACKGROUND) {
                        window.fb_toolkit.homepage.FEED_BACKGROUND = {};
                    }
                    const updated = window.fb_toolkit.homepage.FEED_BACKGROUND;
                    updated.enable = true;

                    if (isWallpaper) {
                        updated.gradient = null;
                        updated.wallpaper = theme.url;
                    } else {
                        updated.gradient = theme.id;
                        updated.wallpaper = null;
                    }

                    // Update UI active state (clear both gradient and wallpaper items)
                    el.querySelectorAll('.autoscroll-theme-item, .autoscroll-wallpaper-item').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');

                    // Apply immediately
                    applyStyles();

                    // Persist
                    window.postMessage({
                        __fbToolkit: true,
                        type: 'UPDATE_SETTING',
                        payload: { category: 'homepage', feature: 'FEED_BACKGROUND', value: updated }
                    }, '*');
                });

                container.appendChild(item);
            }

            gradientThemes.forEach(t => renderThemeItem(gradientGrid, t, false));
            natureWallpapers.forEach(w => renderThemeItem(wallpaperGrid, w, true));

            // ── Theme Toggle Logic ──
            const themeToggle = el.querySelector('#autoscroll-theme-toggle');
            themeToggle.checked = Boolean(settings.FEED_BACKGROUND?.enable);

            themeToggle.addEventListener('change', (e) => {
                e.stopPropagation();
                const isOn = themeToggle.checked;

                if (!window.fb_toolkit.homepage.FEED_BACKGROUND) {
                    window.fb_toolkit.homepage.FEED_BACKGROUND = { enable: false, gradient: 'cosmic', wallpaper: null };
                }
                window.fb_toolkit.homepage.FEED_BACKGROUND.enable = isOn;

                applyStyles();

                window.postMessage({
                    __fbToolkit: true,
                    type: 'UPDATE_SETTING',
                    payload: { category: 'homepage', feature: 'FEED_BACKGROUND', value: window.fb_toolkit.homepage.FEED_BACKGROUND }
                }, '*');
            });

            // ── Particle Dropdown Logic ──
            const particleSelect = el.querySelector('#autoscroll-particle-select');
            const currentParticle = settings.PARTICLE_PATTERN?.pattern || 'none';
            particleSelect.value = currentParticle;

            particleSelect.addEventListener('change', (e) => {
                e.stopPropagation();
                const pattern = particleSelect.value;

                if (!window.fb_toolkit.homepage.PARTICLE_PATTERN) {
                    window.fb_toolkit.homepage.PARTICLE_PATTERN = { pattern: 'none' };
                }
                window.fb_toolkit.homepage.PARTICLE_PATTERN.pattern = pattern;

                applyStyles();

                window.postMessage({
                    __fbToolkit: true,
                    type: 'UPDATE_SETTING',
                    payload: { category: 'homepage', feature: 'PARTICLE_PATTERN', value: { pattern: pattern } }
                }, '*');
            });

            // ── Blur Slider Logic ──
            const blurSlider = el.querySelector('#autoscroll-blur-slider');
            const blurValue = el.querySelector('#autoscroll-blur-value');
            const currentBlur = settings.WALLPAPER_BLUR_INTENSITY?.amount || 0;
            blurSlider.value = currentBlur;
            blurValue.textContent = currentBlur + 'px';

            blurSlider.addEventListener('input', (e) => {
                const val = Number(blurSlider.value);
                blurValue.textContent = val + 'px';

                if (!window.fb_toolkit.homepage.WALLPAPER_BLUR_INTENSITY) {
                    window.fb_toolkit.homepage.WALLPAPER_BLUR_INTENSITY = { amount: 0 };
                }
                window.fb_toolkit.homepage.WALLPAPER_BLUR_INTENSITY.amount = val;

                applyStyles();

                window.postMessage({
                    __fbToolkit: true,
                    type: 'UPDATE_SETTING',
                    payload: { category: 'homepage', feature: 'WALLPAPER_BLUR_INTENSITY', value: { amount: val } }
                }, '*');
            });

            // ── Width Slider Logic ──
            const widthSlider = el.querySelector('#autoscroll-width-slider');
            const widthValue = el.querySelector('#autoscroll-width-value');
            let widthDebounceTimer = null;

            if (widthSlider) {
                widthSlider.addEventListener('input', (e) => {
                    const val = Number(widthSlider.value);
                    widthValue.textContent = val + '%';

                    if (!window.fb_toolkit.homepage.FEED_WIDTH) {
                        window.fb_toolkit.homepage.FEED_WIDTH = { width: 100 };
                    }
                    window.fb_toolkit.homepage.FEED_WIDTH.width = val;

                    // Also ensure FULL_WIDTH_FEED is enabled
                    if (!window.fb_toolkit.homepage.FULL_WIDTH_FEED) {
                        window.fb_toolkit.homepage.FULL_WIDTH_FEED = { enable: false };
                    }
                    window.fb_toolkit.homepage.FULL_WIDTH_FEED.enable = true;

                    // Smooth: update CSS custom property directly instead of rebuilding stylesheet
                    document.documentElement.style.setProperty('--fb-feed-width', val + '%');

                    // Debounce the full style rebuild and settings persistence
                    clearTimeout(widthDebounceTimer);
                    widthDebounceTimer = setTimeout(() => {
                        applyStyles();

                        // Send FEED_WIDTH first, then FULL_WIDTH_FEED after a delay
                        // to avoid race condition in bridge.js where simultaneous
                        // GET_SETTINGS calls return stale data and overwrite each other
                        window.postMessage({
                            __fbToolkit: true,
                            type: 'UPDATE_SETTING',
                            payload: { category: 'homepage', feature: 'FEED_WIDTH', value: { width: val } }
                        }, '*');

                        setTimeout(() => {
                            window.postMessage({
                                __fbToolkit: true,
                                type: 'UPDATE_SETTING',
                                payload: { category: 'homepage', feature: 'FULL_WIDTH_FEED', value: { enable: true } }
                            }, '*');
                        }, 150);
                    }, 250);
                });

                const widthResetBtn = el.querySelector('#autoscroll-width-reset-btn');
                if (widthResetBtn) {
                    widthResetBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const defaultVal = 60;
                        widthSlider.value = defaultVal;
                        widthValue.textContent = defaultVal + '%';

                        if (!window.fb_toolkit.homepage.FEED_WIDTH) {
                            window.fb_toolkit.homepage.FEED_WIDTH = { width: 60 };
                        }
                        window.fb_toolkit.homepage.FEED_WIDTH.width = defaultVal;

                        // Smooth: update CSS custom property directly
                        document.documentElement.style.setProperty('--fb-feed-width', defaultVal + '%');

                        applyStyles();

                        window.postMessage({
                            __fbToolkit: true,
                            type: 'UPDATE_SETTING',
                            payload: { category: 'homepage', feature: 'FEED_WIDTH', value: { width: defaultVal } }
                        }, '*');
                    });
                }
            }

            let themePopupTimer;
            const showThemePopup = () => {
                clearTimeout(themePopupTimer);
                themePopup.classList.add('visible');
            };
            const hideThemePopup = () => {
                themePopupTimer = setTimeout(() => {
                    themePopup.classList.remove('visible');
                }, 300);
            };

            themeBtn.addEventListener('mouseenter', showThemePopup);
            themeBtn.addEventListener('mouseleave', hideThemePopup);
            themePopup.addEventListener('mouseenter', showThemePopup);
            themePopup.addEventListener('mouseleave', hideThemePopup);

            // ── Layout Pop Logic ──
            const layoutBtn = el.querySelector('#autoscroll-layout-btn');
            const layoutPopup = el.querySelector('#autoscroll-layout-popup');

            // Set initial toggle states from saved settings
            const layoutFeatures = [
                'HIDE_LEFT_SIDEBAR', 'HIDE_RIGHT_SIDEBAR', 'HIDE_NAV_BAR',
                'HIDE_REELS', 'HIDE_SUGGESTIONS', 'HIDE_PEOPLE_YOU_MAY_KNOW',
                'HIDE_WHATS_ON_YOUR_MIND', 'HIDE_STORIES'
            ];

            layoutFeatures.forEach(feature => {
                const toggle = layoutPopup.querySelector(`input[data-layout="${feature}"]`);
                if (toggle) {
                    toggle.checked = Boolean(settings[feature]?.enable);

                    toggle.addEventListener('change', (e) => {
                        e.stopPropagation();
                        const isOn = toggle.checked;

                        if (!window.fb_toolkit.homepage[feature]) {
                            window.fb_toolkit.homepage[feature] = { enable: false };
                        }
                        window.fb_toolkit.homepage[feature].enable = isOn;

                        applyStyles();

                        window.postMessage({
                            __fbToolkit: true,
                            type: 'UPDATE_SETTING',
                            payload: { category: 'homepage', feature: feature, value: { enable: isOn } }
                        }, '*');
                    });
                }
            });

            let layoutPopupTimer;
            const showLayoutPopup = () => {
                clearTimeout(layoutPopupTimer);
                layoutPopup.classList.add('visible');
            };
            const hideLayoutPopup = () => {
                layoutPopupTimer = setTimeout(() => {
                    layoutPopup.classList.remove('visible');
                }, 300);
            };

            layoutBtn.addEventListener('mouseenter', showLayoutPopup);
            layoutBtn.addEventListener('mouseleave', hideLayoutPopup);
            layoutPopup.addEventListener('mouseenter', showLayoutPopup);
            layoutPopup.addEventListener('mouseleave', hideLayoutPopup);

            // ── Speed Pop Logic ──
            const speedBtn = el.querySelector('#autoscroll-speed-btn');
            const speedPopup = el.querySelector('#autoscroll-speed-popup');
            const speedSlider = el.querySelector('#autoscroll-speed-slider');
            const speedVal = el.querySelector('#autoscroll-speed-val');

            let speedPopupTimer;
            const showSpeedPopup = () => {
                clearTimeout(speedPopupTimer);
                speedPopup.classList.add('visible');
            };
            const hideSpeedPopup = () => {
                speedPopupTimer = setTimeout(() => {
                    speedPopup.classList.remove('visible');
                }, 300);
            };

            speedBtn.addEventListener('mouseenter', showSpeedPopup);
            speedBtn.addEventListener('mouseleave', hideSpeedPopup);
            speedPopup.addEventListener('mouseenter', showSpeedPopup);
            speedPopup.addEventListener('mouseleave', hideSpeedPopup);

            // ── Restore saved position ──
            const savedPos = settings.AUTO_SCROLL?.panelPosition;
            let userMovedPanel = false;
            if (savedPos && savedPos.left != null && savedPos.top != null) {
                userMovedPanel = true;
                el.style.setProperty('transform', 'none', 'important');
                el.style.setProperty('left', savedPos.left + 'px', 'important');
                el.style.setProperty('top', savedPos.top + 'px', 'important');
            }

            // ── Draggable Panel Logic ──
            let isDragging = false;
            let dragStarted = false;
            let startX, startY;
            let initialLeft, initialTop;
            const DRAG_THRESHOLD = 4; // pixels of movement before drag kicks in

            el.addEventListener('mousedown', (e) => {
                // Don't drag from inputs, selects, or popups
                if (e.target.closest('input, select, .autoscroll-theme-popup, .autoscroll-speed-popup, .autoscroll-layout-popup, .autoscroll-hoverzoom-popup')) return;

                isDragging = true;
                dragStarted = false;
                startX = e.clientX;
                startY = e.clientY;
                const rect = el.getBoundingClientRect();
                initialLeft = rect.left;
                initialTop = rect.top;

                e.preventDefault();
                e.stopPropagation();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;

                const dx = e.clientX - startX;
                const dy = e.clientY - startY;

                // Only start visual drag after threshold
                if (!dragStarted) {
                    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
                    dragStarted = true;
                    // Disable transition for smooth dragging
                    el.style.setProperty('transition', 'none', 'important');
                    // Remove the centering transform
                    el.style.setProperty('transform', 'none', 'important');
                }

                el.style.setProperty('left', (initialLeft + dx) + 'px', 'important');
                el.style.setProperty('top', (initialTop + dy) + 'px', 'important');

                userMovedPanel = true;
                e.preventDefault();
            });

            document.addEventListener('mouseup', (e) => {
                if (!isDragging) return;
                const wasDragging = dragStarted;
                isDragging = false;
                dragStarted = false;

                if (wasDragging) {
                    // Re-enable hover transitions (but not position)
                    el.style.setProperty('transition', 'opacity 250ms ease, background 250ms ease, border-color 250ms ease', 'important');
                    // Suppress the click that follows mouseup so buttons don't fire
                    const suppressClick = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
                    el.addEventListener('click', suppressClick, { capture: true, once: true });

                    // Save position to extension storage
                    const finalRect = el.getBoundingClientRect();
                    const posData = { left: Math.round(finalRect.left), top: Math.round(finalRect.top) };

                    if (!window.fb_toolkit.homepage.AUTO_SCROLL) {
                        window.fb_toolkit.homepage.AUTO_SCROLL = {};
                    }
                    window.fb_toolkit.homepage.AUTO_SCROLL.panelPosition = posData;

                    window.postMessage({
                        __fbToolkit: true,
                        type: 'UPDATE_SETTING',
                        payload: { category: 'homepage', feature: 'AUTO_SCROLL', value: window.fb_toolkit.homepage.AUTO_SCROLL }
                    }, '*');
                }
            });

            // ── Position panel to left of post cards ──
            function positionPanel() {
                if (userMovedPanel) return; // Respect user's manual placement

                // Find any post card or the main feed container
                const ref = document.querySelector('div[role="article"]') ||
                    document.querySelector('div[role="main"]') ||
                    document.querySelector('[data-pagelet="MainFeed"]');

                if (ref) {
                    const rect = ref.getBoundingClientRect();
                    const refLeft = rect.left;

                    // If there's a significant gap from the left browser edge, 
                    // stick to the left edge of the posts.
                    if (refLeft > 60) {
                        // Position slightly inset from the left edge of the post cards (12px)
                        el.style.left = (refLeft + 12) + 'px';
                        return;
                    }
                }
                // Fallback for narrow viewports or if no posts are found
                el.style.left = '12px';
            }
            positionPanel();

            // Keep repositioning as FB loads / resizes
            const posInterval = setInterval(() => {
                if (!document.getElementById(AUTOSCROLL_PANEL_ID)) { clearInterval(posInterval); return; }
                positionPanel();
            }, 500);
            window.addEventListener('resize', positionPanel, { passive: true });

            // ── Close button — hide panel & show re-open FAB ──
            const closeBtn = el.querySelector('#autoscroll-close-btn');
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                autoScrollActive = false;
                if (autoScrollIntervalId) {
                    cancelAnimationFrame(autoScrollIntervalId);
                    autoScrollIntervalId = null;
                }
                el.remove();
                clearInterval(posInterval);
                window.removeEventListener('resize', positionPanel);

                // DON'T disable AUTO_SCROLL in storage — just hide for this view
                // Mark as hidden so manageAutoScrollPanel won't recreate it
                autoScrollPanelHidden = true;

                applyStyles();
                showReopenFab();
                showAutoScrollToast();
            });

            // ── Refresh button ──
            const refreshBtn = el.querySelector('#autoscroll-refresh-btn');
            refreshBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.location.reload();
            });

            // ── Hover Zoom popup + button ──
            const hoverZoomBtn = el.querySelector('#autoscroll-hoverzoom-btn');
            const hoverZoomIcon = el.querySelector('#autoscroll-hoverzoom-icon');
            const hoverZoomPopup = el.querySelector('#autoscroll-hoverzoom-popup');
            const hzEnableToggle = el.querySelector('#autoscroll-hz-enable-toggle');
            const hzModeBtns = Array.from(el.querySelectorAll('.hz-mode-btn'));

            function updateHoverZoomBtnIcon() {
                if (!hoverZoomEnabled) {
                    hoverZoomIcon.innerHTML = '<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>';
                    hoverZoomBtn.classList.remove('active');
                    hoverZoomBtn.title = 'Enable Hover Zoom';
                } else {
                    hoverZoomIcon.innerHTML = '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>';
                    hoverZoomBtn.classList.add('active');
                    hoverZoomBtn.title = 'Disable Hover Zoom';
                }
                // Sync the popup toggle
                if (hzEnableToggle) hzEnableToggle.checked = hoverZoomEnabled;
                // Sync mode buttons
                hzModeBtns.forEach(b => b.classList.toggle('active', b.dataset.hzMode === hoverZoomMode));
                // Sync description
                const desc = el.querySelector('#autoscroll-hz-mode-desc');
                if (desc) {
                    desc.textContent = hoverZoomMode === 'popup'
                        ? 'Opens a floating preview window'
                        : 'Zoom and pan directly in the feed';
                }
            }

            function applyHoverZoomChange() {
                if (!window.fb_toolkit.homepage.HOVER_ZOOM) {
                    window.fb_toolkit.homepage.HOVER_ZOOM = { enable: false };
                }
                window.fb_toolkit.homepage.HOVER_ZOOM.enable = hoverZoomEnabled;
                window.fb_toolkit.homepage.HOVER_ZOOM.mode = hoverZoomMode;

                syncAutoScrollHoverZoomBtn(true);

                if (!hoverZoomEnabled) {
                    hideHoverZoom();
                }

                window.postMessage({
                    __fbToolkit: true,
                    type: 'UPDATE_SETTING',
                    payload: { category: 'homepage', feature: 'HOVER_ZOOM', value: window.fb_toolkit.homepage.HOVER_ZOOM }
                }, '*');
            }

            // Click on main button toggles hover zoom
            hoverZoomBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                hoverZoomEnabled = !hoverZoomEnabled;
                applyHoverZoomChange();
            });

            // Enable toggle in popup
            hzEnableToggle.addEventListener('change', (e) => {
                e.stopPropagation();
                hoverZoomEnabled = hzEnableToggle.checked;
                applyHoverZoomChange();
            });

            // Mode buttons in popup
            hzModeBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    hoverZoomMode = btn.dataset.hzMode;
                    hzModeBtns.forEach(b => b.classList.toggle('active', b === btn));

                    // Update description
                    const desc = el.querySelector('#autoscroll-hz-mode-desc');
                    if (desc) {
                        desc.textContent = hoverZoomMode === 'popup'
                            ? 'Opens a floating preview window'
                            : 'Zoom and pan directly in the feed';
                    }

                    applyHoverZoomChange();
                });
            });

            // Hover to show/hide popup
            let hzPopupTimer;
            const showHzPopup = () => {
                clearTimeout(hzPopupTimer);
                hoverZoomPopup.classList.add('visible');
                // Sync state when popup opens
                updateHoverZoomBtnIcon();
            };
            const hideHzPopup = () => {
                hzPopupTimer = setTimeout(() => {
                    hoverZoomPopup.classList.remove('visible');
                }, 300);
            };

            hoverZoomBtn.addEventListener('mouseenter', showHzPopup);
            hoverZoomBtn.addEventListener('mouseleave', hideHzPopup);
            hoverZoomPopup.addEventListener('mouseenter', showHzPopup);
            hoverZoomPopup.addEventListener('mouseleave', hideHzPopup);

            // Set initial state
            syncAutoScrollHoverZoomBtn(false);

            // ── Scroll to top button ──
            const topBtn = el.querySelector('#autoscroll-top-btn');
            topBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Pause autoscroll if active
                if (autoScrollActive) {
                    stopScrolling();
                    userPaused = true;
                }
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });

            // Toggle play/pause
            const toggleBtn = el.querySelector('#autoscroll-toggle-btn');
            const iconEl = el.querySelector('#autoscroll-icon-play');

            let currentSpeed = speed;
            let userPaused = false;

            function updateSpeedDisplay() {
                const displayVal = (currentSpeed % 1 === 0 ? currentSpeed.toFixed(0) : currentSpeed.toFixed(1)) + 'x';
                if (speedVal) speedVal.textContent = displayVal;
                if (speedSlider) speedSlider.value = currentSpeed;
            }

            speedSlider.addEventListener('input', (e) => {
                currentSpeed = parseFloat(speedSlider.value);
                updateSpeedDisplay();
                if (window.fb_toolkit?.homepage?.AUTO_SCROLL) {
                    window.fb_toolkit.homepage.AUTO_SCROLL.speed = currentSpeed;
                }
                // Persist
                window.postMessage({
                    __fbToolkit: true,
                    type: 'UPDATE_SETTING',
                    payload: { category: 'homepage', feature: 'AUTO_SCROLL', value: { ...window.fb_toolkit.homepage.AUTO_SCROLL, speed: currentSpeed } }
                }, '*');
            });

            function updateIcon() {
                if (autoScrollActive) {
                    iconEl.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
                    toggleBtn.classList.add('active');
                } else {
                    iconEl.innerHTML = '<polygon points="6,4 20,12 6,20"/>';
                    toggleBtn.classList.remove('active');
                }
            }

            function startScrolling() {
                if (autoScrollIntervalId) cancelAnimationFrame(autoScrollIntervalId);
                autoScrollActive = true;
                userPaused = false;
                el.classList.add('autoscroll-playing');
                updateIcon();

                function scrollStep() {
                    if (!autoScrollActive) return;
                    const latestSettings = getHomepageSettings();
                    const latestSpeed = latestSettings.AUTO_SCROLL?.speed || currentSpeed;
                    currentSpeed = latestSpeed;
                    updateSpeedDisplay();

                    window.scrollBy(0, currentSpeed);
                    autoScrollIntervalId = requestAnimationFrame(scrollStep);
                }
                autoScrollIntervalId = requestAnimationFrame(scrollStep);
            }

            function stopScrolling() {
                autoScrollActive = false;
                if (autoScrollIntervalId) {
                    cancelAnimationFrame(autoScrollIntervalId);
                    autoScrollIntervalId = null;
                }
                el.classList.remove('autoscroll-playing');
                updateIcon();
            }

            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (autoScrollActive) {
                    userPaused = true;
                    stopScrolling();
                } else {
                    startScrolling();
                }
            });

            // Pause on manual scroll
            let manualScrollTimer = null;
            window.addEventListener('wheel', () => {
                if (autoScrollActive) {
                    stopScrolling();
                    if (manualScrollTimer) clearTimeout(manualScrollTimer);
                    if (!userPaused) {
                        manualScrollTimer = setTimeout(() => {
                            if (!userPaused && document.getElementById(AUTOSCROLL_PANEL_ID)) {
                                startScrolling();
                            }
                        }, 3000);
                    }
                }
            }, { passive: true });

        } else {
            // Panel already exists — just update speed display
            const speed = settings.AUTO_SCROLL?.speed || 2;
            const speedVal = panel.querySelector('#autoscroll-speed-val');
            const speedSlider = panel.querySelector('#autoscroll-speed-slider');
            if (speedVal) speedVal.textContent = (speed % 1 === 0 ? speed.toFixed(0) : speed.toFixed(1)) + 'x';
            if (speedSlider) speedSlider.value = speed;
        }
    }

    function showHoverZoomToast(isPaused) {
        // Remove any existing hover zoom toast
        const existing = document.getElementById('fb-toolkit-hoverzoom-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'fb-toolkit-hoverzoom-toast';

        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '32px',
            left: '50%',
            transform: 'translateX(-50%) translateY(20px)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '14px 22px',
            borderRadius: '14px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(24, 24, 27, 0.92)',
            backdropFilter: 'blur(16px) saturate(140%)',
            WebkitBackdropFilter: 'blur(16px) saturate(140%)',
            color: 'rgba(255, 255, 255, 0.92)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: '13px',
            fontWeight: '400',
            zIndex: '2147483647',
            pointerEvents: 'auto',
            opacity: '0',
            transition: 'opacity 350ms ease, transform 350ms cubic-bezier(0.16, 1, 0.3, 1)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255,255,255,0.04) inset',
            maxWidth: '520px',
            lineHeight: '1.45'
        });

        const eyeIcon = isPaused
            ? `<svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:rgba(255,255,255,0.5);"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`
            : `<svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:#60a5fa;"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;

        const statusColor = isPaused ? 'rgba(255,255,255,0.5)' : '#60a5fa';
        const statusText = isPaused ? 'Disabled' : 'Enabled';

        // Use extension logo if available
        const iconUrl = window.__fb_toolkit_icon_url;
        const logoHtml = iconUrl
            ? `<img src="${iconUrl}" style="width:24px;height:24px;flex-shrink:0;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.08);" alt="Astra">`
            : `<span style="flex-shrink:0;width:24px;height:24px;border-radius:50%;background:rgba(59,130,246,0.15);display:flex;align-items:center;justify-content:center;">${eyeIcon}</span>`;

        toast.innerHTML = `
${logoHtml}
<div style="display:flex;flex-direction:column;flex:1;margin-right:8px;">
    <span style="color:rgba(255,255,255,0.95);font-weight:600;font-size:13px;letter-spacing:0.1px;">Hover Zoom${!isPaused ? ` (${hoverZoomMode.charAt(0).toUpperCase() + hoverZoomMode.slice(1)})` : ''}</span>
    <span style="color:${statusColor};font-size:12px;display:flex;align-items:center;gap:5px;">${eyeIcon} ${statusText}</span>
</div>
<button id="fb-toolkit-hoverzoom-toast-dismiss" style="flex-shrink:0;background:none;border:none;color:rgba(255,255,255,0.35);cursor:pointer;padding:4px;border-radius:6px;display:flex;align-items:center;justify-content:center;transition:color 150ms ease;">
    <svg viewBox="0 0 24 24" style="width:12px;height:12px;fill:currentColor;"><path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/></svg>
</button>
`;

        document.body.appendChild(toast);

        // Trigger entrance animation
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.style.opacity = '1';
                toast.style.transform = 'translateX(-50%) translateY(0)';
            });
        });

        // Dismiss handler
        let autoDismissTimer;
        function dismissToast() {
            if (autoDismissTimer) clearTimeout(autoDismissTimer);
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(() => toast.remove(), 400);
        }

        const dismissBtn = toast.querySelector('#fb-toolkit-hoverzoom-toast-dismiss');
        if (dismissBtn) dismissBtn.addEventListener('click', dismissToast);

        // Auto-dismiss after 3 seconds
        autoDismissTimer = setTimeout(dismissToast, 3000);
    }

    const CTRL_HOVERZOOM_TOAST_ID = 'fb-toolkit-ctrl-hoverzoom-toast';

    function showCtrlHoverZoomToast() {
        // Don't show duplicate
        if (document.getElementById(CTRL_HOVERZOOM_TOAST_ID)) return;

        const toast = document.createElement('div');
        toast.id = CTRL_HOVERZOOM_TOAST_ID;

        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%) translateY(12px)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            background: 'rgba(24, 24, 27, 0.88)',
            backdropFilter: 'blur(12px) saturate(130%)',
            WebkitBackdropFilter: 'blur(12px) saturate(130%)',
            color: 'rgba(255, 255, 255, 0.85)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: '12px',
            fontWeight: '500',
            zIndex: '2147483647',
            pointerEvents: 'none',
            opacity: '0',
            transition: 'opacity 200ms ease, transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
            letterSpacing: '0.2px',
            whiteSpace: 'nowrap'
        });

        toast.innerHTML = `
<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:#60a5fa;flex-shrink:0;"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
<span>Hover Zoom active</span>
<span style="color:rgba(255,255,255,0.35);font-size:11px;">— release Ctrl to stop</span>
`;

        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.style.opacity = '1';
                toast.style.transform = 'translateX(-50%) translateY(0)';
            });
        });
    }

    function hideCtrlHoverZoomToast() {
        const toast = document.getElementById(CTRL_HOVERZOOM_TOAST_ID);
        if (!toast) return;

        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(12px)';
        setTimeout(() => toast.remove(), 250);
    }

    function showReopenFab() {
        // Remove any existing FAB
        const existing = document.getElementById('fb-toolkit-reopen-fab');
        if (existing) existing.remove();

        const fab = document.createElement('button');
        fab.id = 'fb-toolkit-reopen-fab';
        fab.title = 'Show Astra Controller';

        // Use extension logo if available, otherwise SVG
        const iconUrl = window.__fb_toolkit_icon_url;
        if (iconUrl) {
            fab.innerHTML = `<img src="${iconUrl}" alt="Astra">`;
        } else {
            fab.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.28-10.43zM10.5 15a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm9.13-10.36L15 8.13L13.5 6.63l4.64-4.64a.5.5 0 0 1 .7.7z"/></svg>`;
        }

        fab.addEventListener('click', () => {
            autoScrollPanelHidden = false;
            fab.style.opacity = '0';
            fab.style.transform = 'scale(0.5)';
            setTimeout(() => fab.remove(), 300);
            manageAutoScrollPanel();
        });

        document.body.appendChild(fab);

        // Animate in
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                fab.classList.add('visible');
            });
        });
    }

    function showAutoScrollToast() {
        // Remove any existing toast
        const existing = document.getElementById('fb-toolkit-autoscroll-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'fb-toolkit-autoscroll-toast';

        // Apply all styles inline so they work regardless of CSS injection state
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '32px',
            left: '50%',
            transform: 'translateX(-50%) translateY(20px)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '14px 22px',
            borderRadius: '14px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(24, 24, 27, 0.92)',
            backdropFilter: 'blur(16px) saturate(140%)',
            WebkitBackdropFilter: 'blur(16px) saturate(140%)',
            color: 'rgba(255, 255, 255, 0.92)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: '13px',
            fontWeight: '400',
            zIndex: '2147483647',
            pointerEvents: 'auto',
            opacity: '0',
            transition: 'opacity 350ms ease, transform 350ms cubic-bezier(0.16, 1, 0.3, 1)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255,255,255,0.04) inset',
            maxWidth: '520px',
            lineHeight: '1.45'
        });

        // Use extension logo if available, otherwise fall back to SVG icon
        const iconUrl = window.__fb_toolkit_icon_url;
        const iconHtml = iconUrl
            ? `<img src="${iconUrl}" style="width:24px;height:24px;flex-shrink:0;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.08);" alt="Astra">`
            : `<span style="flex-shrink:0;width:24px;height:24px;border-radius:50%;background:rgba(59,130,246,0.15);display:flex;align-items:center;justify-content:center;"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:#60a5fa;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg></span>`;

        toast.innerHTML = `
${iconHtml}
<div style="display:flex;flex-direction:column;flex:1;margin-right:8px;">
    <span style="color:rgba(255,255,255,0.95);font-weight:600;font-size:13px;letter-spacing:0.1px;">Astra Controller</span>
    <span style="color:rgba(255,255,255,0.55);font-size:12px;">Hidden — click the floating icon to reopen</span>
</div>
<button id="fb-toolkit-toast-undo" style="flex-shrink:0;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;cursor:pointer;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;font-family:inherit;transition:all 150ms ease;letter-spacing:0.2px;margin-right:4px;">Show</button>
<button id="fb-toolkit-toast-dismiss" style="flex-shrink:0;background:none;border:none;color:rgba(255,255,255,0.35);cursor:pointer;padding:4px;border-radius:6px;display:flex;align-items:center;justify-content:center;transition:color 150ms ease;">
    <svg viewBox="0 0 24 24" style="width:12px;height:12px;fill:currentColor;"><path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/></svg>
</button>
`;

        document.body.appendChild(toast);

        // Trigger entrance animation
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.style.opacity = '1';
                toast.style.transform = 'translateX(-50%) translateY(0)';
            });
        });

        // Dismiss handler
        let autoDismissTimer;
        function dismissToast() {
            if (autoDismissTimer) clearTimeout(autoDismissTimer);
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(() => toast.remove(), 400);
        }

        // Show handler — bring back the controller immediately
        const undoBtn = toast.querySelector('#fb-toolkit-toast-undo');
        if (undoBtn) {
            undoBtn.addEventListener('mouseenter', () => {
                undoBtn.style.background = 'rgba(59,130,246,0.25)';
                undoBtn.style.borderColor = 'rgba(59,130,246,0.5)';
                undoBtn.style.color = '#93bbfc';
            });
            undoBtn.addEventListener('mouseleave', () => {
                undoBtn.style.background = 'rgba(59,130,246,0.15)';
                undoBtn.style.borderColor = 'rgba(59,130,246,0.3)';
                undoBtn.style.color = '#60a5fa';
            });
            undoBtn.addEventListener('click', () => {
                // Unhide the panel
                autoScrollPanelHidden = false;
                // Remove the re-open FAB
                const fab = document.getElementById('fb-toolkit-reopen-fab');
                if (fab) {
                    fab.style.opacity = '0';
                    fab.style.transform = 'scale(0.5)';
                    setTimeout(() => fab.remove(), 300);
                }
                // Re-apply styles & recreate the panel
                applyStyles();
                manageAutoScrollPanel();
                // Dismiss the toast
                dismissToast();
            });
        }

        const dismissBtn = toast.querySelector('#fb-toolkit-toast-dismiss');
        if (dismissBtn) dismissBtn.addEventListener('click', dismissToast);

        // Auto-dismiss after 6 seconds
        autoDismissTimer = setTimeout(dismissToast, 6000);
    }

    // Apply styles initially
    applyStyles();
    queueContentFilterRun();
    queueMarketplaceAdFilterRun();
    queueReelVideoPreferenceRun();
    manageAutoScrollPanel();

    // Re-apply when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            applyStyles();
            queueContentFilterRun();
            queueMarketplaceAdFilterRun();
            queueReelVideoPreferenceRun();
            manageAutoScrollPanel();
        });
    }

    // Watch for settings changes (when popup updates fb_toolkit)
    // Use a polling approach since we're in MAIN world
    let lastSettings = JSON.stringify(window.fb_toolkit?.homepage || {});

    setInterval(() => {
        const currentSettings = JSON.stringify(window.fb_toolkit?.homepage || {});
        if (currentSettings !== lastSettings) {
            lastSettings = currentSettings;
            applyStyles();
            queueContentFilterRun();
            queueMarketplaceAdFilterRun();
            queueReelVideoPreferenceRun();
            manageAutoScrollPanel();
            syncAutoScrollPanelState();
        }
    }, 500);

    window.addEventListener('scroll', queueReelVideoPreferenceRun, { passive: true });
    window.addEventListener('resize', queueReelVideoPreferenceRun);

    // Also re-apply on navigation (Facebook uses client-side routing)
    let lastUrl = location.href;
    new MutationObserver(() => {
        queueContentFilterRun();
        queueMarketplaceAdFilterRun();
        queueReelVideoPreferenceRun();

        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(() => {
                applyStyles();
                queueContentFilterRun();
                queueMarketplaceAdFilterRun();
                queueReelVideoPreferenceRun();
                manageAutoScrollPanel();

                // Explicit sponsored reel check on navigation (Edge compatibility)
                if (location.pathname.startsWith('/reel/')) {
                    checkAndSkipSponsoredReelWithRetry();
                }
            }, 100);
        }
    }).observe(document, { subtree: true, childList: true });

})();
