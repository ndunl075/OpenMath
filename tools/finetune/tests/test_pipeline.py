"""Unit tests for the parts that do not need torch, a GPU or a dataset.

Run: python -m unittest discover -s tools/finetune/tests

These cover tokenisation, InkML parsing, rendering and label building. They do
not cover training, ONNX export or anything under prepare_hme100k.py, none of
which has ever been executed.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from openmath_finetune.inkml import parse_inkml, strip_math_delimiters  # noqa: E402
from openmath_finetune.label import build_label  # noqa: E402
from openmath_finetune.latex_tokens import join_tokens, tokenize, unknown_tokens  # noqa: E402
from openmath_finetune.scope import in_app_scope, unsupported_commands  # noqa: E402
from openmath_finetune.texo_tables import TexoTables, apply_token_tables  # noqa: E402

MATHWRITING_INKML = """<ink xmlns="http://www.w3.org/2003/InkML">
  <annotation type="label">x^2 + 1</annotation>
  <annotation type="normalizedLabel">x^{2}+1</annotation>
  <annotation type="splitTagOriginal">train</annotation>
  <annotation type="sampleId">deadbeefdeadbeef</annotation>
  <traceFormat>
    <channel name="X" type="decimal" />
    <channel name="Y" type="decimal" />
    <channel name="T" type="decimal" units="ms" />
  </traceFormat>
  <trace id="0">10.0 20.0 0.0,30.0 40.0 12.0,50.0 20.0 25.0</trace>
  <trace id="1">60.0 20.0 40.0,60.0 40.0 55.0</trace>
</ink>
"""

# CROHME-shaped: no time channel, truth wrapped in dollars.
CROHME_INKML = """<ink xmlns="http://www.w3.org/2003/InkML">
  <annotation type="UI">2013_A_1</annotation>
  <annotation type="truth">$\\frac{1}{2}$</annotation>
  <trace id="0">100 200, 110 210, 120 205</trace>
