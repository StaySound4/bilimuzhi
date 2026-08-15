# Bilimuzhi(Bilimuzhi)风险告知书

> 版本:2026-08-13
> 适用:Bilimuzhi浏览器扩展(Beta / 开发中预览)。使用本扩展即表示您已知悉并接受以下风险。

## 使用须知

Bilimuzhi目前为 **Beta / 开发中预览**软件,按"现状"提供。以下风险分为四层:平台风险、AI 数据风险、隐私风险与法律免责。请在使用前完整阅读;重大风险变化将随版本更新在 CHANGELOG/README 中公告。

---

## ① 平台风险

1. **B 站条款与关联声明**:Bilimuzhi是**非官方第三方插件**,与哔哩哔哩公司无任何关联或背书。Bilibili 用户协议与社区规范可能对第三方插件有限制,请自行确认使用是否符合相关条款。
2. **接口随时可能变更或失效**:Bilimuzhi依赖 Bilibili 公开接口获取字幕;接口可能随时变更、失效或增加风控,导致功能不可用或需要等待修复。
3. **账号风控风险**:频繁请求可能触发账号风控。建议合理控制使用频率,批量模式注意请求间隔。
4. **充电/付费内容字幕不支持获取**:Bilimuzhi**不支持充电视频/付费内容字幕的获取**(此为实现边界,不代表禁止您观看任何视频),请勿期望绕过。

> **EN (Platform risks)**: Bilimuzhi is an unofficial third-party extension with no affiliation with Bilibili. Bilibili's interfaces may change, fail, or trigger risk control at any time, which may make features unavailable. Bilimuzhi does **not** support subtitles for paid/charged content.

---

## ② AI 数据风险

1. **数据发送至所选服务商**:字幕、对话与图片会发送至您在设置中选择的 AI 服务商(OpenAI、OpenRouter、DeepSeek、Gemini、Groq、Claude、智谱、ModelScope、Kimi、MiMo 或自定义 Provider)。各服务商的数据处理遵循其自身政策,**请勿向 AI 发送隐私或敏感信息**。
2. **服务商数据政策不在本项目控制内**:各服务商可能按其自身政策保留数据;使用即表示接受其政策。
3. **Groq 免费额度限制**:语音转字幕依赖 Groq 免费额度,存在速率与用量限制,可能随时调整。
4. **交叉模式不保证不限流**:交叉模式(奇偶分片轮换模型)只降低触发限流的概率,不保证不限流。

> **EN (AI data risks)**: Subtitle text, conversations, and images are sent to the AI provider you select; each provider's data handling follows its own policies. Avoid sending private or sensitive information to AI. The Groq free tier has rate and usage limits that may change at any time; interleave mode only reduces the probability of rate limiting, it does not guarantee it.

---

## ③ 隐私风险

1. **API Key 本地存储风险**:API Key 仅存储于浏览器本地,但任何本机存储都可能被本机恶意软件读取。建议使用低权限/额度受限的 Key。
2. **Cookie 快照本地处理声明**:Bilimuzhi在您的本地浏览器内自动读取 Bilibili Cookie 快照,仅用于授权媒体请求。**所有处理均在用户本地浏览器完成,与作者无关**;快照仅存于本地浏览器内存与临时会话规则,不持久化、不导出、不上传、不进入业务数据。
3. **加密备份风险**:加密备份文件仍可能因密码泄露而失密,请妥善保管密码与文件。
4. **权限说明**(逐项解释必要性):
   - `sidePanel`:侧边栏界面;
   - `storage` / `unlimitedStorage`:本地数据与设置;
   - `downloads`:备份与导出;
   - `offscreen`:语音转字幕的本地媒体处理;
   - `scripting` / `tabs`:页面桥与播放器跳转;
   - `cookies`:本地授权媒体请求;
   - `declarativeNetRequestWithHostAccess`:授权媒体网络规则。
   - 主机权限仅限 Bilibili 媒体域名与您启用的 AI 服务商域名,**不含 `<all_urls>`**。

> **EN (Privacy risks)**: API keys are stored locally only, but any local storage can be read by malware on your machine; use low-privilege keys. All Cookie handling happens locally in your browser and is unrelated to the author: the snapshot stays in local memory and ephemeral session rules — never exported, uploaded, or part of business data. Encrypted backups can be compromised if the password leaks. The extension's host permissions cover only Bilibili media domains and the AI providers you enable; no `<all_urls>` is used.

---

## ④ 法律免责

1. **非官方产品声明**:Bilimuzhi非 B 站官方产品,与哔哩哔哩公司无任何关联或背书;"Bilibili/哔哩哔哩"为第三方商标,仅用于描述兼容对象。
2. **责任限制**:本项目基于 **MIT License** 发布,并以"现状"提供,无任何担保;作者不对任何使用后果(包括但不限于账号异常、数据丢失)负责。
3. **使用者责任**:您不得将本扩展用于侵权搬运、绕过付费/DRM、或批量抓取违反平台条款的内容。
4. **不构成法律建议**:本告知书与项目文档不构成法律意见;涉及重大决策(如商用、数据合规)请咨询专业律师。

> **EN (Legal disclaimer)**: Bilimuzhi is not an official Bilibili product and has no affiliation with Bilibili; "Bilibili" is a third-party trademark used only to describe compatibility. The project is provided "AS IS" under the MIT License and without warranty; the authors are not liable for any consequences of use. You must not use it for infringing redistribution, bypassing paywalls/DRM, or scraping that violates platform terms. Nothing here constitutes legal advice.

---

## 风险变更通知方式

重大风险变化将随版本更新在 CHANGELOG 与 README 中公告;继续使用更新后的版本视为接受。
