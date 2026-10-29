#!/usr/bin/env python3
"""Builds web/index.html from web/index.src.html and the screen sources in design/.

Run from the repo root:  python3 tools/build.py
The design files are the same ones used on the design canvas. In the real app the
fixed 390 x 844 phone frame becomes the full screen.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent


def part(path, name):
    s = path.read_text(encoding='utf-8')
    x = s[s.index('<x-dc>') + 6:s.index('</x-dc>')]
    x = re.sub(r'<helmet>.*?</helmet>', '', x, flags=re.S)
    x = x.replace('width: 390px; height: 844px', 'width: 100%; height: 100%')
    m = re.search(r'<script type="text/x-dc" data-dc-script[^>]*>(.*?)</script>', s, flags=re.S)
    code = m.group(1)
    tpl = f'<template id="tpl-{name}">{x}</template>'
    js = (
        "<script>\n(function () {\n" + code +
        "\nwindow.LIFEOS_COMPONENTS = window.LIFEOS_COMPONENTS || {};\n"
        f"window.LIFEOS_COMPONENTS['{name}'] = {{ cls: Component, tpl: document.getElementById('tpl-{name}') }};\n"
        "})();\n</script>"
    )
    return tpl, js


def main():
    t1, j1 = part(ROOT / 'design' / 'App.dc.html', 'App')
    t2, j2 = part(ROOT / 'design' / 'Chats.dc.html', 'Chats')
    src = (ROOT / 'web' / 'index.src.html').read_text(encoding='utf-8')
    out = src.replace('<!--TEMPLATES-->', t1 + '\n' + t2).replace('<!--COMPONENTS-->', j1 + '\n' + j2)
    (ROOT / 'web' / 'index.html').write_text(out, encoding='utf-8')
    print('web/index.html', len(out), 'bytes')


if __name__ == '__main__':
    main()
