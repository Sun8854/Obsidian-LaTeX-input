# LaTeX Input

**English** | [中文](./README.md)

> An  LaTeX formula input panel for Obsidian — with a visual editor powered by MathLive and a quick-insert symbol palette. Default hotkeys: `Ctrl+Shift+L` (inline) / `Ctrl+Shift+M` (display).

A LaTeX formula input plugin for Obsidian. Click symbols from the palette to auto-generate source, preview live, and insert into the current note; also supports **screen-selection OCR** and **clipboard-image OCR** so you can type formulas faster.

![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7c3aed?style=flat-square&logo=obsidian&logoColor=white)
![Version](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Desktop-lightgrey?style=flat-square)
![License](https://img.shields.io/badge/license-GPL--3.0-orange?style=flat-square)

---

## ✨ Features

- 🎯 **Click-to-insert symbols** — 10 categories, ~250 symbols. Click to insert at the cursor.
- 👀 **Live preview** — WYSIWYG-style rendering as you type.
- ⌨️ **Editable source** — Tweak the raw LaTeX directly in the source box.
- 📸 **Screenshot OCR** — `Ctrl+Shift+S` to drag-select a region, auto-converted to LaTeX.
- 📋 **Clipboard OCR** — `Ctrl+Shift+R` reads the image currently in your clipboard.
- 🕘 **History** — Persisted automatically; reload any past formula to keep editing.
- 🌗 **Dark-mode friendly** — Follows your Obsidian theme automatically.
- 📦 **Zero external dependencies** — MathLive is bundled into `main.js`.

---

## 🚀 Getting Started

### Option 1: Download from Releases (recommended)

1. Go to [Releases](../../releases) and download `main.js`, `manifest.json`, and `styles.css`.
2. In your vault, create the path: `.obsidian/plugins/latex-input/`
3. Drop the three files into that folder.
4. **Settings → Community plugins → Installed plugins** → enable **LaTeX Input**.

### Option 2: Build from source

```bash
git clone <this-repo>
cd latex-input
npm install
npm run build
```

The build output `main.js` lives at the repo root. Deploy it together with `manifest.json` and `styles.css` to `.obsidian/plugins/latex-input/`.

---

## ⌨️ Hotkeys

| Action | Hotkey |
| --- | --- |
| Insert inline formula `$...$` | `Ctrl + Shift + L` |
| Insert display formula `$$...$$` | `Ctrl + Shift + M` |
| Screenshot OCR (region, inline) | `Ctrl + Shift + S` |
| Screenshot OCR (region, display) | `Alt + Shift + S` |
| Clipboard OCR (inline) | `Ctrl + Shift + R` |
| Clipboard OCR (display) | `Alt + Shift + R` |
| Insert formula from panel into note | `Ctrl + Enter` |
| Close panel | `Esc` |

> You can also open the panel via the **σ** icon in the left ribbon. Rebind any hotkey in **Settings → Hotkeys**.

https://github.com/user-attachments/assets/f74008e1-38ad-44da-a97d-2ad2be519e83

---

## 📸 Screenshot OCR

https://github.com/user-attachments/assets/da416d31-9908-4a8f-b58d-0f04f32faa7d

Press `Ctrl+Shift+S` (inline) or `Alt+Shift+S` (display):

1. **When screen capture is available** — a full-screen overlay appears; **drag to select the formula region**; release to auto-OCR and insert.
2. **When screen capture is unavailable** — it falls back to **clipboard polling** with a small floating hint in the bottom-right; any screenshot you take is **auto-detected, auto-OCR'd, and auto-inserted**.

Press `Ctrl+Shift+R` / `Alt+Shift+R` to read the image currently in your clipboard.

> First-time use requires configuring your OCR service in the plugin settings (API endpoint, key, model name).

---

## 🧩 Panel Layout

<img width="1094" height="722" alt="屏幕截图 2026-08-06 130850" src="https://github.com/user-attachments/assets/4776dae5-77ff-43ee-8668-9d5be4aab068" />

---

## 🛠 Customizing Symbols

Open `symbols.ts` and add entries in this format:

```ts
{ display: "∑", insert: "\\sum_{i=1}^{n} " }
```

- `display` — the text shown on the button
- `insert` — the LaTeX source inserted on click
- To place the caret at a specific position, use `{cursor}` inside `insert`

```bash
npm run build   # rebuild
```

---

## 📁 Project Structure

```
latex-input/
├── manifest.json       # Obsidian plugin metadata
├── main.js             # Build output (loaded at runtime)
├── main.ts             # Entry source
├── symbols.ts          # Symbol library (10 categories, ~250 entries)
├── styles.css          # Styles
├── package.json        # npm config
├── esbuild.config.mjs  # Build script (esbuild + MathLive virtual module)
├── tsconfig.json       # TypeScript config
└── versions.json       # Obsidian version compatibility map
```

---

## 📄 License

Copyright © 2026 Sun · Licensed under [GPL-3.0](./LICENSE)
