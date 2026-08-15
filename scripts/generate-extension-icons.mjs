import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const generator = resolve(scriptDirectory, "generate-extension-icons.py");
const pythonCandidates =
  process.platform === "win32" ? ["python", "py"] : ["python3", "python"];

let lastError = "未找到 Python。";
for (const executable of pythonCandidates) {
  const args = executable === "py" ? ["-3", generator] : [generator];
  const result = spawnSync(executable, args, { stdio: "inherit" });
  if (result.error?.code === "ENOENT") {
    lastError = `${executable} 不可用。`;
    continue;
  }
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

throw new Error(
  `${lastError} 图标源文件已经提交；如需重新生成，请安装 Python 3 与 Pillow。`,
);
