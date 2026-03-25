<p align="center">
  <img src="astra-logo.png" alt="ASTRA Logo" width="120" />
</p>

<h1 align="center">ASTRA for Facebook™</h1>

<p align="center">
  <strong>Privacy · Ad Blocking · Customization · Reels Control</strong><br/>
  The most powerful all-in-one toolkit for Facebook.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#privacy">Privacy</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/manifest-v3-blue?style=flat-square" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/chrome-%3E%3D103-green?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome 103+" />
  <img src="https://img.shields.io/badge/license-MIT-purple?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/data_collected-none-brightgreen?style=flat-square" alt="No Data Collected" />
</p>

---

## What is ASTRA?

ASTRA is a free, privacy-first Chrome extension that gives you **total control** over your Facebook experience. Block ads, read messages without being seen, customize your feed layout, control Reels playback, and apply premium themes — all without sending a single byte of your data to any server.

> **Zero data collection. Zero external requests. 100% local.**

---

## Features

### Privacy Protection

| Feature | Description |
|---|---|
| **Block "Seen"** | Read messages without triggering read receipts |
| **Block "Typing..."** | Hide the typing indicator while composing messages |
| **Anonymous Stories** | View stories without appearing in the viewers list |

### Ad Blocker

- **Relay Store-Level Detection** — Intercepts ads at the React component level for reliable, flicker-free removal
- **Feed Ads** — Hides sponsored posts from your main feed
- **Sidebar Ads** — Removes sponsored content from the right sidebar
- **Marketplace Ads** — Filters promotional content in Marketplace
- **Live Counter** — Tracks how many ads have been blocked in your session

### Layout & Content Control

| Feature | Description |
|---|---|
| Hide Left Sidebar | Remove the navigation column |
| Hide Right Sidebar | Remove contacts and sponsored sidebar |
| Hide Navigation Bar | Full immersive mode |
| Hide Stories | Remove Stories carousel |
| Hide Reels | Remove Reels section from feed |
| Hide "What's on your mind" | Remove the Create Post box |
| Hide Suggestions | Remove "Suggested for you" posts |
| Hide "People You May Know" | Remove PYMK carousels |
| Custom Feed Width | Adjust feed width from 50% to 100% with a live slider |

### Reels Experience

| Feature | Description |
|---|---|
| **Custom Playback Speed** | Set default speed from 0.5x to 2x |
| **Auto-Mute** | Start every reel muted |
| **Advanced Controls** | Floating panel with seek, restart, and speed controls |
| **Auto-Next** | Automatically advance to the next reel |
| **Timeout Reminder** | Get a break notification after watching a configurable number of reels — great for managing screen time |

### Hover Zoom

- **Popup Mode** — Floating preview window on hover
- **Inline Mode** — Zoom and pan directly within the feed
- **Scroll to Zoom** — Mouse wheel controls zoom level
- **Drag to Pan** — Click and drag to move around the zoomed image
- **Pin Images** — Keep images floating on screen with the pin button
- **URL Exclusions** — Disable hover zoom on specific pages
- **Ctrl Override** — Hold `Ctrl` to temporarily activate even when disabled

### Auto Scroll

- Hands-free feed scrolling with adjustable speed (1–10px)
- Floating controls on the homepage

### Themes & Visual Overlays

**14 Gradient Themes:**
Cosmic · Ocean · Sunset · Aurora · Midnight · Forest · Rose · Dark · Sky · Mint · Lavender · Lemon · Sakura · Ivory

**9 Nature Wallpapers:**
Nature Leaves · Deep Forest · Misty Peaks · Serene Lake · Autumn Glow · Wild Falls · Sunset Beach · Spring Flowers · Starry Sky

**Additional Effects:**
- Custom wallpaper via URL
- Blur intensity slider
- Gradient intensity slider
- Animated particles: Bubbles, Stars, Snow, Rain, Fireflies
- Particle speed control
- Subtle cinematic zoom effect
- Homepage-only mode

