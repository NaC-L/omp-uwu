"""Scoped renderer checks; writes generated media only to a temporary directory.

Run: uv run --with pillow python -m unittest discover -s demo -p test_render.py
"""

from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

import render


class RecordingCanvas(render.Canvas):
    def __init__(self, font_path: str):
        super().__init__(font_path)
        self.drawn_lines = []

    def draw_lines(self, d, lines, x0, y0, width):
        self.drawn_lines.append((copy.deepcopy(lines), x0, y0, width))
        return super().draw_lines(d, lines, x0, y0, width)


class RenderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.font_path = render.default_font()
        cls.inputs = {name: (render.HERE / name).read_bytes() for name in (
            "prompt.txt", "plain.txt", "uwu.txt", "chat.json", "dashboard.json",
        )}

    def test_saved_gifs_keep_every_frame_and_timing_without_mutating_inputs(self):
        c = render.Canvas(self.font_path)
        with tempfile.TemporaryDirectory() as temp:
            for source, output, title in (
                ("chat.json", "demo.gif", 'Your coding agent, but it says "hewwo"'),
                ("dashboard.json", "dashboard.gif", "Your little control panel"),
            ):
                with self.subTest(source=source):
                    capture = json.loads(self.inputs[source])
                    original = copy.deepcopy(capture)
                    path = Path(temp) / output
                    expected_lines = [line for f in capture["frames"] for line in f["lines"]]
                    with patch.object(render, "ansi_cells", wraps=render.ansi_cells) as parsed:
                        render.render_ansi(c, capture, title, path)
                    self.assertEqual([call.args[0] for call in parsed.call_args_list], expected_lines)
                    self.assertEqual(capture, original)
                    cols = max(capture["width"], *(sum(2 if cell.wide else 1 for cell in render.ansi_cells(line))
                                                 for line in expected_lines)) + 2
                    rows = max(len(f["lines"]) for f in capture["frames"])
                    has_keys = any(f.get("key") for f in capture["frames"])
                    expected_size = (c.width_for(cols) + 2 * render.MARGIN,
                                     render.HEADER_H + 60 + 2 * render.PAD + render.LINE_H * rows
                                     + (132 if has_keys else 68))
                    durations = []
                    with Image.open(path) as image:
                        self.assertEqual(image.size, expected_size)
                        self.assertEqual(image.n_frames, len(capture["frames"]))
                        self.assertEqual(image.info["loop"], 0)
                        for i in range(image.n_frames):
                            image.seek(i)
                            self.assertEqual(image.size, expected_size)
                            durations.append(image.info["duration"])
                            self.assertGreater(durations[-1], 0)
                    self.assertEqual(durations, render.gif_durations(capture["frames"]))
                    source_elapsed = gif_elapsed = 0
                    for frame, duration in zip(capture["frames"], durations):
                        source_elapsed += frame["ms"]
                        gif_elapsed += duration
                        self.assertLessEqual(abs(source_elapsed - gif_elapsed), 5)
                    self.assertLessEqual(abs(sum(durations) - sum(f["ms"] for f in capture["frames"])), 5)
        for name, before in self.inputs.items():
            self.assertEqual(hashlib.sha256((render.HERE / name).read_bytes()).digest(),
                             hashlib.sha256(before).digest(), name)

    def test_comparison_shares_prompt_and_keeps_identical_code_aligned(self):
        c = RecordingCanvas(self.font_path)
        prompt, plain, uwu = (self.inputs[name].decode("utf-8") for name in (
            "prompt.txt", "plain.txt", "uwu.txt",
        ))
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / "before-after.png"
            render.render_before_after(c, prompt, plain, uwu, out)
            self.assertEqual(len(c.drawn_lines), 3, "one shared prompt and two complete replies")
            self.assertEqual(c.drawn_lines[0][0], render.prompt_lines(
                prompt, int((2 * c.drawn_lines[1][3] + 24 - 2 * render.PAD) / c.char_w)))
            codes = []
            with Image.open(out) as image:
                self.assertEqual(image.format, "PNG")
                self.assertEqual(image.size[0], 2 * render.MARGIN + 2 * c.drawn_lines[1][3] + 24)
                self.assertEqual(image.getpixel((0, 0)), (11, 7, 16))
                for lines, x, y, panel_w in c.drawn_lines[1:]:
                    code_rows = [(i, line) for i, line in enumerate(lines) if line and line[0].code_block]
                    self.assertTrue(code_rows)
                    text = ["".join(t.text for t in line) for _, line in code_rows]
                    top = y + code_rows[0][0] * render.LINE_H - 2
                    bottom = y + (code_rows[-1][0] + 1) * render.LINE_H - 2
                    codes.append((text, top, image.crop((x - 8, top, x + panel_w - 2 * render.PAD + 8, bottom)).tobytes()))
                    self.assertLessEqual(y + len(lines) * render.LINE_H, image.height - 64)
                    for line in lines:
                        self.assertLessEqual(sum(c.font.getlength(t.text) for t in line), panel_w - 2 * render.PAD)
            self.assertEqual(codes[0], codes[1], "same source code, baseline, and rendered pixels")
            self.assertEqual(codes[0][0], [
                "let sum = 0;",
                "for (let i = 0; i < arr.length; i++) sum += arr[i];",
            ])
            for original, rendered in ((plain, c.drawn_lines[1][0]), (uwu, c.drawn_lines[2][0])):
                expected = render.markdown_lines(original, 52)
                self.assertEqual([line for line in rendered if line], [line for line in expected if line])

    def test_ansi_colours_and_wide_cells_are_preserved(self):
        cells = render.ansi_cells("\x1b[38;2;18;52;86m\x1b[48;5;17m\x1b[1mA界\x1b[0m!")
        self.assertEqual([cell.char for cell in cells], ["A", "界", "!"])
        self.assertEqual([(cell.fg, cell.bg, cell.bold, cell.wide) for cell in cells], [
            ("#123456", render.xterm_rgb(17), True, False),
            ("#123456", render.xterm_rgb(17), True, True),
            (render.TERM_FG, None, False, False),
        ])

    def test_identical_source_frames_are_not_merged_and_wide_content_is_not_cropped(self):
        c = render.Canvas(self.font_path)
        # Width metadata can be smaller than the actual cell span; preserve the latter.
        line = "\x1b[48;2;25;35;45m" + "W" * 82 + "界!\x1b[0m"
        capture = {"width": 76, "frames": [{"ms": 35, "lines": [line]}, {"ms": 45, "lines": [line]}]}
        observed = []
        draw_text = render.ImageDraw.ImageDraw.text

        def record_text(draw, xy, text, *args, **kwargs):
            if text == "!":
                observed.append(xy)
            return draw_text(draw, xy, text, *args, **kwargs)

        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "demo.gif"
            with patch.object(render.ImageDraw.ImageDraw, "text", record_text):
                render.render_ansi(c, capture, 'Your coding agent, but it says "hewwo"', path)
            with Image.open(path) as image:
                self.assertEqual(image.n_frames, 2)
                self.assertEqual(image.width, c.width_for(87) + 2 * render.MARGIN)
                self.assertEqual(len(observed), 2)
                for x, y in observed:
                    self.assertLess(x + c.char_w, image.width - render.MARGIN - render.PAD)
                    self.assertLess(y + render.LINE_H / 2, image.height - 68)


if __name__ == "__main__":
    unittest.main()
