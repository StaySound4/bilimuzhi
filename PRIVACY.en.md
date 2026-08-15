# Bilimuzhi Privacy Policy

> Effective date: 2026-08-13
> Scope: The Bilimuzhi browser extension (Manifest V3 / Side Panel), a subtitle workspace browser extension for Bilibili videos

## 1. Introduction and Scope

This policy describes all cases in which the Bilimuzhi extension collects, uses, stores, and discloses user data. Bilimuzhi is a **local-first** browser extension: subtitle acquisition, session management, archiving, and backup are performed in your local browser by default. AI conversations happen only after you actively configure an API key, connecting directly to the provider you choose. Bilimuzhi **collects no telemetry, runs no cloud account, and offers no cross-device synchronization.**

## 2. Information I Collect

The table below lists the data Bilimuzhi processes, where it is stored, and whether it leaves your device:

| Data | Description | Storage | Leaves device? |
|---|---|---|---|
| API keys | Keys you enter per AI provider in settings | Local browser storage only (`chrome.storage.local`); the UI shows only "configured or not" | **Sent only to the provider you choose** (for authentication) |
| Subtitle text and video identity (BVID/CID/page) | Acquired subtitle content and exact video identifiers | Local IndexedDB | Sent only to the provider you choose (for AI summary/segmentation/chat) or the speech-to-subtitle provider |
| Image attachments | Images you actively add to conversations | Local IndexedDB | Sent only to the image-capable provider selected for the current conversation |
| Current video page info (player time, etc.) | Used for timeline synchronization and seeking | Not stored | **Stays on device** |
| Cookie snapshot | Bilibili login state used for authorized media requests | **Local browser memory and ephemeral session rules only; not persisted** | **Never leaves the local browser**; not exported, not uploaded, not part of business data |
| Backup files | Encrypted backups you actively export | Kept by you | Under your control |

Bilimuzhi does **not** collect: names, email addresses, usernames, IP addresses, device identifiers, browsing history, clipboard content, geolocation, financial, health, or minor-related information.

## 3. How I Use Data

- **Subtitle acquisition**: Requests subtitle tracks and bodies from Bilibili's official interfaces (your browser carries your login state automatically).
- **AI analysis**: After you configure an API key, subtitle text, conversations, and images are sent to the provider you choose for summarization, segmentation, and multi-turn chat.
- **Speech-to-subtitle**: Local audio chunks are sent to the speech-to-subtitle provider you choose (Groq) for transcription.
- **Synchronization and seeking**: Player time is used locally only, for timeline synchronization and seeking; it never leaves your device.
- **Backup and restore**: Encrypted backups are exported or imported at your explicit action.

## 4. Data Storage and Retention

- The authoritative local store is IndexedDB (sessions, subtitles, archives, trash, conversations, tasks); `chrome.storage.local` holds only small settings and API keys.
- The trash uses a retention model: 7 / 30 / 365 days, custom, or keep forever, with automatic cleanup at expiry.
- You may permanently delete data at any time from the UI; uninstalling the extension deletes all local data.
- The Cookie snapshot is **not persisted**: it exists only in single-request memory and temporary session rules, and old snapshots are cleaned up at extension startup.

## 5. Sharing with Third Parties

Bilimuzhi sends data only to **providers you actively configure**. The default supported list: OpenAI, OpenRouter, DeepSeek, Gemini, Groq, Claude, Zhipu (BigModel), ModelScope, Kimi, MiMo, and custom providers (self-hosted endpoints). **Bilimuzhi includes no advertising, analytics, or telemetry third parties.**

## 6. AI Provider Data Handling

The AI providers you choose may be located in different parts of the world; their data handling follows their own privacy policies and applicable laws. By choosing a provider you acknowledge and consent to your data being processed according to their policies. **Do not send private or sensitive information to AI services.**

## 7. Your Rights

- **View and delete**: You can view and permanently delete local data from the UI.
- **Export backups**: You can export password-encrypted backup files at any time.
- **Uninstall deletes all**: Uninstalling the extension deletes all local data.
- **Opt out of AI**: Subtitle basics work without configuring any API key.

## 8. Minors

Bilimuzhi does not target data collection at minors and sets no age-restriction gate.

## 9. Policy Changes

Material changes will be announced in this repository and in the README; continued use constitutes acceptance of the updated policy.

## 10. Contact

For questions about this policy, please contact me via [GitHub Issues](https://github.com/StaySound4/bilimuzhi/issues).
