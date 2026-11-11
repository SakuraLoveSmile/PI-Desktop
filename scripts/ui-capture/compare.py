#!/usr/bin/env python3
"""Compare complete offline UI capture runs without changing their inputs."""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageOps


class ComparisonError(ValueError):
    """Invalid or incompatible capture evidence."""


class ComparisonMismatch(ComparisonError):
    """An exact-repeat assertion failed after preserving comparison evidence."""


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ComparisonError(message)


def positive_int(value):
    return type(value) is int and value > 0


def load_run(directory):
    directory = Path(directory).resolve(strict=True)
    manifest_path = directory / "manifest.json"
    require(not manifest_path.is_symlink(), f"Symlink manifest is not capture evidence: {manifest_path}")
    raw = manifest_path.read_bytes()
    manifest = json.loads(raw)
    require(isinstance(manifest, dict) and manifest.get("schemaVersion") == 1,
            f"Unsupported capture manifest: {manifest_path}")
    config = manifest.get("config")
    require(isinstance(config, dict) and config.get("schemaVersion") == 1,
            f"Missing capture configuration: {manifest_path}")
    require(positive_int(config.get("fixtureRevision")), "Missing fixture revision")
    reference = json.loads(Path(__file__).with_name("scenes.json").read_text())
    scenes = config.get("scenes")
    require(scenes == reference["scenes"], "Capture must contain the fixed complete scene list")
    settings = config.get("settings")
    require(isinstance(settings, dict), "Missing capture settings")
    for key in ("theme", "locale", "timezone", "now"):
        require(isinstance(settings.get(key), str) and settings[key], f"Missing capture setting: {key}")
    require(type(settings.get("reducedMotion")) is bool, "Missing reduced-motion setting")
    viewport = settings.get("viewport")
    require(isinstance(viewport, dict) and positive_int(viewport.get("width")) and
            positive_int(viewport.get("height")), "Invalid capture viewport")
    scale = settings.get("deviceScaleFactor")
    require(positive_int(scale), "Invalid device scale factor")
    expected_size = (viewport["width"] * scale, viewport["height"] * scale)
    source = manifest.get("source")
    require(isinstance(source, dict) and re.fullmatch(r"[a-f0-9]{40}", source.get("head", "")) and
            re.fullmatch(r"[a-f0-9]{64}", source.get("workspaceDiffSha256", "")) and
            type(source.get("dirty")) is bool, "Missing source identity")
    environment = manifest.get("environment")
    require(isinstance(environment, dict), "Missing capture environment")
    for key in ("platform", "arch", "osRelease", "electron", "chrome", "node"):
        require(isinstance(environment.get(key), str) and environment[key], f"Missing environment identity: {key}")
    require(positive_int(environment.get("deviceScaleFactor")) and
            environment["deviceScaleFactor"] == scale, "Environment scale differs from capture settings")
    entries = manifest.get("images")
    require(isinstance(entries, list) and len(entries) == len(scenes), "Missing or extra capture image")
    require(all(isinstance(entry, dict) for entry in entries), "Invalid capture image entry")
    ids = [entry.get("id") for entry in entries]
    require(len(set(ids)) == len(ids) and set(ids) == {scene["id"] for scene in scenes},
            "Capture image IDs must be unique and complete")
    images = {}
    for scene in scenes:
        entry = next(entry for entry in entries if entry["id"] == scene["id"])
        filename = entry.get("file")
        require(isinstance(filename, str) and re.fullmatch(r"[a-z0-9-]+\.png", filename) and
                filename == scene["file"], f"Unsafe or unexpected image path: {filename}")
        path = directory / filename
        require(not path.is_symlink(), f"Symlink image is not capture evidence: {filename}")
        data = path.read_bytes()
        require(entry.get("sha256") == sha256(data), f"Image SHA-256 mismatch: {filename}")
        require(type(entry.get("width")) is int and type(entry.get("height")) is int and
                (entry["width"], entry["height"]) == expected_size,
                f"Image manifest dimensions differ from viewport: {filename}")
        with Image.open(path) as image:
            require(image.format == "PNG" and image.size == expected_size,
                    f"Decoded PNG dimensions differ from viewport: {filename}")
            image.load()
            images[scene["id"]] = image.convert("RGBA")
    return {"directory": directory, "manifestSha256": sha256(raw), "config": config,
            "source": source, "environment": environment, "images": images}


