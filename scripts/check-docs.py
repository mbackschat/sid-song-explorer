#!/usr/bin/env python3
"""Check repository Markdown links without network or sibling dependencies.

Covers inline links and GitHub-style heading fragments used in this repository.
External URLs are deliberately excluded: dated research includes historical sites.
"""
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
LINK = re.compile(r"\[[^\]]*\]\(([^\s)]+)\)")


def anchors(text):
    found = set(re.findall(r'<a\s+(?:id|name)=["\']([^"\']+)', text))
    counts = {}
    fenced = False
    for line in text.splitlines():
        if line.startswith(('```', '~~~')):
            fenced = not fenced
        if fenced:
            continue
        heading = re.match(r'^#{1,6}\s+(.+?)\s*#*$', line)
        if not heading:
            continue
        title = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', heading[1])
        slug = re.sub(r'[^\w\- ]', '', title.lower()).replace(' ', '-')
        number = counts.get(slug, 0)
        counts[slug] = number + 1
        found.add(f'{slug}-{number}' if number else slug)
    return found


def main():
    names = subprocess.check_output(
        ['git', 'ls-files', '-z', '--', '*.md'], cwd=ROOT
    ).decode().split('\0')
    files = [ROOT / name for name in names if name]
    failures = []
    for path in files:
        for number, line in enumerate(path.read_text().splitlines(), 1):
            for match in LINK.finditer(line):
                target = urlsplit(match[1])
                if target.scheme or target.netloc:
                    continue
                resolved = (path.parent / unquote(target.path)).resolve() if target.path else path.resolve()
                where = f'{path.relative_to(ROOT)}:{number}: {match[1]}'
                if not resolved.is_relative_to(ROOT):
                    failures.append(f'{where}: escapes repository')
                elif not resolved.exists():
                    failures.append(f'{where}: missing target')
                elif target.fragment and resolved.suffix == '.md':
                    if unquote(target.fragment) not in anchors(resolved.read_text()):
                        failures.append(f'{where}: missing heading/anchor')
    if failures:
        print('\n'.join(failures), file=sys.stderr)
        return 1
    print(f'Checked local links and fragments in {len(files)} tracked Markdown files.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
