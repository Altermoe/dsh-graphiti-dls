#!/usr/bin/env python3
"""dshmarket 目录分析器：筛选角色扮演 / 记忆类插件并采集真实 npm 周下载量。

数据源（可复现，均为公开只读接口）：
  - 目录索引: https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json
    这是 dsh 官方插件市场 dshmarket 使用的同一份 format-1 目录。
  - 下载量:   https://api.npmjs.org/downloads/point/last-week/<package>

用途：为对比实验挑选「高下载量、用于角色扮演的记忆插件」基线，
     并把选型依据（下载量、分类、仓库、记忆机制线索）固化为 JSON。

用法：
  python3 scripts/market_catalog.py --catalog /tmp/dsh-catalog.json
  python3 scripts/market_catalog.py --fetch --downloads --top 25
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

CATALOG_URL = "https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json"
NPM_DOWNLOADS = "https://api.npmjs.org/downloads/point/last-week/{}"

ROLEPLAY = re.compile(
    r"roleplay|role[- ]play|character[ -]?card|persona|sillytavern|tavern|"
    r"companion|长篇|角色扮演|角色卡|人格|陪伴|酒馆|人设|世界书",
    re.I,
)
MEMORY = re.compile(r"memory|memor|recall|记忆|长期", re.I)


def http_get(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "dsh-graphiti-dls/eval"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def load_catalog(catalog_path: Path, do_fetch: bool) -> dict:
    if do_fetch or not catalog_path.exists():
        print(f"[fetch] {CATALOG_URL}", file=sys.stderr)
        catalog_path.write_bytes(http_get(CATALOG_URL, timeout=90))
    return json.loads(catalog_path.read_text(encoding="utf-8"))


def iter_plugins(catalog: dict):
    """format-1 目录的 plugins 可能是数组，也可能是按 id 索引的对象。"""
    raw = None
    for key in ("plugins", "items", "entries", "packages"):
        if key in catalog:
            raw = catalog[key]
            break
    if raw is None:
        # 退化：找第一个内容为 list/dict 且元素含 name 的顶层键
        for key, value in catalog.items():
            if isinstance(value, (list, dict)) and key not in ("metadata", "categories"):
                raw = value
                break
    if raw is None:
        raise SystemExit("无法在目录中定位插件列表")
    if isinstance(raw, dict):
        for key, value in raw.items():
            if isinstance(value, dict):
                yield {"_key": key, **flatten(value)}
    elif isinstance(raw, list):
        for value in raw:
            if isinstance(value, dict):
                yield flatten(value)
    else:
        raise SystemExit(f"插件列表类型异常: {type(raw)}")


def flatten(plugin: dict) -> dict:
    """把 metadata.category / keywords 等嵌套字段提升到顶层，便于统一筛选。"""
    flat = dict(plugin)
    meta = flat.get("metadata")
    if isinstance(meta, dict):
        for key, value in meta.items():
            flat.setdefault(key, value)
    return flat


def text_of(plugin: dict) -> str:
    parts = []

    def walk(value):
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, (list, tuple)):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            for key, item in value.items():
                if key in ("screenshots", "icon", "logo"):
                    continue
                walk(item)

    walk({k: v for k, v in plugin.items() if k != "_key"})
    return " ".join(parts)


def as_text(value) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return " ".join(str(x) for x in value.values())
    if isinstance(value, list):
        return " ".join(as_text(x) for x in value)
    return "" if value is None else str(value)


def summarise(plugin: dict) -> dict:
    def pick(*keys):
        for key in keys:
            if key in plugin and plugin[key] not in (None, "", [], {}):
                return plugin[key]
        return None

    name = pick("name", "package", "packageName", "id") or plugin.get("_key") or ""
    return {
        "name": str(name),
        "version": as_text(pick("version")),
        "category": as_text(pick("category", "categories", "group")),
        "tags": as_text(pick("tags", "topics", "keywords")),
        "description": as_text(pick("description", "summary", "desc"))[:500],
        "repo": as_text(pick("repo", "repository", "github", "homepage", "url")),
    }


def weekly_downloads(package: str) -> int | None:
    url = NPM_DOWNLOADS.format(urllib.parse.quote(package, safe="@"))
    try:
        data = json.loads(http_get(url, timeout=12))
        return int(data["downloads"])
    except (urllib.error.URLError, KeyError, ValueError, TimeoutError, OSError):
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", type=Path, default=Path("/tmp/dsh-catalog.json"))
    ap.add_argument("--fetch", action="store_true", help="重新下载目录索引")
    ap.add_argument("--downloads", action="store_true", help="查询 npm 周下载量")
    ap.add_argument("--top", type=int, default=25)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument(
        "--select",
        default="",
        help="逗号分隔的插件名；把这些插件的选型依据写入 eval/market-baselines.json",
    )
    args = ap.parse_args()

    catalog = load_catalog(args.catalog, args.fetch)
    print("=== catalog top-level keys ===", list(catalog.keys()))
    meta = catalog.get("metadata", {})
    if isinstance(meta, dict) and "categories" in meta:
        cats = meta["categories"]
        print("=== categories ===", list(cats)[:30] if isinstance(cats, dict) else cats)

    plugins = list(iter_plugins(catalog))
    print(f"=== total plugins: {len(plugins)} ===")
    if plugins:
        print("=== first plugin sample ===")
        print(json.dumps(plugins[0], ensure_ascii=False)[:1400])

    candidates = []
    for raw in plugins:
        item = summarise(raw)
        blob = text_of(raw)
        has_memory = bool(MEMORY.search(blob)) or "memory" in item["category"].lower()
        has_roleplay = bool(ROLEPLAY.search(blob))
        if has_memory and has_roleplay:
            item["roleplay_memory"] = True
            item["signal"] = "memory+roleplay"
        elif has_memory and item["category"].strip().lower() in ("memory", "记忆"):
            item["roleplay_memory"] = False
            item["signal"] = "memory-category"
        else:
            continue
        candidates.append(item)

    print(f"=== candidates: {len(candidates)} ===")
    for item in candidates[: args.top]:
        print(" -", item["name"], "|", item["signal"], "|", item["category"][:40], "|", item["description"][:90])

    if args.downloads:
        print("=== npm weekly downloads (concurrent) ===", file=sys.stderr)
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {
                pool.submit(weekly_downloads, item["name"]): item["name"]
                for item in candidates
            }
            measured = {}
            for future in as_completed(futures):
                measured[futures[future]] = future.result()
        for item in candidates:
            item["weekly_downloads"] = measured.get(item["name"])
        ranked = sorted(
            [x for x in candidates if x.get("weekly_downloads") is not None],
            key=lambda x: -x["weekly_downloads"],
        )
        print("=== ranked by weekly downloads ===")
        for item in ranked[: args.top]:
            print(f" {item['weekly_downloads']:>9}  {item['name']:<48} {item['signal']}")

    out = args.out or Path(__file__).resolve().parent.parent / "eval" / "market-candidates.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "catalog_url": CATALOG_URL,
                "downloads_source": NPM_DOWNLOADS,
                "total_plugins": len(plugins),
                "candidates": candidates,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"=== wrote {out} ===")

    if args.select:
        wanted = [name.strip() for name in args.select.split(",") if name.strip()]
        by_name = {item["name"]: item for item in candidates}
        selected = []
        for name in wanted:
            record = by_name.get(name)
            if record is None:
                print(f"[warn] 目录中未找到候选: {name}", file=sys.stderr)
                continue
            selected.append(record)
        rank = sorted(selected, key=lambda x: -(x.get("weekly_downloads") or 0))
        baseline_out = Path(__file__).resolve().parent.parent / "eval" / "market-baselines.json"
        baseline_out.write_text(
            json.dumps(
                {
                    "selection_rule": (
                        "dshmarket 官方 format-1 目录中 signal=memory+roleplay 的插件，"
                        "按 npm last-week 下载量降序取前 4；覆盖不同记忆机制以便对比。"
                    ),
                    "measured_at": "2026-11-13",
                    "catalog_url": CATALOG_URL,
                    "downloads_source": NPM_DOWNLOADS,
                    "candidate_pool_size": len(candidates),
                    "selected": rank,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"=== wrote {baseline_out} ({len(rank)} baselines) ===")
        for item in rank:
            print(f"  {item.get('weekly_downloads') or 0:>7}/wk  {item['name']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
