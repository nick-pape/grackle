"""Generate all Grackle icon/favicon assets from the 1024x1024 source image.

Usage:
    python tools/generate-icons.py

Dependencies:
    Pillow (PIL) — install with: pip install pillow

Reads:  tools/grackle-source-1024.png
Writes: packages/web/public/  and  apps/docs-site/static/img/
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "tools" / "grackle-source-1024.png"

WEB_PUBLIC = ROOT / "packages" / "web" / "public"
DOCS_IMG = ROOT / "apps" / "docs-site" / "static" / "img"

BACKGROUND_COLOR = (14, 18, 24)  # #0e1218


def resample(img: Image.Image, size: int) -> Image.Image:
    """Resample image to a square of the given size using LANCZOS."""
    return img.resize((size, size), Image.LANCZOS)


def make_apple_touch_icon(img: Image.Image) -> Image.Image:
    """Create a 180x180 apple-touch-icon with the logo centered on a dark background with padding."""
    canvas = Image.new("RGBA", (180, 180), (*BACKGROUND_COLOR, 255))
    # Logo at ~140px centered in 180px canvas (20px padding on each side)
    logo = resample(img, 140)
    canvas.paste(logo, (20, 20), logo)
    return canvas


def save_ico(img: Image.Image, path: Path) -> None:
    """Save a multi-resolution ICO file (16, 32, 48) from the source image."""
    # Pillow ICO works best when you pass the largest size as the base image
    # and specify the desired sizes — it downsamples internally.
    base = resample(img, 48)
    base.save(path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])


def main() -> None:
    """Generate all icon assets."""
    if not SOURCE.is_file():
        raise FileNotFoundError(f"Source image not found: {SOURCE}")
    img = Image.open(SOURCE).convert("RGBA")
    if img.size != (1024, 1024):
        raise ValueError(f"Expected 1024x1024 source image at {SOURCE}, got {img.size}")

    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    DOCS_IMG.mkdir(parents=True, exist_ok=True)

    # -- packages/web/public/ --
    img.save(WEB_PUBLIC / "grackle-logo.png")
    resample(img, 16).save(WEB_PUBLIC / "favicon-16x16.png")
    resample(img, 32).save(WEB_PUBLIC / "favicon-32x32.png")
    make_apple_touch_icon(img).save(WEB_PUBLIC / "apple-touch-icon.png")
    resample(img, 192).save(WEB_PUBLIC / "icon-192x192.png")
    resample(img, 512).save(WEB_PUBLIC / "icon-512x512.png")
    save_ico(img, WEB_PUBLIC / "favicon.ico")

    # -- apps/docs-site/static/img/ --
    resample(img, 512).save(DOCS_IMG / "grackle-logo.png")
    save_ico(img, DOCS_IMG / "favicon.ico")

    print("Generated icon assets:")
    for d in (WEB_PUBLIC, DOCS_IMG):
        for f in sorted(d.glob("*")):
            if f.suffix in (".png", ".ico"):
                print(f"  {f.relative_to(ROOT)}  ({f.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
