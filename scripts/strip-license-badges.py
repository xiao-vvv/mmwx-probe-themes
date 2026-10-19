#!/usr/bin/env python3
"""strip-license-badges.py — git clean filter: 剥离 src/license-badges.ts 的私人许可证勋章。

本地工作区保留勋章(部署用), 但 commit 进 git/GitHub 的版本自动剥离为空数组,
App.tsx / PremiumProbePage.tsx 的 import 仍有效 → GitHub 公开版编译通过且无私人勋章。
用法: git config filter.license-strip.clean 'python3 scripts/strip-license-badges.py clean'
       git config filter.license-strip.smudge 'cat'
"""
import re
import sys

# 匹配所有许可证数组定义块, 逐个替换为空数组
MARKER_RE = re.compile(
    r'export const (EXTRA_LICENSE_BADGES|HEADER_LICENSE_BADGES): \{ name: string; display_name: string \}\[\] = \[.*?\]\n',
    re.DOTALL,
)
HEADER = (
    '// GitHub 公开版: 私人许可证勋章已剥离, 仅展示主控 API 返回的 license_badge。\n'
)


def repl(match: re.Match) -> str:
    name = match.group(1)
    return f'export const {name}: {{ name: string; display_name: string }}[] = []\n'


def strip(src: str) -> str:
    """把 license-badges.ts 的数组全部剥离为空数组。"""
    out = MARKER_RE.sub(repl, src)
    if out == src and 'LICENSE_BADGES' not in src:
        return src  # 文件不含勋章(如已被剥离), 原样返回
    if 'EXTRA_LICENSE_BADGES' in out and '// GitHub 公开版' not in out:
        out = HEADER + out
    return out


def restore(src: str) -> str:
    """smudge 不需要(本地文件本身有勋章, checkout 时保持原样)。"""
    return src


def main() -> None:
    data = sys.stdin.read()
    mode = sys.argv[1] if len(sys.argv) > 1 else 'clean'
    out = strip(data) if mode == 'clean' else restore(data)
    sys.stdout.write(out)


if __name__ == '__main__':
    main()
