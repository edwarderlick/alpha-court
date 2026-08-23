"""Rasterize the line-only Alpha Court mark to favicon/OG PNG/ICO."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PURPLE = (189, 0, 255, 255)
LAVENDER = (236, 178, 255, 255)
LIME = (199, 243, 0, 255)
BG = (14, 14, 14, 255)
INK = (229, 226, 225, 255)
MUTED = (157, 139, 160, 255)

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
PUBLIC = ROOT / "public"
BRAND = PUBLIC / "brand"
APP.mkdir(exist_ok=True)
BRAND.mkdir(parents=True, exist_ok=True)
PUBLIC.mkdir(exist_ok=True)


def draw_mark(size: int, *, rounded_bg: bool = True) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    s = size / 32.0
    w = max(1.0, 1.75 * s)

    def px(x: float, y: float) -> tuple[float, float]:
        return x * s, y * s

    if rounded_bg:
        r = max(1, int(6 * s))
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=BG)

    # court square
    x0, y0 = px(3.25, 3.25)
    x1, y1 = px(3.25 + 25.5, 3.25 + 25.5)
    rr = max(1, int(2.5 * s))
    draw.rounded_rectangle((x0, y0, x1, y1), radius=rr, outline=PURPLE, width=max(1, round(w)))

    # A
    draw.line([px(9.5, 23.25), px(16, 8.75), px(22.5, 23.25)], fill=LAVENDER, width=max(1, round(w)), joint="miter")
    # lime bench
    draw.line([px(12, 17.25), px(20, 17.25)], fill=LIME, width=max(1, round(w)))
    return img


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")


def main() -> None:
    sizes = {
        APP / "icon.png": 32,
        APP / "apple-icon.png": 180,
        BRAND / "mark-32.png": 32,
        BRAND / "mark-192.png": 192,
        BRAND / "mark-512.png": 512,
        PUBLIC / "favicon-32.png": 32,
        PUBLIC / "favicon-16.png": 16,
    }
    for path, size in sizes.items():
        save_png(draw_mark(size), path)

    ico_images = [draw_mark(s).convert("RGBA") for s in (16, 32, 48)]
    ico_images[0].save(
        APP / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=ico_images[1:],
    )
    ico_images[0].save(
        PUBLIC / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=ico_images[1:],
    )

    # Open Graph / GitHub social card
    og = Image.new("RGB", (1200, 630), (14, 14, 14))
    draw = ImageDraw.Draw(og)
    draw.rectangle((0, 0, 8, 630), fill=PURPLE[:3])
    draw.rectangle((1192, 0, 1200, 630), fill=LIME[:3])
    mark = draw_mark(280)
    og.paste(mark, (72, 175), mark)

    font_paths = [
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/segoeuib.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    title_font = None
    sub_font = None
    for p in font_paths:
        if Path(p).exists():
            title_font = ImageFont.truetype(p, 72)
            sub_font = ImageFont.truetype(p, 28)
            break
    if title_font is None:
        title_font = ImageFont.load_default()
        sub_font = title_font

    draw.text((400, 210), "ALPHA COURT", font=title_font, fill=INK[:3])
    draw.text((400, 300), "On-chain prediction court on GenLayer", font=sub_font, fill=MUTED[:3])
    draw.line((400, 360, 760, 360), fill=LIME[:3], width=3)
    draw.text((400, 380), "HELD  /  BROKEN  /  CONTESTED", font=sub_font, fill=LAVENDER[:3])

    og.save(APP / "opengraph-image.png", "PNG")
    og.save(BRAND / "og.png", "PNG")
    print("wrote brand rasters")


if __name__ == "__main__":
    main()
