"""Evidence-contract regressions using tiny real PNG capture sets."""

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, PngImagePlugin


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("ui_compare", HERE / "compare.py")
COMPARE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPARE)


class CompareRunsTest(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="pi-ui-compare-test-")
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.before = self.root / "before"
        self.after = self.root / "after"
        self.output = self.root / "comparison"
        self.config = json.loads((HERE / "scenes.json").read_text())
        self.config["settings"]["viewport"] = {"width": 8, "height": 6}
        self.manifest = {"schemaVersion": 1, "config": self.config,
                         "source": {"head": "a" * 40, "workspaceDiffSha256": "b" * 64, "dirty": False},
                         "environment": {"platform": "fixture", "arch": "fixture", "osRelease": "fixture",
                                         "electron": "fixture", "chrome": "fixture", "node": "fixture", "deviceScaleFactor": 1},
                         "images": []}
        for directory in (self.before, self.after):
            directory.mkdir()
            manifest = copy.deepcopy(self.manifest)
            for scene in self.config["scenes"]:
                path = directory / scene["file"]
                image = Image.new("RGBA", (8, 6), (40, 60, 80, 255))
                metadata = PngImagePlugin.PngInfo()
                metadata.add_text("fixture", directory.name)
                image.save(path, compress_level=0 if directory == self.before else 9, pnginfo=metadata)
                manifest["images"].append({**scene, "width": 8, "height": 6,
                                            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
            self.write_manifest(directory, manifest)

    def read_manifest(self, directory):
        return json.loads((directory / "manifest.json").read_text())

    def write_manifest(self, directory, manifest):
        (directory / "manifest.json").write_text(json.dumps(manifest))

    def mutate_image(self, *, size=None, pixel=(255, 0, 0, 255)):
        path = self.after / self.config["scenes"][0]["file"]
        with Image.open(path) as existing:
            image = existing.convert("RGBA")
        if size:
            image = image.resize(size)
        else:
            image.putpixel((2, 3), pixel)
        image.save(path)
        manifest = self.read_manifest(self.after)
        manifest["images"][0]["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.write_manifest(self.after, manifest)

    def compare(self, assert_identical=False):
        return COMPARE.compare_runs(self.before, self.after, self.output, assert_identical)

    def test_reencoded_png_is_identical_and_creates_complete_evidence(self):
        report = self.compare(assert_identical=True)
        self.assertTrue(report["identical"])
        self.assertEqual(len(report["scenes"]), 12)
        self.assertTrue((self.output / "contact-sheet.png").is_file())
        self.assertEqual(len(list(self.output.glob("*-comparison.png"))), 12)
        self.assertNotEqual(report["before"]["manifestSha256"], report["after"]["manifestSha256"])
        self.assertEqual(report, json.loads((self.output / "report.json").read_text()))

    def test_single_pixel_change_is_not_tolerated(self):
        self.mutate_image()
        with self.assertRaises(COMPARE.ComparisonMismatch):
            self.compare(assert_identical=True)
        report = json.loads((self.output / "report.json").read_text())
        self.assertFalse(report["identical"])
        self.assertEqual(report["scenes"][0]["pixelChanges"], 1)
        self.assertTrue((self.output / report["scenes"][0]["comparisonFile"]).is_file())

    def test_alpha_only_change_counts_as_pixel_change(self):
        self.mutate_image(pixel=(40, 60, 80, 100))
        self.assertEqual(self.compare()["scenes"][0]["pixelChanges"], 1)

    def test_source_difference_allowed_for_normal_comparison(self):
        manifest = self.read_manifest(self.after)
        manifest["source"]["head"] = "c" * 40
        self.write_manifest(self.after, manifest)
        report = self.compare()
        self.assertFalse(report["sourceIdentical"])
        self.assertTrue(report["identical"])

    def test_repeat_cli_rejects_source_difference_and_retains_report(self):
        manifest = self.read_manifest(self.after)
        manifest["source"]["workspaceDiffSha256"] = "c" * 64
        self.write_manifest(self.after, manifest)
        result = subprocess.run([sys.executable, str(HERE / "compare.py"), "--before", str(self.before),
                                 "--after", str(self.after), "--output", str(self.output), "--assert-identical"],
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertTrue((self.output / "report.json").is_file())

    def test_environment_and_configuration_mismatch_rejected(self):
        for field, key, value in (("environment", "electron", "different"),
                                  ("config", "fixtureRevision", 2)):
            with self.subTest(field=field):
                original = self.read_manifest(self.after)
                manifest = copy.deepcopy(original)
                manifest[field][key] = value
                self.write_manifest(self.after, manifest)
                with self.assertRaisesRegex(COMPARE.ComparisonError, "differ"):
                    self.compare()
                self.assertFalse(self.output.exists())
                self.write_manifest(self.after, original)

    def test_missing_duplicate_and_incomplete_images_rejected(self):
        original = self.read_manifest(self.after)
        for change in (lambda manifest: manifest["images"].pop(),
                       lambda manifest: manifest["images"].__setitem__(0, manifest["images"][1])):
            manifest = copy.deepcopy(original)
            change(manifest)
            self.write_manifest(self.after, manifest)
            with self.assertRaises(COMPARE.ComparisonError):
                self.compare()
        self.write_manifest(self.after, original)
        (self.after / original["images"][0]["file"]).unlink()
        with self.assertRaises(FileNotFoundError):
            self.compare()
        self.assertFalse(self.output.exists())

    def test_file_hash_and_decoded_dimensions_checked(self):
        path = self.after / self.config["scenes"][0]["file"]
        path.write_bytes(path.read_bytes() + b"modified")
        with self.assertRaisesRegex(COMPARE.ComparisonError, "SHA-256"):
            self.compare()
        self.mutate_image(size=(9, 6))
        with self.assertRaisesRegex(COMPARE.ComparisonError, "dimensions"):
            self.compare()
        self.assertFalse(self.output.exists())

    def test_path_traversal_and_symlink_images_rejected(self):
        manifest = self.read_manifest(self.after)
        original = copy.deepcopy(manifest)
        manifest["images"][0]["file"] = "../outside.png"
        self.write_manifest(self.after, manifest)
        with self.assertRaisesRegex(COMPARE.ComparisonError, "path"):
            self.compare()
        self.write_manifest(self.after, original)
        filename = original["images"][0]["file"]
        path = self.after / filename
        path.unlink()
        path.symlink_to(self.before / filename)
        with self.assertRaisesRegex(COMPARE.ComparisonError, "Symlink"):
            self.compare()

    def test_output_must_be_new_and_outside_inputs(self):
        for output in (self.before / "comparison", self.after / "comparison", self.before, self.root):
            with self.subTest(output=str(output)), self.assertRaises(COMPARE.ComparisonError):
                COMPARE.compare_runs(self.before, self.after, output)
        self.assertFalse((self.before / "comparison").exists())

    def test_same_capture_cannot_prove_an_independent_repeat(self):
        with self.assertRaisesRegex(COMPARE.ComparisonError, "distinct"):
            COMPARE.compare_runs(self.before, self.before, self.output, assert_identical=True)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
