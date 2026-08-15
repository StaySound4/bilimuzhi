# Bilimuzhi 🎬✨

> 🌐 **Language / 语言**:[中文](./README.md) · [English](./README.en.md) · [日本語](./README.ja.md)

<p align="center">
  <img src="assets/bilimuzhi-banner.jpg" alt="Bilimuzhi" width="100%" />
</p>

<p align="center">
  <span style="display:inline-block;padding:3px 12px;border-radius:999px;background:#6e7781;color:#fff;font-size:11px;font-weight:600;letter-spacing:1px;margin:2px;">BILIBILI</span>
  <span style="display:inline-block;padding:3px 12px;border-radius:999px;background:#0969da;color:#fff;font-size:11px;font-weight:600;letter-spacing:1px;margin:2px;">AI SUBTITLES</span>
  <span style="display:inline-block;padding:3px 12px;border-radius:999px;background:#6e7781;color:#fff;font-size:11px;font-weight:600;letter-spacing:1px;margin:2px;">CHROMIUM MV3</span>
  <span style="display:inline-block;padding:3px 12px;border-radius:999px;background:#24292f;color:#fff;font-size:11px;font-weight:600;letter-spacing:1px;margin:2px;">LOCAL FIRST</span>
  <span style="display:inline-block;padding:3px 0 3px 12px;border-radius:999px 0 0 999px;background:#57606a;color:#fff;font-size:11px;font-weight:600;letter-spacing:1px;margin:2px 0;">LICENSE</span><span style="display:inline-block;padding:3px 12px 3px 6px;border-radius:0 999px 999px 0;background:#bf3989;color:#fff;font-size:11px;font-weight:600;letter-spacing:1px;margin:2px;">MIT</span>
</p>

---

**Project description**: Bilimuzhi is a local-first AI subtitle workspace browser extension for Bilibili videos, designed around one goal: truly *understanding* the videos you watch. Open any Bilibili video page to fetch official/AI/multi-language subtitle tracks, or generate subtitles for videos without them via speech-to-subtitle. AI then helps you grasp the content in one click — segmentation (with automatic ad-segment recognition), summaries at three levels (Brief/Balanced/Detailed, with clickable timestamps embedded in the text), and multi-turn chat that supports images with the current video timestamp. Batch mode covers six source kinds (single video, user space, favorites, collections, multi-P series, search pages) for batch subtitle acquisition or batch speech-to-subtitle, exported uniformly as TXT/SRT/Markdown/ZIP to build a knowledge base. Session and batch modes each have their own archive (tags, pinning, drag-and-drop ordering) and trash (7/30/365 days, custom, or permanent auto-cleanup); password-encrypted backup export/import preserves sessions, subtitles, and AI outputs for the long term. Privacy first: no telemetry, no cloud accounts, API keys stay in local storage, and AI conversations connect directly to the provider you choose; subtitles and cookie handling all happen in your local browser. Bilimuzhi runs on Chromium-based browsers (MV3) and supports 简体中文 / 繁體中文 / English / 日本語. 

**Core highlights**:

- 🎙️ **Subtitles + Speech-to-Subtitle**: official/AI/multi-language tracks; generate subtitles even for videos without them;
- 🧠 **AI Segments / Summary / Chat**: chaptered titles with overviews, three-level summaries, image chat — all with clickable timestamps;
- 📦 **Batch Processing**: six source kinds (video / multi-P / collections / favorites / user space / search) with bulk acquisition and export (TXT/SRT/Markdown/ZIP) to build your knowledge base;
- 🔒 **Privacy First**: no telemetry, no cloud accounts; API keys stay in your local browser.

## 🔥 Features

### Highlights

- 🔥 **Session Mode + Batch Mode**: two independent workspaces, each with its own archive and trash — no interference between them.
- ⏱️ **Timeline Mode**: a virtualized subtitle timeline; click any subtitle line to seek the player to that moment. "Sync Mode" keeps the current subtitle centered and highlighted as the player progresses.
- 📑 **Segmentation Mode**: the AI splits a video into segments, each with a title and overview; click a segment to jump to its time. Ad segments are recognized automatically.
- 📝 **Three Summary Levels**: Brief / Balanced / Detailed, your choice; summaries embed **clickable time links** that jump to the corresponding moment.

