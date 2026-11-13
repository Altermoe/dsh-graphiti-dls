#!/usr/bin/env bash
# 本地 deepseek-harness 集成验证（配置合成层）。
#
# 只做 `--dump-config`：合成并打印 profile 组合树，不加载插件代码、不启动
# 需要模型凭据的 app，也不改动 ~/.dsh/profiles 下的任何现有配置。
# 完整装载与实例内评测走另一条路径：用 dsh 的 plugin_manager 安装本目录
# （pnpm link + bundle 选中），宿主进程激活 dls-live-eval 后自动写出
# eval/results/dsh-live/。本脚本只做无需凭据的配置合成检查。
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