### Interface Theme

- System (auto-detect)
- Light mode
- Dark mode

---

## Installation

### From the Chrome Web Store (Recommended)

1. Visit the [ASTRA Chrome Web Store listing](https://chrome.google.com/webstore)
2. Click **"Add to Chrome"**
3. Navigate to Facebook.com — ASTRA works instantly

### From Source (Developer)

```bash
# Clone the repository
git clone https://github.com/kojakeugenio/astra-facebook-extension.git

# Navigate to the extension directory
cd astra-facebook-extension
```

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode** (toggle in the top right)
3. Click **"Load unpacked"**
4. Select the cloned directory
5. Navigate to Facebook.com

> No build step required — ASTRA is vanilla JavaScript with zero dependencies.

---

## Usage

1. **Click the ASTRA icon** in your Chrome toolbar while on Facebook
2. The popup organizes features into 4 tabs:
   - **Privacy** — Unseen mode, ad blocker, layout controls
   - **Tools** — Hover zoom, auto scroll, Reels controls
   - **Theme** — Gradient themes, wallpapers, particles
   - **About** — Feature overview and links
3. Toggle features on/off — changes apply **instantly** without page refresh
4. Your preferences are saved automatically and persist across sessions

---

## Architecture

```
astra-facebook-extension/
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker — settings, analytics, network rules
├── popup/
│   ├── popup.html         # Extension popup UI
│   ├── popup.js           # Popup logic & settings management
│   └── popup.css          # Glassmorphism UI styling
├── injects/
│   ├── proxy.js           # Network request interception (unseen, typing)
│   ├── bridge.js          # Isolated ↔ Main world communication bridge
│   └── homepage.js        # Feed customization, ad blocking, themes, hover zoom
├── icons/                 # Extension icons (16, 32, 48, 128)
├── screenshots/           # Chrome Web Store screenshots
├── store/                 # Store listing assets
└── PRIVACY_POLICY.md      # Full privacy policy
```

### Key Technical Details

- **Manifest V3** — Built on the latest Chrome extension platform
- **Zero Dependencies** — Pure vanilla JavaScript, no frameworks or libraries
- **Relay Store Interception** — Hooks into Facebook's internal Relay store to detect ads at the data layer, not just the DOM
- **Dual World Injection** — Uses both `MAIN` and `ISOLATED` content script worlds for maximum compatibility
- **Declarative Net Request** — Network-level request modification for privacy features
- **CSS Injection** — Smooth, animated layout changes with `cubic-bezier` transitions

---

## Privacy

**ASTRA collects zero data.** Full stop.

- No analytics or tracking
- No external network requests
- No data transmitted to any server
- All settings stored locally via `chrome.storage.local`
- Uninstalling removes all data

Read the full [Privacy Policy](PRIVACY_POLICY.md).

---

## Permissions Explained

| Permission | Why It's Needed |
|---|---|
| `storage` | Save your preferences locally |
| `scripting` | Inject scripts to apply features on Facebook |
| `declarativeNetRequest` | Block ad-related network requests & modify headers for privacy features |
| Host permissions (`facebook.com`, `messenger.com`) | Scope the extension to only run on Facebook/Messenger |

---

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a **Pull Request**

### Guidelines

- Keep it vanilla — no frameworks or build tools
- Test on both `www.facebook.com` and `web.facebook.com`
- Ensure Manifest V3 compliance
- Maintain the zero-data-collection principle

---

## Disclaimer

ASTRA is an independent project and is **not affiliated with, endorsed by, or connected to Meta Platforms, Inc.** or Facebook. "Facebook" is a trademark of Meta Platforms, Inc. This extension is designed to enhance your browsing experience while respecting platform guidelines.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  Made with care by <a href="https://github.com/kojakeugenio">Kojak Eugenio</a>
</p>
