import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

function toFileSystemPath(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\/(?=[A-Za-z]:\/)/, ""));
}

const entriesRoot = toFileSystemPath(new URL("src/entries/", import.meta.url));
const extensionStaticRoot = toFileSystemPath(
  new URL("src/extension-static/", import.meta.url),
);

/** 构建时是否加入 QA harness 入口（仅 `npm run build:qa` 设置）。 */
declare const process: { env: Record<string, string | undefined> };
const isQaBuild = process.env.VITE_QA_HARNESS === "1";

export default defineConfig({
  root: entriesRoot,
  publicDir: extensionStaticRoot,
  plugins: [preact({ devToolsEnabled: false })],
  build: {
    outDir: toFileSystemPath(new URL("dist/extension/", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    rolldownOptions: {
      input: {
        sidepanel: toFileSystemPath(
          new URL("src/entries/sidepanel.html", import.meta.url),
        ),
        offscreen: toFileSystemPath(
          new URL("src/entries/offscreen.html", import.meta.url),
        ),
        "service-worker": toFileSystemPath(
          new URL("src/entries/service-worker.ts", import.meta.url),
        ),
        ...(isQaBuild
          ? {
              "qa-harness": toFileSystemPath(
                new URL("src/entries/qa-harness.html", import.meta.url),
              ),
            }
          : {}),
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "service-worker"
            ? "[name].js"
            : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
