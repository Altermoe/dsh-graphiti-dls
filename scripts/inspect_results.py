#!/usr/bin/env python3
"""抽查评测结果：按 case_id 或 category 汇总，复核实验是否按预期运行。

用法：python3 scripts/inspect_results.py [compare|ablation] [case_id 或 category]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
suite = sys.argv[1] if len(sys.argv) > 1 else "compare"
key = sys.argv[2] if len(sys.argv) > 2 else "recall-0"

data = json.loads((ROOT / "eval/results" / f"{suite}.json").read_text(encoding="utf-8"))
rows = [r for r in data["results"] if r["case_id"] == key or r["category"] == key]
print(f"suite={suite} filter={key} rows={len(rows)}")
for row in rows[:60]:
    print(
        f"  {row['system_id']:<46} case={row['case_id']:<24} "
        f"tokens={row['tokens']:<6} acc={int(row['answer_correct'])} "
        f"stale={int(row['stale_misuse'])} bad={row['bad_writes']}/{row['bad_total']}"
    )
