#!/usr/bin/env bash
# 一次跑完所有回归测试（Git Bash on Windows）。
#   bash tools/run-all-tests.sh
#
# 为什么放在仓库里而不是临时目录：TEMP 会被系统清理，脚本丢了很容易误以为
# "测试跑过了"（实际是没跑）。这个脚本只依赖本机 Chrome，路径全部相对本文件。
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"
cd "$repo" || exit 1

CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
if [ ! -x "$CHROME" ]; then
  echo "找不到 Chrome：$CHROME"
  echo "用 CHROME=/path/to/chrome bash tools/run-all-tests.sh 指定"
  exit 1
fi

tmp="${TMPDIR:-/tmp}/kl-tests"
mkdir -p "$tmp"

fails_total=0
pass_total=0

# 浏览器测试：断言写在 document.title 里，用 --dump-dom 回读
run_browser () {
  local name="$1" url="$2" budget="${3:-12000}"
  local udd="$tmp/udd-$name-$$-$RANDOM"
  # 名字带随机数：即使 rm 被安全策略拦下（本机 rm 包装器不接受带盘符的路径），
  # 也绝不会复用上一次的 localStorage —— 否则测试结果会受上次残留数据影响。
  rm -rf "$udd" >/dev/null 2>&1 || true
  local title
  title="$("$CHROME" --headless=new --disable-gpu --allow-file-access-from-files \
    --window-size=1000,760 --virtual-time-budget="$budget" --user-data-dir="$udd" \
    --dump-dom "$url" 2>/dev/null | grep -o '<title>[^<]*</title>' | sed 's/<[^>]*>//g')"
  if [ -z "$title" ]; then
    printf '  %-18s %s\n' "$name" '❌ 没拿到 title（Chrome 崩了？）'
    fails_total=$((fails_total + 1))
    return
  fi
  # title 通过 argv 传进去 —— 不能用管道，因为 `python - <<EOF` 的 heredoc 会占掉 stdin
  python - "$name" "$title" <<'PY'
import sys
name, t = sys.argv[1], sys.argv[2]
t = t.strip()
if ' | ' in t:
    t = t.split(' | ', 1)[1]
t = t.replace(' ; ', '  ')          # 有的测试用 ' ; ' 作分隔，统一成两个空格
parts = [x for x in t.split('  ') if x.strip()]
bad = [x for x in parts if not x.startswith('PASS')]
if not parts:
    print('  %-18s ❌ 解析不出断言（title=%r）' % (name, t[:60]))
    sys.exit(1)
print('  %-18s %3d 项  失败 %d' % (name, len(parts), len(bad)))
for b in bad[:8]:
    print('     ✗', b[:100])
sys.exit(1 if bad else 0)
PY
  if [ $? -ne 0 ]; then fails_total=$((fails_total + 1)); fi
}

run_node () {
  local name="$1" script="$2"
  local out
  out="$(node "$script" 2>&1 | tail -1)"
  printf '  %-18s %s\n' "$name" "$out"
  case "$out" in
    *"ALL PASS"*|*"全部通过"*) : ;;
    *) fails_total=$((fails_total + 1)) ;;
  esac
}

echo "== 浏览器测试 =="
base="file:///$(echo "$repo" | sed 's|^/\([a-z]\)/|\1:/|')/tools"
run_browser uitest          "$base/uitest.html"
run_browser dedup-test      "$base/dedup-test.html"
run_browser tip-test        "$base/tip-test.html"
run_browser layout-test     "$base/layout-test.html"
run_browser grid-layout     "$base/grid-layout-test.html"
run_browser data            "$base/data-test.html" 11000
run_browser folder-有字      "$base/folder-test.html?labels=1" 13000
run_browser folder-无字      "$base/folder-test.html?labels=0" 13000

echo "== Node 测试 =="
run_node    offline-seo      tools/offline-test.js
run_node    release          tools/release.js

echo
if [ "$fails_total" -eq 0 ]; then
  echo "✅ 全部通过"
else
  echo "❌ 有 $fails_total 组失败"
  exit 1
fi