def difference_mask(before, after):
    bands = ImageChops.difference(before, after).split()
    mask = bands[0]
    for band in bands[1:]:
        mask = ImageChops.lighter(mask, band)
    return mask.point(lambda value: 255 if value else 0)


def comparison_image(before, after, mask, title, changed):
    width, height = before.size
    header = 28
    result = Image.new("RGB", (width * 3, height + header), "#20252b")
    draw = ImageDraw.Draw(result)
    for index, (label, image) in enumerate((("Before", before), ("After", after),
                                            (f"Pixel diff: {changed}", ImageOps.colorize(mask, "#000000", "#ff3b30")))):
        draw.text((index * width + 6, 8), f"{title} / {label}", fill="white")
        result.paste(image.convert("RGB"), (index * width, header))
    return result


def compare_runs(before_path, after_path, output_path, assert_identical=False):
    before = load_run(before_path)
    after = load_run(after_path)
    require(before["directory"] != after["directory"], "Comparison requires two distinct capture directories")
    require(before["config"] == after["config"], "Capture configurations differ; recapture both sides")
    require(before["environment"] == after["environment"], "Capture environments differ; recapture in one environment")
    output = Path(output_path).resolve()
    for capture in (before, after):
        require(not output.is_relative_to(capture["directory"]), "Output must be outside both input directories")
    require(not output.exists(), f"Output already exists: {output}")
    output.mkdir(parents=True, exist_ok=False)
    scene_results = []
    thumbnails = []
    for scene in before["config"]["scenes"]:
        identifier = scene["id"]
        first = before["images"][identifier]
        second = after["images"][identifier]
        require(first.size == second.size, f"Image dimensions differ: {identifier}")
        mask = difference_mask(first, second)
        changed = mask.histogram()[255]
        comparison_file = f"{identifier}-comparison.png"
        comparison = comparison_image(first, second, mask, identifier, changed)
        comparison.save(output / comparison_file)
        comparison.thumbnail((720, 240), Image.Resampling.LANCZOS)
        thumbnails.append(comparison)
        scene_results.append({"id": identifier, "pixelChanges": changed,
                              "totalPixels": first.width * first.height,
                              "identical": changed == 0, "comparisonFile": comparison_file})
    cell_width = max(image.width for image in thumbnails)
    label_height = 24
    cell_height = max(image.height for image in thumbnails) + label_height
    sheet = Image.new("RGB", (cell_width * 3, cell_height * ((len(thumbnails) + 2) // 3)), "#20252b")
    sheet_draw = ImageDraw.Draw(sheet)
    for index, thumbnail in enumerate(thumbnails):
        x = (index % 3) * cell_width
        y = (index // 3) * cell_height
        scene = scene_results[index]
        sheet_draw.text((x + 6, y + 6), f"{scene['id']} / Before | After | Diff ({scene['pixelChanges']} pixels)", fill="white")
        sheet.paste(thumbnail, (x, y + label_height))
    sheet.save(output / "contact-sheet.png")
    report = {"schemaVersion": 1, "config": before["config"],
              "before": {key: before[key] for key in ("manifestSha256", "source", "environment")},
              "after": {key: after[key] for key in ("manifestSha256", "source", "environment")},
              "sourceIdentical": before["source"] == after["source"],
              "identical": all(scene["identical"] for scene in scene_results),
              "scenes": scene_results, "contactSheet": "contact-sheet.png"}
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    if assert_identical and (not report["sourceIdentical"] or not report["identical"]):
        raise ComparisonMismatch(f"Repeat capture differs in source identity or pixels; evidence retained at {output}")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", required=True, type=Path)
    parser.add_argument("--after", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--assert-identical", action="store_true")
    args = parser.parse_args(argv)
    try:
        report = compare_runs(args.before, args.after, args.output, args.assert_identical)
    except ComparisonMismatch as error:
        print(error, file=sys.stderr)
        return 1
    except (ComparisonError, OSError, json.JSONDecodeError, TypeError) as error:
        print(f"UI comparison failed: {error}", file=sys.stderr)
        return 2
    changed = sum(not scene["identical"] for scene in report["scenes"])
    print(f"UI comparison: {changed}/{len(report['scenes'])} scenes changed; {args.output.resolve() / 'report.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