### Big Features

- 💬 **Multi-turn AI Chat**: multiple chat threads per video; send **images with the current video timestamp**; time buttons in chat output seek the player too.
- 📦 **Batch Mode**: six source types (single video, user page, favorites, multi-P series, collection, search page) for batch subtitle acquisition or batch speech-to-subtitle; supports **multiple batch lists**; export to TXT/SRT/Markdown/ZIP.
- 🎙️ **Speech-to-Subtitle**: works with the Groq free tier; FFmpeg WASM local chunking; **Interleave Mode** alternates two models across odd/even chunks to spread quota usage and reduce rate-limit triggers; four language modes: Chinese / English / Other / Mixed.

### More

- 🗂️ **Archive + Tags**: session-mode archive supports tags (up to 200 tags, ≤20 characters per name), pinning and drag-sort; batch mode has its own archive area.
- 🗑️ **Trash + Auto-cleanup**: both modes have trash with retention periods: 7 / 30 / 365 days, custom, or keep forever; auto-cleanup at expiry.
- 💾 **Backup & Long-term Storage**: password-encrypted export/import for sessions, subtitles, and AI outputs; restore exactly as saved.
- 🌐 **Many AI Providers**: OpenAI, OpenRouter, DeepSeek, Gemini, Groq, Claude, Zhipu (BigModel), ModelScope, Kimi, MiMo, plus custom providers; each provider has its own API key.
- 🎨 **Polished UI**: light / dark / system theme, fixed blue accent, draggable two-pane layout; UI languages: 简体中文 / 繁體中文 / English / 日本語.

### ⏱️ Clickable Timestamps

In summary mode and chat mode, Bilimuzhi can embed **clickable timestamps** in the content:

- If the current page is the corresponding video, clicking seeks directly;
- If the video tab is open but not active, the extension switches to it and seeks;
- If no such tab is open, it asks whether to open the video and then seeks to that position.

**Core highlights**:

- 🎙️ **Subtitles + Speech-to-Subtitle**: official/AI/multi-language tracks; generate subtitles even for videos without them;
- 🧠 **AI Segments / Summary / Chat**: chaptered titles with overviews, three-level summaries, image chat — all with clickable timestamps;
- 📦 **Batch Processing**: six source kinds (video / multi-P / collections / favorites / user space / search) with bulk acquisition and export (TXT/SRT/Markdown/ZIP) to build your knowledge base;
- 🔒 **Privacy First**: no telemetry, no cloud accounts; API keys stay in your local browser. 

## 🎯 Use Cases

- You don't want to watch every frame — you just need the **gist**;
- Videos where **the picture barely matters** (podcasts, blogs, voice-over content) — listening/reading is enough;
- Building a **chapter index** for a video to quickly locate a section;
- Building an **AI knowledge base**: subtitle archiving, tagging, search, and export.

## 🚀 Typical Workflow

1. **Open a video → get subtitles**: open any Bilibili video page → open Bilimuzhi → "Get subtitles" (official / AI / multi-language tracks) or "Speech-to-subtitle" (for videos without subtitles).
2. **Quick AI understanding**: one-click segmentation (title + overview per segment) → one-click summary (Brief / Balanced / Detailed) → click the time links inside summaries/segments to jump back to the exact moment.
3. **Multi-turn follow-up**: open a chat about a confusing part; attach an image with the current timestamp so the AI can answer with visual context; time buttons in chat output jump the player.
4. **Long-term saving**: archive when done, add tags, set a trash retention period, and keep a password-encrypted backup you can restore anytime.
5. **Batch processing**: process multiple videos (user page / favorites / collection / multi-P / search page) at once with batch subtitle or speech-to-subtitle, and export uniformly to TXT/SRT/Markdown/ZIP to build a library.

