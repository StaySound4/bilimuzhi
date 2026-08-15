import { beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

function toFileSystemPath(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\/(?=[A-Za-z]:\/)/, ""));
}

const emitted = new Map<
  string,
  { code?: string; source?: string | Uint8Array; type: string }
>();

beforeAll(async () => {
  for (const configName of ["vite.config.ts", "vite.content.config.ts"]) {
    const result = await build({
      configFile: toFileSystemPath(
        new URL(`../../${configName}`, import.meta.url),
      ),
      build: {
        write: false,
      },
      logLevel: "silent",
    });

    for (const buildResult of Array.isArray(result) ? result : [result]) {
      if (!("output" in buildResult)) continue;
      for (const item of buildResult.output) {
        emitted.set(item.fileName, item);
      }
    }
  }
});

describe("production extension entries", () => {
  it.each([
    "sidepanel.html",
    "offscreen.html",
    "service-worker.js",
    "content-script.js",
  ])("emits %s", (relativePath) => {
    expect(emitted.has(relativePath)).toBe(true);
  });

  it.each(["sidepanel.html", "offscreen.html"])(
    "%s references a bundled module entry",
    (relativePath) => {
      const html = String(emitted.get(relativePath)?.source ?? "");

      expect(html).toMatch(/<script[^>]+type="module"[^>]+src="[^"]+\.js"/);
    },
  );

  it("emits a self-contained classic content script", () => {
    const contentScript = emitted.get("content-script.js")?.code ?? "";

    expect(contentScript).not.toMatch(/^\s*(?:import|export)\b/m);
  });

  it("bundles the speech command coordinator and Offscreen chunk bridge into separate entries", () => {
    const serviceWorker = emitted.get("service-worker.js")?.code ?? "";
    const allJavaScript = [...emitted.values()]
      .map((item) => item.code ?? "")
      .join("\n");

    expect(serviceWorker).toContain("muzhi.speech.start");
    expect(allJavaScript).toContain("muzhi.offscreen.audio.prepare");
    expect(allJavaScript).toContain("muzhi.offscreen.audio.cancel");
    expect(serviceWorker).not.toContain("groq-secret");
  });
});
