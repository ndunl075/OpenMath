"""Parity between the Python normalizer and the TypeScript one it was ported from.

Run: python -m unittest discover -s tools/finetune/tests
Regenerate the golden file with tests/gen_golden.mts after changing normalize.ts.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from openmath_finetune.normalize import (  # noqa: E402
    detect_out_of_scope,
    normalize_latex,
    normalize_with_report,
)

GOLDEN = Path(__file__).with_name("golden_normalize.json")


class NormalizeParity(unittest.TestCase):
    def test_matches_typescript(self) -> None:
        cases = json.loads(GOLDEN.read_text(encoding="utf-8"))
        self.assertGreater(len(cases), 40, "golden file looks truncated")
        mismatches: list[str] = []
        for case in cases:
            got = normalize_latex(case["input"])
            if got != case["output"]:
                mismatches.append(
                    f"  input={case['input']!r}\n"
                    f"    ts={case['output']!r}\n"
                    f"    py={got!r}"
                )
        if mismatches:
            self.fail(
                f"{len(mismatches)}/{len(cases)} cases differ from the TypeScript "
                "normalizer:\n" + "\n".join(mismatches)
            )

    def test_report_notes(self) -> None:
        report = normalize_with_report("$$ x^2 $$")
        self.assertEqual(report.latex, "x^{2}")
        self.assertIn("removed math delimiters", report.notes)

    def test_out_of_scope_matches_app(self) -> None:
        self.assertEqual(detect_out_of_scope("\\int_0^1 x dx"), "integrals")
        self.assertEqual(detect_out_of_scope("\\begin{array}"), "matrices and aligned environments")
        self.assertIsNone(detect_out_of_scope("x^{2} + 1 = 0"))


if __name__ == "__main__":
    unittest.main()
