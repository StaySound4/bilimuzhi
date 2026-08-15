import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  findMissingRequired,
  parseFilename,
  resolveProfile,
  validateDuplicateHashes,
  validateEnums,
  validateExceptions,
  validateFileField,
  validateFilenameContract,
  validateHash,
  validateManifestShape,
  validatePageIdentity,
  validatePngSize,
  validateScenarioCounts,
  validateTheme,
} from "../../scripts/visual-evidence/rules.mjs";
import {
  createPngBuffer,
  parsePngSize,
  relativeLuminance,
  sha256Hex,
} from "../../scripts/visual-evidence/png.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MATRIX = JSON.parse(
  readFileSync(join(ROOT, "scripts", "visual-evidence", "matrix.json"), "utf8"),
);

/** 构造一个合法的 manifest 基底（所有字段完整）。 */
function validManifest(overrides = {}) {
  return {
    file: "shell-tabs-selected-light-w520-abc1234.png",
    sha256: "a".repeat(64),
    commit: "abc1234",
    surface: "shell",
    state: "tabs-selected",
    theme: "light",
    viewport: "520x900",
    deviceScaleFactor: 1,
    scenarioId: "shell-tabs-selected",
    activeTab: "timeline",
    interactionStep: 0,
    themeAttribute: { name: "data-theme", value: "light" },
    computedStyles: {
      canvas: "#f6f8fb",
      background: "#ffffff",
      text: "#172033",
      accent: "#1769e8",
    },
    scenarioCounts: { tabs: 4 },
    url: "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/sidepanel.html?scenario=shell-tabs-selected",
    capturedAt: "2026-08-11T10:00:00.000Z",
    ...overrides,
  };
}

describe("resolveProfile", () => {
  it("无参数默认 final", () => {
    expect(resolveProfile({})).toEqual({
      ok: true,
      profile: "final",
      ticket: null,
      error: null,
    });
  });

  it("ticket 参数隐含 ticket profile", () => {
    expect(resolveProfile({ ticket: "03" })).toEqual({
      ok: true,
      profile: "ticket",
      ticket: "03",
      error: null,
    });
  });

  it("ticket profile 必须带 --ticket", () => {
    expect(resolveProfile({ profile: "ticket" }).ok).toBe(false);
  });

  it("未知 profile 拒绝", () => {
    expect(resolveProfile({ profile: "bogus" }).ok).toBe(false);
  });

  it("--ticket 与 final 搭配拒绝", () => {
    expect(resolveProfile({ profile: "final", ticket: "03" }).ok).toBe(false);
  });
});

describe("manifest shape", () => {
  it("合法 manifest 无错误", () => {
    expect(validateManifestShape(validManifest())).toEqual([]);
  });

  it("缺必需字段报错", () => {
    const m = validManifest() as Partial<ReturnType<typeof validManifest>>;
    delete m.sha256;
    const errors = validateManifestShape(m);
    expect(errors.some((e) => e.includes("sha256"))).toBe(true);
  });

  it("sha256 格式必须 64 位十六进制", () => {
    const errors = validateManifestShape(validManifest({ sha256: "xyz" }));
    expect(errors.some((e) => e.includes("sha256"))).toBe(true);
  });

  it("viewport 必须是 WxH", () => {
    const errors = validateManifestShape(validManifest({ viewport: "520" }));
    expect(errors.some((e) => e.includes("viewport"))).toBe(true);
  });

  it("capturedAt 必须是可解析时间", () => {
    const errors = validateManifestShape(
      validManifest({ capturedAt: "不是时间" }),
    );
    expect(errors.some((e) => e.includes("capturedAt"))).toBe(true);
  });

  it("非对象 manifest 直接拒绝", () => {
    expect(validateManifestShape(null).length).toBeGreaterThan(0);
    expect(validateManifestShape([]).length).toBeGreaterThan(0);
  });
});

