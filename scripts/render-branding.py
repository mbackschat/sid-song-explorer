#!/usr/bin/env python3
"""Render the checked-in logo masters and compact favicon with local CLI tools."""
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets/branding"


def main():
    for tool in ("rsvg-convert", "cwebp", "magick"):
        if shutil.which(tool) is None:
            raise SystemExit(f"Missing {tool}; see assets/branding/README.md")
    work = ROOT / "build/branding"
    work.mkdir(parents=True, exist_ok=True)

    def run(*command):
        subprocess.run(list(map(str, command)), check=True, timeout=30)

    master = ASSETS / "sid-song-explorer.svg"
    compact = ASSETS / "sid-song-explorer-compact.svg"
    run("rsvg-convert", master, "-o", ASSETS / "sid-song-explorer.png")
    run("cwebp", "-quiet", "-lossless", "-exact", "-m", "6",
        ASSETS / "sid-song-explorer.png", "-o", ASSETS / "sid-song-explorer.webp")
    frames = []
    for size in (16, 32, 48):
        frame = ASSETS / f"favicon-{size}.png"
        run("rsvg-convert", "-w", size, "-h", size, compact, "-o", frame)
        frames.append(frame)
    run("magick", *frames, ASSETS / "favicon.ico")
    run("rsvg-convert", "-w", 144, "-h", 144, master,
        "-o", work / "sid-song-explorer-144.png")
    for theme in ("light", "dark"):
        run("rsvg-convert", ASSETS / f"sid-song-explorer-wordmark-{theme}.svg",
            "-o", work / f"wordmark-{theme}.png")
    print(f"Rendered logo assets in {ASSETS}; review previews in {work}")


if __name__ == "__main__":
    main()
