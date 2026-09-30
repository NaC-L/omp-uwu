"""Render the README media.

Inputs (all in this directory):
  prompt.txt      the user prompt                      (record.sh)
  uwu.txt         omp's reply with the extension loaded  (record.sh)
  plain.txt       omp's reply without it                 (record.sh)
  chat.json       saved ANSI frames of the real chat TUI (capture.ts)
  dashboard.json  saved ANSI frames of the real `/uwu status` card (capture.ts)

Outputs:
  demo.gif          the saved chat frames in an editorial presentation
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

# Editorial chrome only; explicit colours in the saved ANSI cells stay untouched.
BG = "#0b0710"
PANEL_BG = "#110b18"
PINK_BG = "#1d1020"
BORDER = "#35263f"
PINK_BORDER = "#71435f"
CODE_BG = "#0b0710"
FG = "#f6eaff"
DIM = "#ac98bb"
CODE = "#6fffd2"
KEYWORD = "#b48cff"
NUMBER = "#ff8fc7"
UWU = "#ff8fc7"
PROMPT = "#6fffd2"
TERM_BG = PANEL_BG
TERM_FG = FG

EMOTICONS = {"uwu", "owo", ">w<", "^w^", ":3", "UwU", "OwO"}
JS_KEYWORDS = {"let", "const", "var", "for", "while", "if", "return", "function"}

FONT_SIZE = 17
LINE_H = 26
PAD = 24
MARGIN = 36
HEADER_H = 184


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
        self.small = ImageFont.truetype(font_path, 12)
        heading_path = next((str(p) for p in (
            Path("C:/Windows/Fonts/segoeuib.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
            Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        ) if p.exists()), font_path)
        self.heading = ImageFont.truetype(heading_path, 34)
        self.emoticon = ImageFont.truetype(heading_path, FONT_SIZE)
        symbol_path = Path("C:/Windows/Fonts/seguisym.ttf")
        symbol_font = ImageFont.truetype(str(symbol_path), FONT_SIZE) if symbol_path.exists() else self.emoticon
        self.emoticon_parts = [(char, symbol_font if char in "◕✿" else self.emoticon)
                               for char in "(◕ᴗ◕✿)"]
        self.char_w = self.font.getlength("M")

    def width_for(self, cols: int) -> int:
        return int(cols * self.char_w + 2 * PAD + 0.999)

    def editorial(self, width: int, height: int, eyebrow: str,
                  headlines: tuple[str, ...], note: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
        img = Image.new("RGB", (width, height), BG)
        d = ImageDraw.Draw(img)
        d.line((MARGIN, 24, width - MARGIN, 24), fill=BORDER)
        pixel_heart(d, MARGIN, 38, UWU)
        d.text((MARGIN + 28, 38), eyebrow, font=self.small, fill=KEYWORD, anchor="lt")
        for i, line in enumerate(headlines):
            d.text((MARGIN, 66 + i * 42), line, font=self.heading, fill=FG, anchor="lt")
        d.text((MARGIN, HEADER_H - 28), note, font=self.small, fill=DIM, anchor="lt")
        dither(d, width - MARGIN - 64, 38, 64, 16)
        return img, d

    def draw_lines(self, d: ImageDraw.ImageDraw, lines: list[list[Tok]], x0: int, y0: int, width: int) -> int:
        """Draw lines. Returns the y after the last line."""
        y = y0
        for line in lines:
            if line and line[0].code_block:
                d.rectangle([x0 - 8, y - 2, x0 + width - 2 * PAD + 8, y + LINE_H - 2], fill=CODE_BG)
            x = x0
            for tok in line:
                d.text((x, y + LINE_H / 2), tok.text, font=self.font, fill=tok.color, anchor="lm")
                x += self.font.getlength(tok.text)
            y += LINE_H
        return y


def pixel_heart(d: ImageDraw.ImageDraw, x: int, y: int, color: str) -> None:
    for row, bits in enumerate(("0110110", "1111111", "1111111", "0111110", "0011100", "0001000")):
        for col, bit in enumerate(bits):
            if bit == "1":
                d.rectangle((x + col * 2, y + row * 2, x + col * 2 + 1, y + row * 2 + 1), fill=color)


def dither(d: ImageDraw.ImageDraw, x: int, y: int, width: int, height: int) -> None:
    for row in range(0, height, 4):
        for col in range(0, width, 4):
            if (row // 4 + col // 4) % 2 == 0:
                d.point((x + col, y + row), fill=PINK_BORDER)


def panel(d: ImageDraw.ImageDraw, box: tuple[int, int, int, int], emphasized: bool = False) -> None:
    d.rectangle(box, fill=PINK_BG if emphasized else PANEL_BG,
                outline=PINK_BORDER if emphasized else BORDER, width=1)


def render_before_after(c: Canvas, prompt: str, plain: str, uwu: str, out: Path) -> None:
    # Both code blocks retain their exact tokens and begin on the same baseline.
    plain_lines = markdown_lines(plain, 52)
    uwu_lines = markdown_lines(uwu, 52)
    code_starts = [next((i for i, line in enumerate(lines) if line and line[0].code_block), len(lines))
                   for lines in (plain_lines, uwu_lines)]
    code_y = max(code_starts)
    for lines, start in zip((plain_lines, uwu_lines), code_starts):
        lines[start:start] = [[] for _ in range(code_y - start)]

    cols = max(52, *(sum(len(t.text) for t in line) for line in plain_lines + uwu_lines))
    panel_w = c.width_for(cols)
    gap = 24
    width = 2 * MARGIN + 2 * panel_w + gap
    p_lines = prompt_lines(prompt, int((width - 2 * MARGIN - 2 * PAD) / c.char_w))
    prompt_h = 60 + LINE_H * len(p_lines) + PAD
    reply_y = HEADER_H + prompt_h + gap
    panel_h = 88 + LINE_H * max(len(plain_lines), len(uwu_lines)) + PAD
    height = reply_y + panel_h + 64
    img, d = c.editorial(width, height, "OMP-UWU / SAVED REPLIES",
                         ("Same prompt. Different voice.",),
                         "Original transcript text; code is shown without rewriting.")

    panel(d, (MARGIN, HEADER_H, width - MARGIN, HEADER_H + prompt_h))
    d.text((MARGIN + PAD, HEADER_H + 20), "SHARED PROMPT", font=c.small, fill=PROMPT, anchor="lt")
    c.draw_lines(d, p_lines, MARGIN + PAD, HEADER_H + 52, width - 2 * MARGIN)

    for i, (state, label, color, lines) in enumerate((
        ("OFF", "Original reply", DIM, plain_lines),
        ("ON", "A little more uwu", UWU, uwu_lines),
    )):
        x = MARGIN + i * (panel_w + gap)
        panel(d, (x, reply_y, x + panel_w, reply_y + panel_h), emphasized=bool(i))
        d.rectangle((x + PAD, reply_y + 20, x + PAD + 48, reply_y + 44),
                    fill=PINK_BG if i else BG, outline=PINK_BORDER if i else BORDER)
        d.text((x + PAD + 24, reply_y + 32), state, font=c.small, fill=color, anchor="mm")
        d.text((x + PAD + 64, reply_y + 25), label, font=c.font, fill=FG, anchor="lt")
        d.line((x + PAD, reply_y + 62, x + panel_w - PAD, reply_y + 62), fill=BORDER)
        c.draw_lines(d, lines, x + PAD, reply_y + 88, panel_w)
    d.text((MARGIN, height - 32), "SOURCE / plain.txt + uwu.txt", font=c.small, fill=DIM, anchor="lm")
    pixel_heart(d, width - MARGIN - 14, height - 38, UWU)
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
    """Parse one SGR-coloured line (256-colour or truecolour) into terminal cells; OSC marks are dropped."""
    cells: list[Cell] = []
    fg, bg, bold = TERM_FG, None, False
    for part in re.split(r"(\x1b\[[0-9;]*m|\x1b\][^\x07]*\x07)", line):
        if part.startswith("\x1b]"):
            continue
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
                    fg, bg, bold = TERM_FG, None, False
                elif code == 1:
                    bold = True
                elif code == 22:
                    bold = False
                elif code == 39:
                    fg = TERM_FG
                elif code == 49:
                    bg = None
                i += 1
            continue
        for ch in part:
            cells.append(Cell(ch, fg, bg, bold, unicodedata.east_asian_width(ch) in "WF"))
    return cells


def gif_durations(frames: list[dict]) -> list[int]:
    """Round cumulative time to GIF's 10ms ticks, avoiding per-frame drift."""
    elapsed = previous = 0
    durations = []
    for frame in frames:
        elapsed += frame["ms"]
        boundary = int((elapsed + 5) // 10) * 10
        durations.append(boundary - previous)
        previous = boundary
    return durations


def render_ansi(c: Canvas, capture: dict, title: str, out: Path) -> None:
    """Package every saved ANSI frame; no TUI recapture or content overlays."""
    decoded = [[ansi_cells(line) for line in f["lines"]] for f in capture["frames"]]
    widest = max((sum(2 if cell.wide else 1 for cell in line)
                  for lines in decoded for line in lines), default=0)
    cols = max(capture["width"], widest) + 2
    rows = max(len(lines) for lines in decoded)
    has_keys = any(f.get("key") for f in capture["frames"])
    panel_w = c.width_for(cols)
    width = panel_w + 2 * MARGIN
    panel_h = 60 + 2 * PAD + LINE_H * rows
    panel_bottom = HEADER_H + panel_h
    ribbon_y = panel_bottom + 20
    height = panel_bottom + (132 if has_keys else 68)
    bold = ImageFont.truetype(c.font.path, FONT_SIZE)
    if hasattr(bold, "set_variation_by_name"):
        try:
            bold.set_variation_by_name("Bold")
        except (OSError, ValueError):
            bold = c.font
    emoji_path = Path("C:/Windows/Fonts/seguiemj.ttf")
    emoji = ImageFont.truetype(str(emoji_path), FONT_SIZE - 2) if emoji_path.exists() else c.font
    actions = {"down": "Move focus down", "up": "Move focus up",
               "left": "Edit selection", "right": "Edit selection", "tab": "Switch tabs"}
    headlines = (title,) if has_keys else ("Your coding agent,", 'but it says "hewwo"')
    note = "Keyboard edits in the saved /uwu status capture." if has_keys else "Saved chat capture / kawaii colours + sparkles"

    rgb: list[Image.Image] = []
    for index, (f, lines) in enumerate(zip(capture["frames"], decoded)):
        img, d = c.editorial(width, height, "OMP-UWU / KEYBOARD" if has_keys else "OMP-UWU / CHAT",
                             headlines, note)
        if not has_keys:
            x = width - MARGIN - sum(font.getlength(char) for char, font in c.emoticon_parts)
            for char, font in c.emoticon_parts:
                d.text((x, HEADER_H - 28), char, font=font, fill=UWU, anchor="lt")
                x += font.getlength(char)
        panel(d, (MARGIN, HEADER_H, width - MARGIN, panel_bottom))
        d.text((MARGIN + PAD, HEADER_H + 20), "SAVED TUI / STATUS" if has_keys else "SAVED TUI / CHAT",
               font=c.small, fill=PROMPT, anchor="lt")
        # Real sequence labels also prevent GIF encoders merging identical TUI frames.
        d.text((width - MARGIN - PAD, HEADER_H + 20), f"FRAME {index + 1:03d}",
               font=c.small, fill=DIM, anchor="rt")
        d.line((MARGIN + PAD, HEADER_H + 44, width - MARGIN - PAD, HEADER_H + 44), fill=BORDER)
        y = HEADER_H + 60 + PAD
        for line in lines:
            col = 1
            for cell in line:
                x = MARGIN + PAD + col * c.char_w
                span = 2 if cell.wide else 1
                if cell.bg:
                    d.rectangle([x, y, x + span * c.char_w, y + LINE_H - 1], fill=cell.bg)
                if cell.char != " ":
                    if cell.wide:
                        d.text((x, y + LINE_H / 2), cell.char, font=emoji, fill=cell.fg,
                               anchor="lm", embedded_color=emoji_path.exists())
                    else:
                        d.text((x, y + LINE_H / 2), cell.char, font=bold if cell.bold else c.font,
                               fill=cell.fg, anchor="lm")
                col += span
            y += LINE_H
        if has_keys:
            panel(d, (MARGIN, ribbon_y, width - MARGIN, ribbon_y + 48), emphasized=True)
            d.text((MARGIN + PAD, ribbon_y + 24), "KEY ACTION", font=c.small, fill=DIM, anchor="lm")
            key = f.get("key")
            d.text((MARGIN + PAD + 108, ribbon_y + 24), key.upper() if key else "START",
                   font=c.font, fill=UWU, anchor="lm")
            d.text((MARGIN + PAD + 212, ribbon_y + 24), actions.get(key, "Opening view"),
                   font=c.small, fill=FG, anchor="lm")
            d.text((MARGIN, height - 30), "↑↓ FOCUS     ←→ EDIT     TAB SWITCH TABS",
                   font=c.small, fill=DIM, anchor="lm")
        else:
            d.text((MARGIN, height - 30), "SOURCE / chat.json", font=c.small, fill=DIM, anchor="lm")
            pixel_heart(d, width - MARGIN - 14, height - 36, UWU)
        rgb.append(img)

    # One palette across the entire sequence keeps captured colours stable.
    mosaic = Image.new("RGB", (width, height * len(rgb)))
    for i, frame in enumerate(rgb):
        mosaic.paste(frame, (0, height * i))
    palette = mosaic.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    frames = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in rgb]
    frames[0].save(out, save_all=True, append_images=frames[1:],
                   duration=gif_durations(capture["frames"]), loop=0, optimize=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", default=None)
    args = ap.parse_args()
    c = Canvas(args.font or default_font())

    prompt = (HERE / "prompt.txt").read_text(encoding="utf-8")
    uwu = (HERE / "uwu.txt").read_text(encoding="utf-8")
    plain = (HERE / "plain.txt").read_text(encoding="utf-8")
    chat = json.loads((HERE / "chat.json").read_text(encoding="utf-8"))
    dashboard = json.loads((HERE / "dashboard.json").read_text(encoding="utf-8"))

    render_ansi(c, chat, 'Your coding agent, but it says "hewwo"', HERE / "demo.gif")
    render_before_after(c, prompt, plain, uwu, HERE / "before-after.png")
    render_ansi(c, dashboard, "Your little control panel", HERE / "dashboard.gif")
    for name in ("demo.gif", "before-after.png", "dashboard.gif"):
        print(f"{name}: {(HERE / name).stat().st_size / 1024:.0f} KiB")


if __name__ == "__main__":
    main()
