import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const outputDirectory = fileURLToPath(
  new URL("../dist/extension/", import.meta.url),
);

if (!outputDirectory.startsWith(projectRoot)) {
  throw new Error(
    `Refusing to clean an output outside the project: ${outputDirectory}`,
  );
}

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });
