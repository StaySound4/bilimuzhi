# 安全策略 / Security Policy

## 报告方式 / Reporting

请通过以下方式报告安全漏洞(请勿使用真实邮箱):

- **首选**:GitHub 私有漏洞报告(Security Advisories);
- 或公开 [Issue](https://github.com/StaySound4/bilimuzhi/issues) 并标注 `[Security]`。

*Please report security vulnerabilities via GitHub private Security Advisories, or a public Issue tagged `[Security]`.*

请**不要**在公开渠道披露未修复漏洞的细节,直到修复发布。

*Please do not disclose details of unpatched vulnerabilities publicly until a fix is released.*

## 响应承诺 / Response Commitment

- 确认收到后 **7 天内**给出初步响应;
- 修复后发布说明(版本与受影响范围)。

*I will respond within 7 days of confirmation and publish release notes after a fix.*

## 安全设计摘要 / Security Design Summary

Bilimuzhi的安全设计要点:

- **无遥测、无云端后端**:不采集使用数据,无强制云端服务;
- **API Key 仅本地存储**:密钥存于浏览器本地(`chrome.storage.local`),公共界面只显示"是否已配置";
- **Markdown/HTML 净化与提示词注入隔离**:输出净化;字幕等不可信内容经四层提示词隔离(untrusted 标记 + 转义),不执行其中指令;
- **签名媒体地址/供应商原始响应不持久化**:临时数据不进业务实体;
- **Cookie 快照仅存本地**:仅用于本地授权媒体请求,不持久化、不导出、不上传、不进入业务数据;
- **密钥扫描门禁**:`npm run scan:secrets` 为发布门禁的一部分。

*No telemetry or cloud backend; API keys stored locally only; Markdown/HTML sanitization and prompt-injection isolation; signed media addresses and raw responses are not persisted; the Cookie snapshot stays local; secret scanning is part of the release gate.*

## 已知安全边界 / Known Security Boundaries

- **本机恶意软件**:任何本地存储(包括浏览器本地存储)都可能被本机恶意软件读取;建议使用低权限/额度受限的 API Key(详见 [RISKS](RISKS.md));
- **第三方 AI 服务商**:数据发送至您选择的服务商后,其数据政策不在本项目控制范围内。

*Local malware can read local storage; data sent to third-party AI providers is governed by their policies, which are outside this project's control.*

## 协调披露 / Coordinated Disclosure

建议 **90 天**协调披露窗口:漏洞报告后 90 天内不公开细节,以便修复与发布。

*I recommend a 90-day coordinated disclosure window before publicizing details.*