## 🛠️ Installation & Quick Start

**Prerequisites**: any Chromium-based browser (Chrome, Edge, Brave, Vivaldi, Opera, etc.; MV3, Chromium 114 or later).

```bash
npm ci
npm run build
```

1. Open the browser's extension management page (`chrome://extensions` on Chrome-based browsers, `edge://extensions` on Edge, similar entry points on other Chromium-based browsers);
2. Enable "Developer mode";
3. Click "Load unpacked" and select the `dist/extension` directory.

**First use**: open any Bilibili video page → click the extension icon to open Bilimuzhi → "Get subtitles" or "Speech-to-subtitle".

> 💡 Don't want to build from source? Download the packaged ZIP from [GitHub Releases](https://github.com/StaySound4/bilimuzhi/releases), unzip it, and load it via developer mode.

**API keys**: enter them in Settings (stored locally in your browser only).

## 🔒 Security & Privacy Pledge

- **No telemetry, no statistics, no cloud account**;
- **API keys are stored only in local browser storage**; the UI only shows "configured or not";
- **AI chat connects directly to the provider you choose, only after you configure a key**;
- **No bypassing of login, paywalls, DRM, or regional restrictions; subtitle acquisition for charged/paid content is not supported**;
- **Subtitle and Cookie handling all happen in your local browser**; see the [Privacy Policy](PRIVACY.en.md) and [Risk Disclosure](RISKS.md).

## ⚠️ Known Limitations

- Bilibili only; MV3 Side Panel on Chromium-based browsers only (no Firefox/Safari or other non-Chromium engines);
- **Subtitle acquisition for charged/paid content is not supported**;
- In-page fetch/XHR subtitle capture is not implemented yet (the official subtitle API path is used);
- Speech-to-subtitle depends on the Groq free tier and has rate limits;
- Batch sources may break when Bilibili interfaces change;
- Design target is 10,000-row subtitles and ~500 messages; the automated performance gate is not yet complete and extreme scale is not stress-tested.

## 📸 Screenshots

### Sessions & Subtitle Acquisition

| Screenshot | Description |
|---|---|
| ![Session management](assets/screenshots/session-management.png) | Session management: create / search / archive sessions, open a video session by BV ID or full URL |
| ![Acquire subtitles](assets/screenshots/timeline-acquire-subtitle.png) | Timeline mode: built-in subtitle tracks or speech-to-subtitle |
| ![Segments & timeline](assets/screenshots/segments-timeline.png) | Segmentation result (titles + overviews + timestamps) next to the subtitle timeline |

### AI Capabilities

| Screenshot | Description |
|---|---|
| ![Summary with timestamp jump](assets/screenshots/timestamp-jump.png) | Clickable timestamps inside summaries jump the player to the exact moment |
| ![Light & dark themes](assets/screenshots/theme-light-dark-summary.png) | Light / dark theme comparison: summary output and timestamps |
| ![Customizable outputs](assets/screenshots/output-layout-customization.png) | Per-mode output layout with highly customizable model configuration (provider / model / reasoning / language) |
| ![Chat mode](assets/screenshots/chat-image-timestamps.png) | Multi-turn AI chat: attach images (with the current video timestamp); replies carry seekable time indexes |
| ![Ad recognition](assets/screenshots/segments-ad-recognition.png) | Segmentation mode auto-detects ad segments |

### Batch Mode

| Screenshot | Description |
|---|---|
| ![Batch parse](assets/screenshots/batch-parse-dialog.png) | Six source kinds: single video, multi-P playlist, user space, favorites, collection, search |
| ![Batch list](assets/screenshots/batch-list-success.png) | Batch list: 40 videos added, per-row status visible |
| ![Batch acquiring](assets/screenshots/batch-acquire-progress.png) | Batch acquisition / speech-to-subtitle in progress: spinning status dots with live progress |
| ![Export](assets/screenshots/batch-export-format.png) | Batch export: TXT / SRT / Markdown, ZIP packaging supported |

### Misc

