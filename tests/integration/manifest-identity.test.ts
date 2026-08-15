import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { build, type InlineConfig, type UserConfig } from "vite";

import contentScriptConfig from "../../vite.content.config";
import extensionConfig from "../../vite.config";

const ICON_SIZES = [16, 32, 48, 128] as const;

interface ExtensionManifest {
  action: {
    default_icon: Record<string, string>;
    default_title: string;
  };
  background: { service_worker: string; type: string };
  content_scripts: Array<{ js: string[]; matches: string[]; run_at: string }>;
  content_security_policy: { extension_pages: string };
  description: string;
  host_permissions: string[];
  icons: Record<string, string>;
  key?: string;
  manifest_version: number;
  minimum_chrome_version: string;
  name: string;
  permissions: string[];
  side_panel: { default_path: string };
  version: string;
}

let manifest: ExtensionManifest;
let outputDirectory: string;
let temporaryDirectory: string;

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return files.flat();
}

function withOutputDirectory(
  config: UserConfig,
  emptyOutDir: boolean,
): InlineConfig {
  return {
    ...config,
    configFile: false,
    build: {
      ...config.build,
      emptyOutDir,
      outDir: outputDirectory,
    },
  };
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "muzhi-manifest-"));
  outputDirectory = resolve(temporaryDirectory, "extension");

  await build(withOutputDirectory(extensionConfig, true));
  await build(withOutputDirectory(contentScriptConfig, false));

  manifest = JSON.parse(
    await readFile(join(outputDirectory, "manifest.json"), "utf8"),
  ) as ExtensionManifest;
});

afterAll(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("clean-room extension build", () => {
  it("emits the Bilimuzhi MV3 Side Panel identity and runtime entries", async () => {
    expect(manifest).toMatchObject({
      manifest_version: 3,
      minimum_chrome_version: "114",
      name: "Bilimuzhi",
      version: "0.9.0",
      action: { default_title: "打开Bilimuzhi" },
      background: { service_worker: "service-worker.js", type: "module" },
      side_panel: { default_path: "sidepanel.html" },
      content_scripts: [
        {
          js: ["content-script.js"],
          matches: ["https://www.bilibili.com/video/*"],
          run_at: "document_idle",
        },
      ],
    });

    await expect(
      Promise.all(
        [
          "manifest.json",
          "sidepanel.html",
          "service-worker.js",
          "content-script.js",
          "offscreen.html",
        ].map((path) => readFile(join(outputDirectory, path))),
      ),
    ).resolves.toHaveLength(5);
  });

  it("does not lock a public extension ID before migration is contracted", () => {
    expect(manifest.key).toBeUndefined();
  });

  it("declares exactly the foundation-v3 Cookie and ephemeral DNR capabilities", () => {
    expect(new Set(manifest.permissions)).toEqual(
      new Set([
        "sidePanel",
        "storage",
        "unlimitedStorage",
        "downloads",
        "offscreen",
        "scripting",
        "tabs",
        "cookies",
        "declarativeNetRequestWithHostAccess",
      ]),
    );
    expect(manifest.permissions).toHaveLength(9);
    expect(manifest.host_permissions).toEqual([
      "https://*.bilibili.com/*",
      "https://*.bilivideo.com/*",
      "https://*.hdslb.com/*",
      "https://api.anthropic.com/*",
      "https://api.deepseek.com/*",
      "https://api.groq.com/*",
      "https://api-inference.modelscope.cn/*",
      "https://api.moonshot.cn/*",
      "https://api.openai.com/*",
      "https://api.xiaomimimo.com/*",
      "https://generativelanguage.googleapis.com/*",
      "http://localhost:11434/*",
      "https://open.bigmodel.cn/*",
      "https://openrouter.ai/*",
    ]);
    expect(manifest.host_permissions).not.toContain("<all_urls>");
    expect(manifest.host_permissions).not.toContain("https://*/*");
    expect(manifest.content_security_policy.extension_pages).toBe(
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    );
  });

  it.each(ICON_SIZES)("emits an original %ipx PNG icon", async (size) => {
    const relativePath = `icons/muzhi-${size}.png`;
    const icon = await readFile(join(outputDirectory, relativePath));

    expect(manifest.icons[String(size)]).toBe(relativePath);
    expect(manifest.action.default_icon[String(size)]).toBe(relativePath);
    expect([...icon.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const dimensions = new DataView(
      icon.buffer,
      icon.byteOffset,
      icon.byteLength,
    );
    expect(dimensions.getUint32(16)).toBe(size);
    expect(dimensions.getUint32(20)).toBe(size);
  });

  it("excludes private keys and legacy branding from the build", async () => {
    const files = await listFiles(outputDirectory);
    const paths = files.map((path) =>
      relative(outputDirectory, path).replaceAll("\\", "/"),
    );
    const contents = (
      await Promise.all(
        files.map(async (path) =>
          new TextDecoder().decode(await readFile(path)),
        ),
      )
    ).join("\n");

    expect(paths).not.toContain("manifest.pem");
    expect(paths.join("\n")).not.toMatch(
      /(?:^|\/)\.env|\.(?:key|p12|pem|pfx)$/i,
    );
    expect(contents).not.toMatch(
      /bilibili小助手|SubBatch|BEGIN (?:RSA )?PRIVATE KEY/i,
    );
  });
});
