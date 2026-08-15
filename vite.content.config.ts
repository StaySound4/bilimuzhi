import { defineConfig } from "vite";

function toFileSystemPath(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\/(?=[A-Za-z]:\/)/, ""));
}

export default defineConfig({
  publicDir: false,
  build: {
    outDir: toFileSystemPath(new URL("dist/extension/", import.meta.url)),
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: toFileSystemPath(
        new URL("src/entries/content-script.ts", import.meta.url),
      ),
      name: "BilimuzhiContentScript",
      formats: ["iife"],
      fileName: () => "content-script.js",
    },
  },
});