</ink>
"""


def write(tmp: Path, name: str, content: str) -> Path:
    path = tmp / name
    path.write_text(content, encoding="utf-8")
    return path


class Tokenizing(unittest.TestCase):
    def test_splits_control_words_and_characters(self) -> None:
        self.assertEqual(
            tokenize(r"\frac{1}{2}"),
            ["\\frac", "{", "1", "}", "{", "2", "}"],
        )

    def test_keeps_environment_names_attached(self) -> None:
        # \begin{array} is one entry in Texo's vocabulary, so it must not split.
        self.assertEqual(
            tokenize(r"\begin{array}{cc}a\end{array}")[:1], ["\\begin{array}"]
        )
        self.assertIn("\\end{array}", tokenize(r"\begin{array}{c}a\end{array}"))

    def test_control_symbols(self) -> None:
        self.assertEqual(tokenize(r"\{ x \}"), ["\\{", "x", "\\}"])

    def test_never_emits_a_token_containing_whitespace(self) -> None:
        for latex in (r"a \ b", "x \\", r"\  y", "\\"):
            for token in tokenize(latex):
                self.assertNotIn(" ", token, f"{latex!r} produced {token!r}")

    def test_round_trips_through_join_and_split(self) -> None:
        tokens = tokenize(r"\sqrt[3]{x} + \frac{1}{2}")
        self.assertEqual(join_tokens(tokens).split(" "), tokens)

    def test_unknown_tokens_reports_in_order(self) -> None:
        vocab = {"\\frac", "{", "}", "1", "2"}
        self.assertEqual(unknown_tokens(tokenize(r"\frac{1}{q}"), vocab), ["q"])


class Tables(unittest.TestCase):
    def test_applies_texo_spellings(self) -> None:
        tables = TexoTables(
            macros={"\\displaystyle": ""},
            envs={"\\rm": "\\mathrm"},
            symbols={"\\infty": "\\infin", "\\to": "\\rarr"},
            ad_hocs={"\\overbar": "\\bar"},
            expressions={},
            extra={"\\tfrac": "\\frac"},
        )
        tokens = ["\\displaystyle", "x", "\\to", "\\infty", "\\tfrac"]
        self.assertEqual(
            apply_token_tables(tokens, tables),
            ["x", "\\rarr", "\\infin", "\\frac"],
        )


class Scope(unittest.TestCase):
    def test_algebra_is_in_scope(self) -> None:
        self.assertTrue(in_app_scope("3x^{2} - 2x + 1 = 0"))
        self.assertTrue(in_app_scope("\\frac{1}{2} + \\sqrt{9}"))

    def test_calculus_is_not(self) -> None:
        self.assertFalse(in_app_scope("\\int_{0}^{1} x dx"))
        self.assertFalse(in_app_scope("\\sum_{i} i"))

    def test_unknown_commands_are_reported(self) -> None:
        self.assertEqual(unsupported_commands("\\zeta + \\frac{1}{2}"), ["zeta"])


class Inkml(unittest.TestCase):
    def test_reads_mathwriting_shape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ink = parse_inkml(write(Path(tmp), "a.inkml", MATHWRITING_INKML))
        self.assertEqual(ink.sample_id, "deadbeefdeadbeef")
        self.assertEqual(ink.annotations["splitTagOriginal"], "train")
        self.assertEqual(ink.label("normalizedLabel"), "x^{2}+1")
        self.assertEqual(len(ink.strokes), 2)
        # The T channel must not be mistaken for a coordinate.
        self.assertEqual(ink.strokes[0][0], (10.0, 20.0))
        self.assertEqual(ink.strokes[0][-1], (50.0, 20.0))

    def test_reads_crohme_shape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ink = parse_inkml(write(Path(tmp), "b.inkml", CROHME_INKML))
        self.assertEqual(len(ink.strokes), 1)
        self.assertEqual(ink.strokes[0][0], (100.0, 200.0))
        self.assertEqual(
            strip_math_delimiters(ink.label("truth") or ""), "\\frac{1}{2}"
        )

    def test_falls_back_across_label_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ink = parse_inkml(write(Path(tmp), "c.inkml", MATHWRITING_INKML))
        self.assertEqual(ink.label("truth", ("label",)), "x^2 + 1")


class Labels(unittest.TestCase):
    def test_normalises_then_tokenises(self) -> None:
        result = build_label("$$ x^2 + 1 $$", vocab=None)
        self.assertEqual(result.normalized, "x^{2} + 1")
        self.assertEqual(result.text, "x ^ { 2 } + 1")
        self.assertIsNone(result.reject)
        self.assertTrue(result.in_scope)

    def test_rejects_unknown_tokens(self) -> None:
        vocab = {"x", "^", "{", "}", "2", "+", "1"}
        self.assertIsNone(build_label("x^2 + 1", vocab).reject)
        self.assertEqual(build_label("x^2 + q", vocab).reject, "unknown-token")

    def test_rejects_empty_and_overlong(self) -> None:
        self.assertEqual(build_label("   ", None).reject, "empty-label")
        self.assertEqual(build_label("x + 1", None, max_tokens=2).reject, "too-long")

    def test_app_scope_filter_is_opt_in(self) -> None:
        integral = "\\int x dx"
        self.assertIsNone(build_label(integral, None).reject)
        self.assertEqual(
            build_label(integral, None, require_app_scope=True).reject,
            "out-of-app-scope",
        )


class Rendering(unittest.TestCase):
    def setUp(self) -> None:
        try:
            import PIL  # noqa: F401
        except ImportError:
            self.skipTest("Pillow not installed")

    def test_renders_strokes_to_a_png(self) -> None:
        from openmath_finetune.render import RenderConfig, encode_png, render_strokes

        strokes = [[(0.0, 0.0), (100.0, 0.0)], [(50.0, 0.0), (50.0, 40.0)]]
        image = render_strokes(strokes, RenderConfig(margin=8, supersample=2))
        self.assertEqual(image.mode, "L")
        self.assertGreater(image.width, image.height)
        # Ink was actually drawn, not just a blank canvas.
        self.assertLess(min(image.tobytes()), 64)
        self.assertTrue(encode_png(image).startswith(b"\x89PNG"))

    def test_empty_ink_is_an_error_not_a_blank_image(self) -> None:
        from openmath_finetune.render import EmptyInkError, render_strokes

        with self.assertRaises(EmptyInkError):
            render_strokes([])

    def test_stroke_width_scales_with_the_ink(self) -> None:
        """Relative thickness must survive the huge device-resolution spread."""
        from openmath_finetune.render import RenderConfig, render_strokes

        config = RenderConfig(margin=0, supersample=1)
        small = render_strokes([[(0.0, 0.0), (100.0, 0.0)]], config)
        large = render_strokes([[(0.0, 0.0), (1000.0, 0.0)]], config)
        ink_ratio_small = sum(1 for p in small.tobytes() if p < 128) / (small.width * small.height)
        ink_ratio_large = sum(1 for p in large.tobytes() if p < 128) / (large.width * large.height)
        self.assertAlmostEqual(ink_ratio_small, ink_ratio_large, delta=0.15)


if __name__ == "__main__":
    unittest.main()
