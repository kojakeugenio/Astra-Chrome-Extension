# Privacy Policy for ASTRA for Facebook™

**Last Updated:** February 9, 2026

## Introduction

ASTRA for Facebook™ ("ASTRA", "we", "our", or "the extension") is committed to protecting your privacy. This Privacy Policy explains how the extension handles information when you use it.

## Summary

**ASTRA does not collect, store, transmit, or sell any personal data.** All functionality operates entirely within your browser, and all user preferences are stored locally on your device.

---

## Information We Do NOT Collect

ASTRA does **not** collect, access, or transmit:

- Personal information (name, email, address, etc.)
- Facebook account credentials or login information
- Messages, posts, or any content from your Facebook account
- Browsing history or activity outside of Facebook
- Location data
- Device identifiers
- Any data to external servers

---

## Local Data Storage

ASTRA stores the following data **locally on your device only** using Chrome's built-in `chrome.storage.local` API:

### User Preferences
- Feature toggle states (e.g., ad blocker on/off, unseen mode on/off)
- Theme selections (gradients, wallpapers, custom URLs)
- Reels settings (playback speed, timeout threshold, custom messages)
- Layout preferences (feed width, sidebar visibility)
- UI theme preference (light/dark/system)

### Usage Statistics
- Ad block counter (number of ads blocked in the current session)
- Reels watched counter (for timeout reminder feature)
- First install timestamp (for "Rate Us" prompt timing)

**This data never leaves your device.** It is not transmitted to any server, third party, or the extension developer.

---

## Permissions Explained

ASTRA requests the following browser permissions:

### `storage`
- **Purpose:** Save your preferences and settings locally
- **Data Access:** Only extension-specific settings, not browser data

### `scripting`
- **Purpose:** Inject scripts to apply visual changes and feature toggles on Facebook pages
- **Data Access:** Modifies Facebook's page appearance based on your settings; does not read or transmit page content

### `declarativeNetRequest`
- **Purpose:** Block ad-related network requests to remove sponsored content
- **Data Access:** Filters network requests to Facebook's ad servers; does not log or transmit request data

### Host Permissions
- `https://www.facebook.com/*`
- `https://web.facebook.com/*`
- `https://m.facebook.com/*`
- `https://www.messenger.com/*`

- **Purpose:** Apply extension functionality only on Facebook and Messenger domains
- **Data Access:** The extension only operates on these specific websites

---

## Third-Party Services

ASTRA does **not** integrate with or send data to any third-party services, including:

- Analytics platforms
- Advertising networks
- Data brokers
- Cloud storage services
- Social media APIs

---

## Data Security

Since all data is stored locally on your device:

- Your preferences are protected by your device's security
- Uninstalling the extension removes all stored data
- You can clear extension data through Chrome's settings at any time

---

## Children's Privacy

ASTRA does not knowingly collect any information from children under 13 years of age. The extension does not collect any personal information from any users.

---

## Changes to This Policy

We may update this Privacy Policy from time to time. Any changes will be reflected in the "Last Updated" date at the top of this document. Continued use of the extension after changes constitutes acceptance of the updated policy.

---

## Your Rights

You have full control over your data:

- **Access:** View your settings in the extension popup
- **Modify:** Change any setting at any time
- **Delete:** Clear all data by uninstalling the extension or clearing extension storage in Chrome settings

---

## Open Source

ASTRA is developed with transparency in mind. The extension's functionality can be reviewed by examining its source code.

---

## Contact

If you have questions about this Privacy Policy or the extension's data practices, please contact us through:

- **GitHub:** [github.com/kojakeugenio](https://github.com/kojakeugenio)

---

## Disclaimer

ASTRA is an independent project and is not affiliated with, endorsed by, or connected to Meta Platforms, Inc. or Facebook. "Facebook" is a trademark of Meta Platforms, Inc.

---

**Summary:** ASTRA is a privacy-focused extension. We don't collect your data. Everything stays on your device.