| Screenshot | Description |
|---|---|
| ![Languages](assets/screenshots/settings-language.png) | UI languages: 简体中文 / 繁體中文 / English / 日本語 |

## 💖 Support Me

If Bilimuzhi helps you, feel free to:

- ⭐ **Star me on [GitHub](https://github.com/StaySound4/bilimuzhi)** — one star from you means a lot to me;
- 💬 Something feels off, you found a bug, or you have an idea to make Bilimuzhi better? Open an [Issue](https://github.com/StaySound4/bilimuzhi/issues) — don't worry about wording it perfectly; just tell me what happened, what you expected, and what you'd love to see. I read every single one;
- 🤝 Know your way around code? **Pull Requests** are welcome too — a few more steps than Issues: the full gate (`npm run check:full`) must pass, new features need tests, and commit messages follow a format; see [CONTRIBUTING.md](CONTRIBUTING.md) for the complete rules. Straightforward enough.

> The project is maintained by the author in spare time, so replies may take a while — but every Issue and PR will be seen by me.

## 📚 Documentation

- [隐私政策(中文)](PRIVACY.zh-CN.md) / [Privacy Policy (English)](PRIVACY.en.md)
- [Risk Disclosure](RISKS.md)
- [Technical Notes (mechanism-level, Chinese)](TECHNICAL.zh-CN.md)
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Disclaimer](DISCLAIMER.md)
- [Changelog](CHANGELOG.md)

## 🎁 Acknowledgments & Inspiration

Bilimuzhi is a **fully independently developed** project: all code, architecture, and copy are designed and implemented by the project itself. During development, some excellent similar products in the community also inspired our thinking about interaction patterns — our thanks to them:

### SubBatch — Bilibili batch subtitle downloader

Thanks for inspiring the community around batch subtitle acquisition workflows.

- GitHub discussion (where it was featured): <https://github.com/ruanyf/weekly/issues/8776>
- Chrome Web Store: <https://chromewebstore.google.com/detail/subbatch-b%E7%AB%99%E5%AD%97%E5%B9%95%E6%89%B9%E9%87%8F%E4%B8%8B%E8%BD%BD%E5%B7%A5%E5%85%B7/khokmgnfhchkclncfkeccepcamdannoj>
- Developer on GitHub: itchaox
- Bilibili homepage: <https://space.bilibili.com/521041866>

### Bilitato — AI companion for browsing Bilibili

Thanks for its explorations in AI-companion viewing, speech transcription, and timestamp-jump interaction patterns.

- Chrome Web Store: <https://chromewebstore.google.com/detail/bilitato-ai%E9%99%AA%E4%BD%A0%E7%9C%8Bb%E7%AB%99/ggddcgdafeeoijoaohcffinbefcbpcga>
- GitHub repository: <https://github.com/erikzhuang55/Bilitato>
- Developer on GitHub: erikzhuang55

### A Special Thanks to Our AI Companions

Last but not least, a special thanks to **OpenAI ChatGPT** and **DeepSeek** for their selfless dedication: they've accompanied me all the way from "what does this error mean" to "please refactor this", with the patience of a 24/7 hotline — and never once asked "why don't you do it yourself". Thanks to them, someone with a modest coding background like me could vibe-code this project into existence. Any "flair" you spot in the code style is probably their midnight overtime.


> **Independence statement**: Bilimuzhi's code, copy, and architecture are **independently designed and implemented**; they contain no code, assets, materials, or private interfaces from any third-party project, and have no code-level association with any third-party project. If you have any questions about copyright, feel free to open an Issue.

## 📜 Open Source License

This project is released under the **MIT License**; see [LICENSE](LICENSE). You are free to use, modify, redistribute, and even use it commercially, as long as the copyright and permission notice are preserved. The project is provided "AS IS" without any warranty.

**Non-official notice**: Bilimuzhi is an independently developed third-party browser extension, **not an official Bilibili product and not affiliated with Bilibili Inc.**; "Bilibili/哔哩哔哩" is a third-party trademark used only to describe compatibility.
