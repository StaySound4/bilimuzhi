from __future__ import annotations

from pathlib import Path

try:
    from PIL import Image
except ImportError as error:
    raise SystemExit(
        "缺少 Pillow。请先运行 `python -m pip install Pillow`，再重新生成图标。"
    ) from error


ROOT = Path(__file__).resolve().parent.parent
ICON_DIRECTORY = ROOT / "src" / "extension-static" / "icons"
MASTER = ICON_DIRECTORY / "muzhi-logo.png"
SIZES = (16, 32, 48, 128)


def render_icon(master: Image.Image, size: int) -> Image.Image:
    icon = master.copy()
    icon.thumbnail((size, size), Image.Resampling.LANCZOS, reducing_gap=3.0)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset = ((size - icon.width) // 2, (size - icon.height) // 2)
    canvas.alpha_composite(icon, dest=offset)
    return canvas


def main() -> None:
    if not MASTER.is_file():
        raise SystemExit(f"找不到主 Logo：{MASTER}")
    with Image.open(MASTER) as source:
        master = source.convert("RGBA")
        for size in SIZES:
            target = ICON_DIRECTORY / f"muzhi-{size}.png"
            render_icon(master, size).save(target, format="PNG", optimize=True)
            print(f"wrote {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
