"""Compose a browser-tab strip using the real 32px favicon."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
mark = Image.open(ROOT / "public" / "brand" / "mark-32.png").convert("RGBA")
W, H = 720, 56
img = Image.new("RGB", (W, H), (32, 32, 32))
draw = ImageDraw.Draw(img)
# inactive tab
draw.rounded_rectangle((12, 10, 200, 52), radius=8, fill=(50, 50, 50))
# active tab
draw.rounded_rectangle((208, 8, 430, 56), radius=10, fill=(20, 20, 20))
draw.rectangle((208, 40, 430, 56), fill=(20, 20, 20))
# favicon
icon = mark.resize((18, 18), Image.Resampling.LANCZOS)
img.paste(icon, (222, 18), icon)
font_path = Path("C:/Windows/Fonts/segoeui.ttf")
font = ImageFont.truetype(str(font_path), 14) if font_path.exists() else ImageFont.load_default()
draw.text((248, 18), "ALPHA COURT", font=font, fill=(229, 226, 225))
draw.text((28, 20), "Markets", font=font, fill=(160, 160, 160))
out = ROOT / "_verify" / "brand" / "browser-tab.png"
out.parent.mkdir(parents=True, exist_ok=True)
img.save(out, "PNG")
print("wrote", out)
