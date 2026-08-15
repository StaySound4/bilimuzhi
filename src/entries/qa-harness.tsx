/**
 * QA harness 入口（仅 `npm run build:qa` 构建；生产 build 不包含本页面）。
 *
 * 使用：chrome-extension://<extensionId>/qa-harness.html?scenario=<id>&theme=<light|dark>
 * 渲染真实组件 props 投影，并暴露 window.__MUZHI_QA__ 供浏览器 helper 读取
 * scenario proof / 主题属性 / 计算样式。
 */
import { render } from "preact";
import "../ui/ai-chat-shell.css";
import "../ui/archive/archive-workspace.css";
import "../ui/batch/batch-workspace.css";
import "../ui/chat/chat-workspace.css";
import "../ui/dialogs/app-dialog.css";
import "../ui/insights/insight-workspace.css";
import "../ui/prompts/prompt-manager-dialog.css";
import "../ui/settings/settings-drawer.css";
import "../ui/trash/trash-workspace.css";
import { QaHarness } from "../qa/harness";

const root = document.getElementById("app");
if (root === null) {
  throw new Error("QA harness 挂载点缺失");
}

render(<QaHarness />, root);
