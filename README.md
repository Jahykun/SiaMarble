# SiaMarble

SiaMarble is a pair of userscripts that automate and enhance the user experience on:
- **[wplace.live](https://wplace.live)** (`siamarble.wplc.js`)
- **[openplace.live](https://openplace.live)** (`siamarble.oplc.js`)

It focuses on template overlay utilities (visual guidance, outline/overlay handling) to help with collaborative pixel art.

> **Not affiliated** with Wplace.live, OpenPlace.live, or Tampermonkey. Use at your own risk.

---

## Quick Links

- **Install (Wplace.live):** [siamarble.wplc.js](https://raw.githubusercontent.com/Jahykun/SiaMarble/refs/heads/main/siamarble.wplc.js)
- **Install (OpenPlace.live):** [siamarble.oplc.js](https://raw.githubusercontent.com/Jahykun/SiaMarble/refs/heads/main/siamarble.oplc.js)
- **Repository:** [github.com/Jahykun/SiaMarble](https://github.com/Jahykun/SiaMarble)

---

## Scripts

### Wplace.live version
- **File:** `siamarble.wplc.js`
- **Site:** [wplace.live](https://wplace.live)
- **Direct install:** https://raw.githubusercontent.com/Jahykun/SiaMarble/refs/heads/main/siamarble.wplc.js

### OpenPlace.live version
- **File:** `siamarble.oplc.js`
- **Site:** [openplace.live](https://openplace.live)
- **Direct install:** https://raw.githubusercontent.com/Jahykun/SiaMarble/refs/heads/main/siamarble.oplc.js

---

## Features

- Template overlay support (image overlay on the map/canvas)
- Outline overlay support (visual border/guide)
- Overlay visibility + opacity handling
- Automatically re-binds after map style reloads (so your overlay doesn’t randomly vanish)

> Exact UI/controls may vary by site and updates.

---

## Requirements

- A userscript manager:
  - **Tampermonkey** (Chrome/Chromium, Edge, Brave)
  - **Violentmonkey** (Firefox / Chromium)

---

## Installation

### Option A: One-click install (recommended)
1. Install **Tampermonkey** (or **Violentmonkey**) in your browser.
2. Open one of these links:
   - Wplace: https://raw.githubusercontent.com/Jahykun/SiaMarble/refs/heads/main/siamarble.wplc.js
   - OpenPlace: https://raw.githubusercontent.com/Jahykun/SiaMarble/refs/heads/main/siamarble.oplc.js
3. Your userscript manager will prompt you to install. Click **Install**.
4. Visit the target site and refresh the page.

### Option B: Manual install
1. Create a new userscript in your userscript manager.
2. Copy-paste the full script content from the file in this repo.
3. Save and refresh the site.

---

## Usage

A full step-by-step tutorial will be added soon.

For now:
1. Go to the target site (Wplace or OpenPlace).
2. Ensure the script is **enabled** in your userscript manager.
3. Use the in-page SiaMarble controls (or commands) to load/show/clear your overlay.

If you want the tutorial section to be extremely clear, send me:
- A screenshot of your UI panel
- Or the part of the script that builds the UI (menu/buttons)
and I’ll write a perfect “click-by-click” guide.

---

## Safety, Rules, and Responsibility (Important)

You are responsible for how you use this script.

- **SiaMarble is provided “AS IS”.**
- It may cause unintended behavior, bugs, or performance issues.
- It may violate site rules depending on how you use it and how the site enforces its Terms.

### No liability for bans / punishments
If you get **banned, restricted, rate-limited, muted, or otherwise punished** on **Wplace.live** or **OpenPlace.live** for using this script (or anything related to it), **I (the author) accept absolutely no responsibility.**

By using SiaMarble, you agree that:
- you use it **entirely at your own risk**
- any consequences (including bans) are **yours alone**

Please read and follow each site’s Terms of Service and rules.

---

## Troubleshooting

### Overlay does not appear
- Refresh the page (hard refresh: `Ctrl+Shift+R`)
- Make sure the script is enabled in Tampermonkey/Violentmonkey
- Disable conflicting userscripts/extensions
- Check the browser console for logs:
  - Look for `[SiaMarble:page]` messages

### Script seems broken after updates
- Reinstall from the raw link (or update via userscript manager)
- Clear site cache and reload

---

## Contributing

PRs and issues are welcome.
- Keep changes minimal and readable
- Avoid site-specific breakages if possible
- If you add UI/controls, document them in the README

---

## License & Credits

- Code is licensed under the **Mozilla Public License 2.0 (MPL-2.0)**.
- The “Blue Marble” icon is **CC0 1.0** (Public Domain dedication), image owned by **NASA**.

---

## Disclaimer

SiaMarble is an independent project and is **not affiliated with**:
- Wplace.live
- OpenPlace.live
- Tampermonkey / Violentmonkey
