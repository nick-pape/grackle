"""Generate the GitHub social preview image (1280x640) from the 1024x1024 source.

Usage:
    python tools/generate-social-preview.py

Dependencies:
    Pillow (PIL) — install with: pip install pillow

Font:
    Exo 2 variable font — downloaded automatically from Google Fonts GitHub repo
    on first run and cached in tools/.fonts/

Reads:  tools/grackle-source-1024.png
Writes: tools/social-preview.png
"""

from pathlib import Path
from urllib.request import urlretrieve

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "tools" / "grackle-source-1024.png"
OUTPUT = ROOT / "tools" / "social-preview.png"

FONT_DIR = ROOT / "tools" / ".fonts"
FONT_PATH = FONT_DIR / "Exo2-Variable.ttf"
FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/exo2/Exo2%5Bwght%5D.ttf"

WIDTH, HEIGHT = 1280, 640
BG_COLOR = (18, 18, 32)
TEXT_COLOR = (220, 225, 240)
LOGO_HEIGHT = 360
FONT_SIZE = 72


def ensure_font() -> Path:
    """Download Exo 2 variable font if not already cached."""
    if FONT_PATH.is_file():
        return FONT_PATH
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Downloading Exo 2 font to {FONT_PATH}...")
    urlretrieve(FONT_URL, FONT_PATH)
    return FONT_PATH


def main() -> None:
    """Generate the social preview image."""
    if not SOURCE.is_file():
        raise FileNotFoundError(f"Source image not found: {SOURCE}")

    font_path = ensure_font()

    # Canvas
    img = Image.new("RGBA", (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Load and scale logo
    logo = Image.open(SOURCE).convert("RGBA")
    logo_ratio = LOGO_HEIGHT / logo.height
    logo_width = int(logo.width * logo_ratio)
    logo = logo.resize((logo_width, LOGO_HEIGHT), Image.LANCZOS)

    # Center logo horizontally, offset up to make room for text
    logo_x = (WIDTH - logo_width) // 2
    logo_y = 60
    img.paste(logo, (logo_x, logo_y), logo)

    # "G R A C K L E" text below logo
    font = ImageFont.truetype(str(font_path), FONT_SIZE)
    try:
        font.set_variation_by_axes([700])  # Bold weight
    except Exception:
        pass

    text = "G R A C K L E"
    text_bbox = draw.textbbox((0, 0), text, font=font)
    text_width = text_bbox[2] - text_bbox[0]
    text_x = (WIDTH - text_width) // 2
    text_y = logo_y + LOGO_HEIGHT + 30
    draw.text((text_x, text_y), text, fill=TEXT_COLOR, font=font)

    # Save as optimized RGB PNG
    img_rgb = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    img_rgb.paste(img, mask=img.split()[3])
    img_rgb.save(OUTPUT, "PNG", optimize=True)

    file_size = OUTPUT.stat().st_size
    print(f"Generated: {OUTPUT.relative_to(ROOT)}")
    print(f"Size: {file_size:,} bytes ({file_size / 1024:.0f} KB)")
    print(f"Under 1MB: {file_size < 1_000_000}")


if __name__ == "__main__":
    main()
