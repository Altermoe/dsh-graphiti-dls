#!/usr/bin/env bash
# 本地 deepseek-harness 集成验证（配置合成层）。
#
# 只做 `--dump-config`：合成并打印 profile 组合树，不加载插件代码、不启动
# 需要模型凭据的 app，也不改动 ~/.dsh/profiles 下的任何现有配置。
# 如需完整启动，先发布/link 本仓库，再执行
#   dsh plugin --profile <name> add <package>
# 然后正常 boot；那一步需要模型凭据，不在自动化验证范围内。
set -euo pipefail

DSH_REPO="${DSH_REPO:-/home/cyrene/codes/deepseek-harness}"
PROFILE="${PROFILE:-web}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH="$PROJECT_DIR/eval/dls-plugin.patch.yml"
OUT="$PROJECT_DIR/eval/results/dsh-dump-config.txt"

if [ ! -d "$DSH_REPO" ]; then
  echo "FAIL: 找不到 deepseek-harness: $DSH_REPO" >&2
  exit 1
fi
mkdir -p "$(dirname "$OUT")"
cd "$DSH_REPO"

pnpm dsh --profile "$PROFILE" --patch "$PATCH" --dump-config > "$OUT"
if ! grep -q "id: dls-memory" "$OUT"; then
  echo "FAIL: dls-memory 未进入 profile 组合树" >&2
  exit 1
fi
echo "OK: dls-memory 已进入 profile=$PROFILE 组合树 -> $OUT"
grep -n -A 8 "id: dls-memory" "$OUT" | head -10
