from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "store-assets" / "chrome-web-store"
ICON = ROOT / "public" / "icons" / "icon-512.png"
FONT_DIR = Path("C:/Windows/Fonts")


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / name), size)


def gradient(size: tuple[int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGB", size)
    pixels = image.load()
    start = (18, 54, 61)
    end = (8, 137, 139)
    for y in range(height):
        for x in range(width):
            mix = (x / max(width - 1, 1)) * .72 + (y / max(height - 1, 1)) * .28
            pixels[x, y] = tuple(round(start[i] * (1 - mix) + end[i] * mix) for i in range(3))

    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    draw.ellipse((width * .62, -height * .55, width * 1.22, height * .65), fill=(56, 214, 196, 78))
    draw.ellipse((-width * .18, height * .62, width * .34, height * 1.36), fill=(249, 115, 22, 48))
    glow = glow.filter(ImageFilter.GaussianBlur(max(20, width // 18)))
    return Image.alpha_composite(image.convert("RGBA"), glow)


def paste_logo(canvas: Image.Image, box: tuple[int, int, int, int]) -> None:
    x0, y0, x1, y1 = box
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(box, radius=(x1 - x0) // 4, fill=(255, 255, 255, 242))
    icon = Image.open(ICON).convert("RGBA")
    inset = max(7, (x1 - x0) // 8)
    icon.thumbnail((x1 - x0 - 2 * inset, y1 - y0 - 2 * inset), Image.Resampling.LANCZOS)
    canvas.alpha_composite(icon, (x0 + (x1 - x0 - icon.width) // 2, y0 + (y1 - y0 - icon.height) // 2))


def timer_card(canvas: Image.Image, box: tuple[int, int, int, int], scale: float = 1) -> None:
    x0, y0, x1, y1 = box
    draw = ImageDraw.Draw(canvas)
    radius = round(18 * scale)
    draw.rounded_rectangle((x0 + 5, y0 + 10, x1 + 5, y1 + 10), radius=radius, fill=(4, 37, 43, 46))
    draw.rounded_rectangle(box, radius=radius, fill=(247, 253, 252, 239), outline=(255, 255, 255, 185), width=max(1, round(scale)))

    pad = round(20 * scale)
    dot = round(5 * scale)
    draw.ellipse((x0 + pad, y0 + pad, x0 + pad + dot * 2, y0 + pad + dot * 2), fill=(16, 185, 129, 255))
    draw.text((x0 + pad + dot * 3, y0 + round(16 * scale)), "RECORDING", font=font("segoeuib.ttf", round(10 * scale)), fill=(55, 104, 107, 255))
    draw.text((x0 + pad, y0 + round(43 * scale)), "01:02:03", font=font("segoeuib.ttf", round(31 * scale)), fill=(12, 120, 112, 255))

    detail_y = y0 + round(91 * scale)
    draw.rounded_rectangle((x0 + pad, detail_y, x1 - pad, detail_y + round(52 * scale)), radius=round(10 * scale), fill=(232, 246, 243, 255))
    draw.text((x0 + pad + round(12 * scale), detail_y + round(8 * scale)), "Aster Advisory", font=font("segoeuib.ttf", round(11 * scale)), fill=(28, 70, 74, 255))
    draw.text((x0 + pad + round(12 * scale), detail_y + round(27 * scale)), "Statutory Audit", font=font("segoeui.ttf", round(10 * scale)), fill=(84, 115, 118, 255))

    button_y = y1 - round(42 * scale)
    gap = round(8 * scale)
    button_width = (x1 - x0 - pad * 2 - gap) // 2
    draw.rounded_rectangle((x0 + pad, button_y, x0 + pad + button_width, y1 - pad), radius=round(8 * scale), fill=(255, 255, 255, 255), outline=(205, 224, 220, 255))
    draw.rounded_rectangle((x0 + pad + button_width + gap, button_y, x1 - pad, y1 - pad), radius=round(8 * scale), fill=(255, 239, 237, 255), outline=(249, 210, 204, 255))
    draw.text((x0 + pad + round(23 * scale), button_y + round(8 * scale)), "Pause", font=font("segoeuib.ttf", round(10 * scale)), fill=(55, 91, 94, 255))
    draw.text((x0 + pad + button_width + gap + round(28 * scale), button_y + round(8 * scale)), "End", font=font("segoeuib.ttf", round(10 * scale)), fill=(160, 68, 57, 255))


def small_tile() -> Image.Image:
    canvas = gradient((440, 280))
    draw = ImageDraw.Draw(canvas)
    paste_logo(canvas, (28, 28, 82, 82))
    draw.text((28, 102), "Samay", font=font("segoeuib.ttf", 28), fill="white")
    draw.text((28, 137), "Focus Timer", font=font("segoeui.ttf", 18), fill=(199, 242, 237, 255))
    draw.text((28, 204), "Time, without the tab.", font=font("segoeuib.ttf", 15), fill=(255, 255, 255, 235))
    timer_card(canvas, (215, 38, 418, 244), .8)
    return canvas


def marquee() -> Image.Image:
    canvas = gradient((1400, 560))
    draw = ImageDraw.Draw(canvas)
    paste_logo(canvas, (92, 82, 184, 174))
    draw.text((92, 207), "Samay Focus Timer", font=font("segoeuib.ttf", 48), fill="white")
    draw.text((92, 280), "Time, without the tab.", font=font("segoeuib.ttf", 30), fill=(204, 246, 240, 255))
    draw.text((92, 331), "Record focused work from a subtle floating timer.", font=font("segoeui.ttf", 22), fill=(222, 246, 243, 230))
    draw.rounded_rectangle((92, 402, 388, 454), radius=16, fill=(255, 255, 255, 232), outline=(255, 255, 255, 255), width=2)
    draw.ellipse((114, 420, 128, 434), fill=(52, 211, 153, 255))
    draw.text((143, 414), "Draft saved to Samay", font=font("segoeuib.ttf", 17), fill=(24, 76, 80, 255))
    timer_card(canvas, (850, 78, 1282, 488), 1.6)
    return canvas


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    small_tile().convert("RGB").save(OUTPUT / "promo-small-440x280.png", optimize=True)
    marquee().convert("RGB").save(OUTPUT / "promo-marquee-1400x560.png", optimize=True)
    print("Chrome Web Store promotional assets generated.")


if __name__ == "__main__":
    main()