describe("file / hash / size", () => {
  it("file 字段与磁盘文件名一致（含 Windows 反斜杠路径）", () => {
    expect(
      validateFileField(
        "shell-tabs-selected-light-w520-abc1234.png",
        "shell-tabs-selected-light-w520-abc1234.png",
      ),
    ).toEqual([]);
    // Windows 风格相对路径
    expect(
      validateFileField(
        "docs\\design-audit-screenshots\\x\\shell-tabs-selected-light-w520-abc1234.png",
        "shell-tabs-selected-light-w520-abc1234.png",
      ),
    ).toEqual([]);
    // 正斜杠路径同样兼容
    expect(
      validateFileField(
        "docs/design-audit-screenshots/x/shell-tabs-selected-light-w520-abc1234.png",
        "shell-tabs-selected-light-w520-abc1234.png",
      ),
    ).toEqual([]);
  });

  it("file 指向不同文件报错", () => {
    expect(
      validateFileField(
        "other.png",
        "shell-tabs-selected-light-w520-abc1234.png",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("sha256 与真实 hash 一致通过，不一致报错", () => {
    const buf = createPngBuffer(4, 4, [1, 2, 3]);
    const real = sha256Hex(buf);
    expect(validateHash(real, real)).toEqual([]);
    expect(validateHash("0".repeat(64), real).length).toBeGreaterThan(0);
  });

  it("PNG 尺寸必须等于 viewport × deviceScaleFactor", () => {
    const png = parsePngSize(createPngBuffer(520, 900, [1, 2, 3]));
    expect(validatePngSize("520x900", 1, png)).toEqual([]);
    // 2x scale
    const png2x = parsePngSize(createPngBuffer(1040, 1800, [1, 2, 3]));
    expect(validatePngSize("520x900", 2, png2x)).toEqual([]);
    // 尺寸不符
    expect(validatePngSize("320x200", 1, png).length).toBeGreaterThan(0);
    expect(validatePngSize("520x900", 2, png).length).toBeGreaterThan(0);
  });
});

describe("enums", () => {
  it("未知 surface / state / theme 报错", () => {
    expect(
      validateEnums(validManifest({ surface: "nope" }), MATRIX).some((e) =>
        e.includes("surface"),
      ),
    ).toBe(true);
    expect(
      validateEnums(validManifest({ state: "nope" }), MATRIX).some((e) =>
        e.includes("state"),
      ),
    ).toBe(true);
    expect(
      validateEnums(validManifest({ theme: "nope" }), MATRIX).some((e) =>
        e.includes("theme"),
      ),
    ).toBe(true);
  });

  it("合法枚举无错误", () => {
    expect(validateEnums(validManifest(), MATRIX)).toEqual([]);
  });
});

describe("theme 真实性", () => {
  it("themeAttribute 必须包含主题关键字（防只改文件名）", () => {
    const errors = validateTheme(
      validManifest({ themeAttribute: { name: "data-theme", value: "dark" } }),
    );
    expect(errors.some((e) => e.includes("不包含主题关键字 light"))).toBe(true);
  });

  it("dark 声明配 light 计算样式 → 主题伪造", () => {
    const m = validManifest({
      theme: "dark",
      themeAttribute: { name: "data-theme", value: "dark" },
      computedStyles: {
        canvas: "#f6f8fb",
        background: "#ffffff",
        text: "#172033",
        accent: "#1769e8",
      },
    });
    const errors = validateTheme(m);
    expect(errors.some((e) => e.includes("dark 主题 text"))).toBe(true);
    expect(errors.some((e) => e.includes("dark 主题 canvas"))).toBe(true);
  });

  it("light 声明配 dark 计算样式 → 主题伪造", () => {
    const m = validManifest({
      computedStyles: {
        canvas: "#0f1722",
        background: "#151f2d",
        text: "#edf3ff",
        accent: "#1769e8",
      },
    });
    const errors = validateTheme(m);
    expect(errors.some((e) => e.includes("light 主题 text"))).toBe(true);
  });

  it("设计权威 token 的 light/dark 均通过", () => {
    const light = validManifest();
    const dark = validManifest({
      theme: "dark",
      themeAttribute: { name: "data-theme", value: "dark" },
      computedStyles: {
        canvas: "#0f1722",
        background: "#151f2d",
        text: "#edf3ff",
        accent: "#1769e8",
      },
    });
    expect(validateTheme(light)).toEqual([]);
    expect(validateTheme(dark)).toEqual([]);
  });

  it("computedStyles 缺少关键键报错", () => {
    const m = validManifest({ computedStyles: { canvas: "#f6f8fb" } });
    expect(validateTheme(m).some((e) => e.includes("缺少关键键"))).toBe(true);
  });

  it("相对亮度与设计 token 方向一致", () => {
    // 深色文字亮度低、浅色文字亮度高
    expect(relativeLuminance([0x17, 0x20, 0x33])).toBeLessThan(0.1);
    expect(relativeLuminance([0xed, 0xf3, 0xff])).toBeGreaterThan(0.8);
  });
});

describe("scenarioCounts 状态证明", () => {
  it("populated 类 state 全 0 → 报错", () => {
    const m = validManifest({ scenarioCounts: { tabs: 0 } });
    expect(
      validateScenarioCounts(m, MATRIX.minimumCounts).some((e) =>
        e.includes("不能为 0"),
      ),
    ).toBe(true);
  });

  it("populated 低于最小阈值 → 报错", () => {
    const m = validManifest({ scenarioCounts: { tabs: 1 } });
    expect(
      validateScenarioCounts(m, MATRIX.minimumCounts).some((e) =>
        e.includes("低于最小阈值 4"),
      ),
    ).toBe(true);
  });

  it("空态允许 0 计数", () => {
    const m = validManifest({ state: "empty", scenarioCounts: { tabs: 0 } });
    expect(validateScenarioCounts(m, MATRIX.minimumCounts)).toEqual([]);
  });

  it("非负整数约束", () => {
    const m = validManifest({ scenarioCounts: { tabs: -1 } });
    expect(
      validateScenarioCounts(m, MATRIX.minimumCounts).some((e) =>
        e.includes("非负整数"),
      ),
    ).toBe(true);
    const m2 = validManifest({ scenarioCounts: { tabs: "4" } });
    expect(
      validateScenarioCounts(m2, MATRIX.minimumCounts).some((e) =>
        e.includes("非负整数"),
      ),
    ).toBe(true);
  });
});

describe("页面身份", () => {
  it("chrome-extension URL + 合法 activeTab 通过", () => {
    expect(validatePageIdentity(validManifest(), MATRIX)).toEqual([]);
  });

  it("非 chrome-extension URL 报错", () => {
    const m = validManifest({ url: "https://example.com/sidepanel.html" });
    expect(
      validatePageIdentity(m, MATRIX).some((e) =>
        e.includes("chrome-extension"),
      ),
    ).toBe(true);
  });

  it("URL 页面不属于该 surface 报错", () => {
    const m = validManifest({
      url: "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/settings.html",
    });
    expect(
      validatePageIdentity(m, MATRIX).some((e) => e.includes("页面应为")),
    ).toBe(true);
  });

  it("activeTab 不属于 surface 报错", () => {
    const m = validManifest({ activeTab: "batch" });
    expect(
      validatePageIdentity(m, MATRIX).some((e) => e.includes("activeTab")),
    ).toBe(true);
  });
});

describe("文件名契约", () => {
  it("合法文件名解析", () => {
    expect(
      parseFilename(
        "batch-workspace-mixed-light-w360-abc1234.png",
        MATRIX.surfaces,
      ),
    ).toEqual({
      surface: "batch-workspace",
      state: "mixed",
      theme: "light",
      width: 360,
      commit: "abc1234",
    });
  });

  it("多段 state（partial-failure）正确解析", () => {
    expect(
      parseFilename(
        "batch-workspace-partial-failure-dark-w1158-abc1234.png",
        MATRIX.surfaces,
      )!.state,
    ).toBe("partial-failure");
  });

  it("文件名与 manifest 不一致报错", () => {
    const m = validManifest({ state: "quick-switch" });
    const errors = validateFilenameContract(
      "shell-tabs-selected-light-w520-abc1234.png",
      m,
      MATRIX,
    );
    expect(errors.some((e) => e.includes("state"))).toBe(true);
  });

  it("文件名宽度与 viewport 不一致报错", () => {
    const m = validManifest({ viewport: "1158x900" });
    expect(
      validateFilenameContract(
        "shell-tabs-selected-light-w520-abc1234.png",
        m,
        MATRIX,
      ).some((e) => e.includes("宽度")),
    ).toBe(true);
  });

  it("不符合契约的文件名报错", () => {
    const m = validManifest({ file: "random.png" });
    expect(
      validateFilenameContract("random.png", m, MATRIX).some((e) =>
        e.includes("不符合契约"),
      ),
    ).toBe(true);
  });
});

describe("重复 hash 与 exception", () => {
  const mkEntry = (
    file: string,
    sha: string,
    over: Partial<{
      surface: string;
      state: string;
      theme: string;
      viewport: string;
      viewportWidth: number;
    }> = {},
  ) => ({
    file,
    sha256: sha,
    surface: "shell",
    state: "tabs-selected",
    theme: "light",
    viewport: "520x900",
    viewportWidth: 520,
    ...over,
  });

  it("同 hash 两张 → 阻断（跨 theme/surface/state 复用）", () => {
    const entries = [
      mkEntry("a.png", "1".repeat(64)),
      mkEntry("b.png", "1".repeat(64)),
    ];
    const { errors } = validateDuplicateHashes(entries, []);
    expect(errors.some((e) => e.includes("重复 hash"))).toBe(true);
  });

  it("命中 required state 的组合禁止 exception 豁免", () => {
    const entries = [
      mkEntry("a.png", "1".repeat(64)),
      mkEntry("b.png", "1".repeat(64)),
    ];
    const requiredSet = new Set(["shell|tabs-selected|light|520"]);
    const exceptions = [
      {
        hash: "1".repeat(64),
        files: ["a.png", "b.png"],
        reason: "x",
        reviewer: "r",
        date: "2026-08-11",
        invalidReason: null,
      },
    ];
    const { errors } = validateDuplicateHashes(entries, exceptions, {
      requiredSet,
    });
    expect(errors.some((e) => e.includes("禁止 exception"))).toBe(true);
  });

  it("非 required 重复 + 合法 exception → 通过（仅警告）", () => {
    const entries = [
      mkEntry("a.png", "1".repeat(64)),
      mkEntry("b.png", "1".repeat(64)),
    ];
    const exceptions = [
      {
        hash: "1".repeat(64),
        files: ["a.png", "b.png"],
        reason: "临时复用",
        reviewer: "reviewer",
        date: "2026-08-11",
        invalidReason: null,
      },
    ];
    const { errors, warnings } = validateDuplicateHashes(entries, exceptions);
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes("例外豁免"))).toBe(true);
  });

  it("exception 未覆盖全部文件 → 仍阻断", () => {
    const entries = [
      mkEntry("a.png", "1".repeat(64)),
      mkEntry("b.png", "1".repeat(64)),
    ];
    const exceptions = [
      {
        hash: "1".repeat(64),
        files: ["a.png"],
        reason: "只覆盖一张",
        reviewer: "reviewer",
        date: "2026-08-11",
        invalidReason: null,
      },
    ];
    const { errors } = validateDuplicateHashes(entries, exceptions);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("exception 缺 reason/reviewer/date 或过期 → invalidReason", () => {
    const validated = validateExceptions(
      [
        {
          hash: "1".repeat(64),
          files: ["a"],
          reason: "",
          reviewer: "r",
          date: "2026-08-11",
        },
        {
          hash: "1".repeat(64),
          files: ["a"],
          reason: "x",
          reviewer: "",
          date: "2026-08-11",
        },
        {
          hash: "1".repeat(64),
          files: ["a"],
          reason: "x",
          reviewer: "r",
          date: "不是日期",
        },
        {
          hash: "1".repeat(64),
          files: ["a"],
          reason: "x",
          reviewer: "r",
          date: "2000-01-01",
        }, // 过期
      ],
      { maxAgeDays: 90 },
    );
    expect(validated[0].invalidReason).toContain("reason");
    expect(validated[1].invalidReason).toContain("reviewer");
    expect(validated[2].invalidReason).toContain("date");
    expect(validated[3].invalidReason).toContain("过期");
  });

  it("非数组 exceptions.json → invalidReason", () => {
    const validated = validateExceptions({ hash: "x" }, { maxAgeDays: 90 });
    expect(validated[0].invalidReason).toContain("必须是数组");
  });
});

describe("required-state matrix", () => {
  it("ticket 13 矩阵要求 batch-workspace/mixed 双主题四宽度", () => {
    const required = MATRIX.profiles["13"].required;
    const mixed = required.find(
      (r: { surface: string; state: string }) =>
        r.surface === "batch-workspace" && r.state === "mixed",
    )!;
    expect(mixed!.themes).toEqual(["light", "dark"]);
    expect(mixed.widths).toEqual([360, 520, 760, 1158]);
  });

  it("findMissingRequired 对空证据报告全部缺失", () => {
    const missing = findMissingRequired(MATCH_REQ(), []);
    expect(missing.length).toBe(2);
  });

  it("findMissingRequired 对完整证据无缺失", () => {
    const entries = [
      {
        file: "a.png",
        sha256: "a".repeat(64),
        surface: "shell",
        state: "tabs-selected",
        theme: "light",
        viewport: "520x900",
        viewportWidth: 520,
      },
      {
        file: "b.png",
        sha256: "b".repeat(64),
        surface: "shell",
        state: "tabs-selected",
        theme: "dark",
        viewport: "520x900",
        viewportWidth: 520,
      },
    ];
    expect(findMissingRequired(MATCH_REQ(), entries)).toEqual([]);
  });
});

/** 测试用最小 required 矩阵。 */
function MATCH_REQ() {
  return [
    {
      surface: "shell",
      state: "tabs-selected",
      themes: ["light", "dark"],
      widths: [520],
    },
  ];
}
