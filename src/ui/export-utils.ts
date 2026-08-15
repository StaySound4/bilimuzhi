/**
 * 导出与下载工具：把内容渲染为 Markdown 并触发浏览器下载。
 *
 * 深模块：调用方传入内容与文件名，得到下载副作用；文件名净化、
 * Object URL 生命周期与文件选择限制全部集中在此。
 */
import type { SubtitleExportArtifact } from "../application/subtitle-export";
import type { Artifact, ChatMessage } from "../domain";

export function downloadSubtitleExport(artifact: SubtitleExportArtifact): void {
  const url = URL.createObjectURL(
    new Blob([artifact.content], { type: artifact.mimeType }),
  );
  const anchor = document.createElement("a");
  anchor.download = artifact.filename;
  anchor.href = url;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadMarkdown(title: string, content: string): void {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/markdown;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.download = `${title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.md`;
  anchor.href = url;
  anchor.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = url;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function pickTextFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.hidden = true;
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        input.remove();
        if (!file || file.size > 262_144) {
          resolve(null);
          return;
        }
        void file.text().then(resolve, () => resolve(null));
      },
      { once: true },
    );
    document.body.append(input);
    input.click();
  });
}

export function artifactMarkdown(
  artifact: Artifact,
  sessionTitle: string,
): string {
  const heading = artifact.kind === "segments" ? "分段" : "总结";
  if (artifact.kind === "summary" || artifact.segments.length === 0) {
    return `# ${sessionTitle} · ${heading}\n\n${artifact.content}\n`;
  }
  const clock = (totalMs: number): string => {
    const totalSeconds = Math.max(0, Math.floor(totalMs / 1_000));
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${pad(Math.floor(totalSeconds / 3_600))}:${pad(
      Math.floor((totalSeconds % 3_600) / 60),
    )}:${pad(totalSeconds % 60)}`;
  };
  return [
    `# ${sessionTitle} · ${heading}`,
    "",
    ...artifact.segments.flatMap((segment) => [
      `## [${clock(segment.startMs)} - ${clock(segment.endMs)}] ${segment.title}`,
      segment.detail,
      "",
    ]),
  ].join("\n");
}

export function chatThreadMarkdown(
  title: string,
  messages: readonly ChatMessage[],
): string {
  return [
    `# ${title}`,
    "",
    ...messages.map((item) => {
      const roleLabel = item.role === "user" ? "用户" : "Bilimuzhi";
      return `## ${roleLabel}\n\n${item.content}`;
    }),
  ].join("\n\n");
}

export function downloadChatThread(
  title: string,
  messages: readonly ChatMessage[],
): void {
  downloadMarkdown(title, chatThreadMarkdown(title, messages));
}
