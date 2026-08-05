"""MkDocs hook：自动生成首页分类卡片 + 导航菜单。

- 首页卡片：docs/index.md 中写占位符 <!-- category-cards -->，
  此处用 docs/ 下各分类目录的 .md 文件生成 `grid cards` 网格替换它。
- 导航：按 docs/ 目录结构动态生成 nav，新增笔记零配置即被收录。

CATEGORIES 里的目录是「分类」；其余目录里的 .md 直接列在导航中。
"""
from pathlib import Path
import subprocess

# 目录名 -> (显示名, FontAwesome 图标)
CATEGORIES = [
    ("mcu", "MCU 与驱动", "fontawesome-solid-microchip"),
    ("rtos", "RTOS", "fontawesome-solid-gears"),
    ("hardware", "硬件调试", "fontawesome-solid-bolt"),
    ("environment", "开发环境", "fontawesome-solid-toolbox"),
    ("environment-tips", "开发环境技巧", "fontawesome-solid-lightbulb"),
]

PLACEHOLDER = "<!-- category-cards -->"
RECENT_PLACEHOLDER = "<!-- recent-updates -->"


def _recent_updates(docs_dir: Path) -> str:
    """按 git 提交时间生成最近更新列表（提交日期 + 提交信息）。"""
    try:
        out = subprocess.run(
            ["git", "log", "--date=short", "--pretty=format:%ad %s", "--", str(docs_dir)],
            capture_output=True, text=True, encoding="utf-8",
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return RECENT_PLACEHOLDER  # 非 git 环境，保留占位符
    if not out:
        return RECENT_PLACEHOLDER

    lines = [f"- {line}" for line in out.splitlines() if line]
    # 每个提交一行，按日期倒序取前 10 条
    lines.sort(key=lambda x: x[2:x.find(" ", 2)], reverse=True)
    return "\n".join(lines[:10]) + "\n"


def _build_cards(docs_dir: Path) -> str:
    blocks = []
    for dirname, title, icon in CATEGORIES:
        d = docs_dir / dirname
        if not d.is_dir():
            continue
        notes = sorted(p for p in d.glob("*.md"))
        if not notes:
            continue
        links = "\n".join(f"    - [{p.stem}]({dirname}/{p.name})" for p in notes)
        blocks.append(
            f"-   :{icon}: **{title}**\n"
            "\n"
            "    ---\n"
            f"\n{links}"
        )
    if not blocks:
        return ""
    body = "\n\n".join(blocks)
    return f'<div class="grid cards" markdown>\n\n{body}\n\n</div>\n'


def on_page_markdown(markdown: str, *, page, config, **kwargs):
    if page.file.src_uri != "index.md":
        return markdown
    if PLACEHOLDER in markdown:
        markdown = markdown.replace(PLACEHOLDER, _build_cards(Path(config["docs_dir"])))
    if RECENT_PLACEHOLDER in markdown:
        markdown = markdown.replace(RECENT_PLACEHOLDER, _recent_updates(Path(config["docs_dir"])))
    return markdown


def _note_title(path: Path, name: str) -> str:
    """从笔记正文第一个 # 取标题，取不到就退回文件名。"""
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("# "):
                return line[2:].strip()
    except OSError:
        pass
    return name


def _dir_nav(dirpath: Path) -> list:
    notes = sorted(
        (p for p in dirpath.iterdir() if p.is_file() and p.suffix == ".md"),
        key=lambda p: p.name,
    )
    return [
        {_note_title(p, p.stem): f"{dirpath.name}/{p.name}"}
        for p in notes
    ]


def _nav(docs_dir: Path) -> list:
    label_of = {name: title for name, title, _ in CATEGORIES}
    nav = [{"首页": "index.md"}]
    for d in sorted(docs_dir.iterdir()):
        if not d.is_dir():
            continue
        entries = _dir_nav(d)
        if entries:
            nav.append({label_of.get(d.name, d.name): entries})
    return nav


def on_config(config):
    nav = _nav(Path(config["docs_dir"]))
    if nav:
        config["nav"] = nav
    return config
