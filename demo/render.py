"""Render the README media.

Inputs (all in this directory):
  prompt.txt      the user prompt                      (record.sh)
  uwu.txt         omp's reply with the extension loaded  (record.sh)
  plain.txt       omp's reply without it                 (record.sh)
  dashboard.json  ANSI frames of the real `/uwu status` card (capture.ts)

Outputs:
  demo.gif          the uwu reply streaming into a terminal window
  before-after.png  both replies side by side
  dashboard.gif     the `/uwu status` dashboard being edited with the keyboard

Usage:
  bun demo/capture.ts
  uv run --with pillow python demo/render.py [--font path/to/mono.ttf]
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent

# Catppuccin Mocha-ish palette.
BG = "#1e1e2e"
TITLE_BG = "#181825"
CODE_BG = "#11111b"
FG = "#cdd6f4"
DIM = "#7f849c"
CODE = "#f9e2af"
KEYWORD = "#cba6f7"
NUMBER = "#fab387"
UWU = "#f5c2e7"
PROMPT = "#89b4fa"
DOTS = ("#f38ba8", "#f9e2af", "#a6e3a1")

EMOTICONS = {"uwu", "owo", ">w<", "^w^", ":3", "UwU", "OwO"}
JS_KEYWORDS = {"let", "const", "var", "for", "while", "if", "return", "function"}

FONT_SIZE = 17
LINE_H = 26
PAD = 22
TITLE_H = 36


@dataclass
class Tok:
    text: str
    color: str
    code_block: bool = False


def default_font() -> str:
    for candidate in (
        "C:/Windows/Fonts/CascadiaMono.ttf",
        "C:/Windows/Fonts/consola.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/System/Library/Fonts/Menlo.ttc",
    ):
        if Path(candidate).exists():
            return candidate
    raise SystemExit("no monospace font found; pass --font")


def prose_tokens(line: str, base: str = FG) -> list[Tok]:
    """Split a prose line into word/space tokens; `inline code` is coloured, backticks dropped."""
    toks: list[Tok] = []
    for i, part in enumerate(line.split("`")):
        in_code = i % 2 == 1
        for piece in re.findall(r"\S+|\s+", part):
            if in_code:
                color = CODE
            elif piece.strip(".,") in EMOTICONS:
                color = UWU
            else:
                color = base
            toks.append(Tok(piece, color))
    return toks


def js_tokens(line: str) -> list[Tok]:
    toks: list[Tok] = []
    for piece in re.findall(r"[A-Za-z_]\w*|\d+|\s+|.", line):
        if piece in JS_KEYWORDS:
            color = KEYWORD
        elif piece.isdigit():
            color = NUMBER
        else:
            color = FG
        toks.append(Tok(piece, color, code_block=True))
    return toks


def words(toks: list[Tok]) -> list[list[Tok]]:
    """Group tokens into wrap units: whitespace alone, or adjacent non-space tokens glued
    together so `NaN` + `,` never wraps between the code and its punctuation."""
    groups: list[list[Tok]] = []
    for tok in toks:
        if tok.text.strip() and groups and groups[-1][-1].text.strip():
            groups[-1].append(tok)
        else:
            groups.append([tok])
    return groups


def wrap(toks: list[Tok], cols: int) -> list[list[Tok]]:
    """Greedy word wrap; code-block lines are never wrapped."""
    if toks and toks[0].code_block:
        return [toks]
    lines: list[list[Tok]] = [[]]
    width = 0
    for group in words(toks):
        size = sum(len(t.text) for t in group)
        blank = not group[0].text.strip()
        if width + size > cols and not blank:
            lines.append([])
            width = 0
        if not lines[-1] and blank:
            continue  # no leading spaces on wrapped lines
        lines[-1].extend(group)
        width += size
    return lines


def markdown_lines(text: str, cols: int) -> list[list[Tok]]:
    out: list[list[Tok]] = []
    fenced = False
    for raw in text.strip("\n").splitlines():
        if raw.startswith("```"):
            fenced = not fenced
            continue
        if fenced:
            out.append(js_tokens(raw) or [Tok("", FG, code_block=True)])
        elif not raw.strip():
            out.append([])
        else:
            out.extend(wrap(prose_tokens(raw), cols))
    return out


def prompt_lines(text: str, cols: int) -> list[list[Tok]]:
    toks = [Tok("> ", PROMPT)] + prose_tokens(" ".join(text.split()), DIM)
    return wrap(toks, cols)


class Canvas:
    def __init__(self, font_path: str):
        self.font = ImageFont.truetype(font_path, FONT_SIZE)
        self.char_w = self.font.getlength("M")

    def width_for(self, cols: int) -> int:
        return int(cols * self.char_w + 2 * PAD)

    def window(self, width: int, height: int, title: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
        img = Image.new("RGB", (width, height), BG)
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, width, TITLE_H], fill=TITLE_BG)
        for i, color in enumerate(DOTS):
            cx = 20 + i * 20
            d.ellipse([cx - 6, TITLE_H / 2 - 6, cx + 6, TITLE_H / 2 + 6], fill=color)
        tw = self.font.getlength(title)
        d.text(((width - tw) / 2, TITLE_H / 2), title, font=self.font, fill=DIM, anchor="lm")
        return img, d

    def draw_lines(self, d: ImageDraw.ImageDraw, lines: list[list[Tok]], x0: int, y0: int, width: int,
                   budget: int | None = None) -> int:
        """Draw lines, revealing at most `budget` characters. Returns the y after the last line."""
        y = y0
        left = budget
        for line in lines:
            if left is not None and left <= 0:
                break
            if line and line[0].code_block:
                d.rectangle([x0 - 8, y - 2, x0 + width - 2 * PAD + 8, y + LINE_H - 2], fill=CODE_BG)
            x = x0
            for tok in line:
                text = tok.text
                if left is not None:
                    text = text[: max(left, 0)]
                    left -= len(tok.text)
                if text:
                    d.text((x, y + LINE_H / 2), text, font=self.font, fill=tok.color, anchor="lm")
                x += self.font.getlength(tok.text)
            if left is not None:
                left -= 1  # a newline costs one "character" of streaming time
            y += LINE_H
        return y


def char_count(lines: list[list[Tok]]) -> int:
    return sum(sum(len(t.text) for t in line) + 1 for line in lines)


def render_gif(c: Canvas, prompt: str, reply: str, out: Path) -> None:
    cols = 74
    width = c.width_for(cols)
    p_lines = prompt_lines(prompt, cols)
    r_lines = markdown_lines(reply, cols)
    height = TITLE_H + 2 * PAD + LINE_H * (len(p_lines) + 1 + len(r_lines))

    prompt_total = char_count(p_lines)
    reply_total = char_count(r_lines)
    rgb: list[Image.Image] = []
    durations: list[int] = []

    def frame(prompt_budget: int, reply_budget: int, ms: int) -> None:
        img, d = c.window(width, height, "omp  ·  omp-uwu on")
        y = c.draw_lines(d, p_lines, PAD, TITLE_H + PAD, width, budget=prompt_budget) + LINE_H
        if reply_budget:
            c.draw_lines(d, r_lines, PAD, y, width, budget=reply_budget)
        rgb.append(img)
        durations.append(ms)

    frame(0, 0, 600)
    for n in range(10, prompt_total + 10, 10):
        frame(n, 0, 30)
    frame(prompt_total, 0, 900)
    for n in range(6, reply_total + 6, 6):
        frame(prompt_total, n, 40)
    frame(prompt_total, reply_total, 4500)

    # One palette for every frame keeps colours stable. Seed it with large swatches of
    # the theme colours so rare ones (keywords, emoticons) survive quantization.
    theme = (BG, TITLE_BG, CODE_BG, FG, DIM, CODE, KEYWORD, NUMBER, UWU, PROMPT, *DOTS)
    seed = Image.new("RGB", (width, height + 40 * len(theme)), BG)
    seed.paste(rgb[-1], (0, 0))
    for i, color in enumerate(theme):
        seed.paste(color, (0, height + 40 * i, width, height + 40 * (i + 1)))
    palette = seed.quantize(colors=128, method=Image.Quantize.MEDIANCUT)
    frames = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in rgb]
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)


def render_before_after(c: Canvas, prompt: str, plain: str, uwu: str, out: Path) -> None:
    cols = 52
    panel_w = c.width_for(cols)
    gap = 16
    p_lines = prompt_lines(prompt, 2 * cols + 4)
    plain_lines = markdown_lines(plain, cols)
    uwu_lines = markdown_lines(uwu, cols)
    body = max(len(plain_lines), len(uwu_lines))
    width = 2 * panel_w + gap
    height = TITLE_H + 2 * PAD + LINE_H * (len(p_lines) + 3 + body)

    img, d = c.window(width, height, "same prompt, same model")
    y = c.draw_lines(d, p_lines, PAD, TITLE_H + PAD, width) + LINE_H
    for i, (label, color, lines) in enumerate((("uwu off", DIM, plain_lines), ("uwu on", UWU, uwu_lines))):
        x = i * (panel_w + gap)
        if i:
            d.line([x - gap / 2, y - 6, x - gap / 2, height - PAD], fill=TITLE_BG, width=2)
        c.draw_lines(d, [[Tok(label, color)]], x + PAD, y, panel_w)
        c.draw_lines(d, lines, x + PAD, y + LINE_H * 2, panel_w)
    img.save(out, optimize=True)


def xterm_rgb(n: int) -> str:
    """Colour of xterm-256 index `n`."""
    base = ("#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
            "#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff")
    if n < 16:
        return base[n]
    if n < 232:
        steps = (0, 95, 135, 175, 215, 255)
        n -= 16
        return "#%02x%02x%02x" % (steps[n // 36], steps[n // 6 % 6], steps[n % 6])
    v = 8 + (n - 232) * 10
    return "#%02x%02x%02x" % (v, v, v)


@dataclass
class Cell:
    char: str
    fg: str
    bg: str | None
    bold: bool
    wide: bool


def ansi_cells(line: str) -> list[Cell]:
    """Parse one SGR-coloured line (256-colour or truecolour) into terminal cells."""
    cells: list[Cell] = []
    fg, bg, bold = FG, None, False
    for part in re.split(r"(\x1b\[[0-9;]*m)", line):
        if part.startswith("\x1b["):
            codes = [int(c) if c else 0 for c in part[2:-1].split(";")]
            i = 0
            while i < len(codes):
                code = codes[i]
                if code in (38, 48):
                    if codes[i + 1] == 5:
                        color, i = xterm_rgb(codes[i + 2]), i + 3
                    else:
                        color, i = "#%02x%02x%02x" % tuple(codes[i + 2:i + 5]), i + 5
                    if code == 38:
                        fg = color
                    else:
                        bg = color
                    continue
                if code == 0:
                    fg, bg, bold = FG, None, False
                elif code == 1:
                    bold = True
                elif code == 22:
                    bold = False
                elif code == 39:
                    fg = FG
                elif code == 49:
                    bg = None
                i += 1
            continue
        for ch in part:
            cells.append(Cell(ch, fg, bg, bold, unicodedata.east_asian_width(ch) in "WF"))
    return cells


def render_dashboard(c: Canvas, capture: dict, out: Path) -> None:
    cols = capture["width"] + 2
    rows = max(len(f["lines"]) for f in capture["frames"])
    width = c.width_for(cols)
    height = TITLE_H + 2 * PAD + LINE_H * (rows + 2)
    bold = ImageFont.truetype(c.font.path, FONT_SIZE)
    if hasattr(bold, "set_variation_by_name"):
        try:
            bold.set_variation_by_name("Bold")
        except (OSError, ValueError):
            bold = c.font
    emoji_path = Path("C:/Windows/Fonts/seguiemj.ttf")
    emoji = ImageFont.truetype(str(emoji_path), FONT_SIZE - 2) if emoji_path.exists() else c.font
    key_names = {"down": "↓", "up": "↑", "left": "←", "right": "→", "tab": "Tab"}

    rgb: list[Image.Image] = []
    durations: list[int] = []
    for f in capture["frames"]:
        img, d = c.window(width, height, "omp  ·  /uwu status")
        y = TITLE_H + PAD
        for line in f["lines"]:
            col = 1
            for cell in ansi_cells(line):
                x = PAD + col * c.char_w
                span = 2 if cell.wide else 1
                if cell.bg:
                    d.rectangle([x, y, x + span * c.char_w, y + LINE_H - 1], fill=cell.bg)
                if cell.char != " ":
                    if cell.wide:
                        d.text((x, y + LINE_H / 2), cell.char, font=emoji, anchor="lm", embedded_color=True)
                    else:
                        d.text((x, y + LINE_H / 2), cell.char, font=bold if cell.bold else c.font, fill=cell.fg, anchor="lm")
                col += span
            y += LINE_H
        if f["key"]:
            label = f"key  {key_names.get(f['key'], f['key'])}"
            d.text((PAD + c.char_w, height - PAD - LINE_H / 2), label, font=bold, fill=UWU, anchor="lm")
        rgb.append(img)
        durations.append(f["ms"])

    # Build one palette from every frame so chip highlights and the emoji keep stable colours.
    mosaic = Image.new("RGB", (width, height * len(rgb)))
    for i, frame in enumerate(rgb):
        mosaic.paste(frame, (0, height * i))
    palette = mosaic.quantize(colors=128, method=Image.Quantize.MEDIANCUT)
    frames = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in rgb]
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", default=None)
    args = ap.parse_args()
    c = Canvas(args.font or default_font())

    prompt = (HERE / "prompt.txt").read_text(encoding="utf-8")
    uwu = (HERE / "uwu.txt").read_text(encoding="utf-8")
    plain = (HERE / "plain.txt").read_text(encoding="utf-8")
    dashboard = json.loads((HERE / "dashboard.json").read_text(encoding="utf-8"))

    render_gif(c, prompt, uwu, HERE / "demo.gif")
    render_before_after(c, prompt, plain, uwu, HERE / "before-after.png")
    render_dashboard(c, dashboard, HERE / "dashboard.gif")
    for name in ("demo.gif", "before-after.png", "dashboard.gif"):
        print(f"{name}: {(HERE / name).stat().st_size / 1024:.0f} KiB")


if __name__ == "__main__":
    main()
