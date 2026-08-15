# 贡献指南 / Contributing Guide

> 感谢你考虑为Bilimuzhi(Bilimuzhi)贡献!本项目处于 **Beta / 开发中预览**阶段。
> Thank you for considering contributing to Bilimuzhi! This project is in **Beta / preview**.
>
> 本指南中文为主,关键条款附英文。贡献前请先阅读 [README](README.md)、[行为准则](CODE_OF_CONDUCT.md) 与 [技术说明](TECHNICAL.zh-CN.md)。
> This guide is primarily in Chinese, with key clauses in English. Please read the README, Code of Conduct, and Technical notes first.

## 不接受的范围(红线)/ Out of Scope (Red Lines)

以下类型的功能与贡献**不会被接受**(D8)。Please do not submit contributions in these areas:

1. **绕过付费/权限/地区限制**:绕过 B 站付费、充电、DRM、会员或地区限制的功能;Bilimuzhi**不支持充电视频/付费内容字幕获取**。
   *Bypassing Bilibili payments, charging, DRM, membership, or regional restrictions; Bilimuzhi does not support paid/charged content subtitles.*
2. **Cookie 导入/导出与凭证持久化**:Cookie 导入/导出、凭证持久化、账号相关工具。
   *Cookie import/export, credential persistence, or account-related tooling.*
3. **批量爬取/搬运**:批量爬取或搬运内容、违反平台条款的采集。
   *Bulk scraping or redistribution of content, or collection that violates platform terms.*
4. **遥测/广告/云账号**:引入遥测、广告或云端账号。
   *Introducing telemetry, advertising, or cloud accounts.*
5. **扩大权限面**:未经确认扩大 `host_permissions` / `permissions` 的改动。
   *Changes that expand host_permissions or permissions without prior approval.*
6. **真实密钥/令牌**:涉及真实密钥、令牌的代码、测试或截图。
   *Code, tests, or screenshots involving real keys or tokens.*

## 如何报告 Bug / Reporting Bugs

新建 Issue 时会自动套用**简化模板**(报告问题/功能建议两种),跟着提示填就好,不用写得专业——说清楚"发生了什么、你做了什么、你希望怎样"即可。需要提供的最基本信息:

- Bilimuzhi版本(如 0.9.0)与浏览器(Chrome/Edge 及版本);
- 复现步骤(打开什么视频、执行什么操作);
- 预期行为与实际行为;
- 控制台错误信息(如有)。

*Please provide: version and browser, reproduction steps, expected vs actual behavior, and console errors.*

## 如何提交 PR / Submitting Pull Requests

**PR 的接受标准比 Issue 更严格**:Issue 只需把问题说清楚;PR 必须**可构建、可测试、可维护**。以下为提交 PR 的规范化要求:

1. **开发环境**:`npm ci`(不要修改 lockfile)。
2. **门禁**:提交前 `npm run check:full`(format/lint/typecheck/i18n/全部测试/build/密钥扫描)必须**全绿**;修改后重跑。
   *The full gate `npm run check:full` must pass before submission.*
3. **提交信息**:`type(scope): 描述`(feat/fix/docs/test/refactor/chore)。
4. **测试**:新增功能必须带测试;不得删除或弱化现有门禁。
5. **注释与文档**:使用中文注释与文档。
6. **Review 流程**:提交后由维护者 review,可能需要调整;合入前必须满足——全部门禁通过、不触碰红线、改动范围聚焦于一个主题。

## 贡献者权利声明 / Contributor Rights

本项目基于 **MIT License** 开源。提交 PR 即代表贡献者同意其贡献按 MIT 授权分发,且贡献者保证拥有所贡献内容的权利(不包含未经授权复制的第三方代码)。
*This project is released under the MIT License. By submitting a PR, you agree that your contribution is distributed under the MIT License, and you warrant that you own the rights to the contributed content (and that it does not include unauthorized third-party code).*

## 沟通渠道 / Communication

通过 [GitHub Issues](https://github.com/StaySound4/bilimuzhi/issues) 讨论与本项目相关的问题;也欢迎到 [Discussions](https://github.com/StaySound4/bilimuzhi/discussions) 闲聊与提问。
*Discussions happen via GitHub Issues.*
