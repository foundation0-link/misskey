#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# merge-upstream.sh
#
# Upstream (misskey-dev/misskey) のうち、まだ取り込んでいない変更を
# ファイル単位の 3-way マージで proprietary ブランチへ取り込むスクリプト。
#
# このリポジトリは squash 済み (initial commit のみ) で upstream と共通祖先を
# 持たないため、通常の `git merge` は使えない。代わりに「擬似ベース (START)」を
# 起点として各ファイルを 3-way マージする:
#
#   base   = START コミット時点のファイル内容   (git show START:<file>)
#   ours   = 現在のワークツリーのファイル内容
#   theirs = 取り込み先 (END) のファイル内容     (git show END:<file>)
#
#   START の決定:
#     - 初回   : 設定値 UPSTREAM_START_COMMITID を使用
#     - 2回目以降: コミットログのトレーラ `Upstream-Merge: <sha>` から
#                  最後に取り込んだ END を探して START とする
#   END   = upstream/<UPSTREAM_BRANCH> の最新コミット
#
# コンフリクトしたファイルは CONFLICT_RESOLUTION の方針に従い極力補正してマージ
# する (既定は theirs = upstream 優先で自動解決し、マーカーを残さない)。
# =============================================================================

# ===== 設定 =====
BRANCH="proprietary"
UPSTREAM_REPOSITORY="https://github.com/misskey-dev/misskey.git"
UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="develop"

# 初回マージ時の upstream 側のコミット ID (SHA1) を指定する。
UPSTREAM_START_COMMITID="3ce17c6e9f77fe9318d21cdab8f7057cd8d454e4"

# 1: CHANGELOG を完全無視 / 0: theirs で自動解決
IGNORE_CHANGELOG=1
CHANGELOG_FILES=("CHANGELOG.md")

# theirs で強制上書きするファイル（glob 対応）
THEIRS_FILES=(
  "package.json"
  "pnpm-lock.yaml"
  "pnpm-workspace.yaml"
  "packages/*/package.json"
  "scripts/*/package.json"
  "scripts/*/package-lock.json",
  ".claude/*"
  ".github/*"
  ".gitignore"
)

# コンフリクト時の自動補正方針: theirs | ours | union | markers
#   theirs  : 競合した箇所は upstream(END) を採用して完全マージ (既定)
#   ours    : 競合した箇所は現在の内容を維持して完全マージ
#   union   : 競合した両方の内容を残して完全マージ
#   markers : 競合マーカー (<<<<<<< 等) を残し、当該ファイルはステージしない
CONFLICT_RESOLUTION="theirs"

# 1: マージ結果を自動コミット / 0: ステージのみ (コミットコマンドを表示)
AUTO_COMMIT=0

# =============================================================================
# 以降は基本的に編集不要
# =============================================================================

note() { printf '%s\n' "$*"; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ----- ブランチ確認 -----
current_branch=$(git branch --show-current)
[[ "$current_branch" == "$BRANCH" ]] || die "branch must be '$BRANCH' (current: $current_branch)"

# ----- ワークツリーがクリーンか確認 -----
if [[ -n "$(git status --porcelain)" ]]; then
  die "ワークツリーに未コミットの変更があります。コミットまたは stash してから再実行してください。"
fi

# ----- upstream remote 準備 -----
if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
  note "== Add remote '$UPSTREAM_REMOTE' ($UPSTREAM_REPOSITORY) =="
  git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_REPOSITORY"
fi

note "== Fetch upstream =="
git fetch --quiet "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"

# ----- START / END の決定 -----
END=$(git rev-parse "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")

marker_commit=$(git log -n1 --grep='^Upstream-Merge:' --format='%H' 2>/dev/null || true)
if [[ -n "$marker_commit" ]]; then
  START=$(git show -s --format='%B' "$marker_commit" \
            | sed -n 's/^Upstream-Merge:[[:space:]]*//p' | head -n1)
  note "== 前回マージ地点をログから検出: ${START:0:12} (commit ${marker_commit:0:12}) =="
else
  START="$UPSTREAM_START_COMMITID"
  note "== 初回マージ: UPSTREAM_START_COMMITID=${START:0:12} を起点に使用 =="
fi

# START が有効なコミットか検証
git cat-file -e "${START}^{commit}" 2>/dev/null \
  || die "START コミットが見つかりません: $START (upstream を fetch 済みか確認してください)"

if [[ "$START" == "$END" ]]; then
  note "== 取り込み済みです (START == END: ${END:0:12})。差分はありません。 =="
  exit 0
fi

SHORT_START=${START:0:12}
SHORT_END=${END:0:12}
note "== マージ範囲: ${SHORT_START}..${SHORT_END} =="

# ----- glob マッチ判定 -----
# case の glob は '/' も '*' に含むため厳密ではないが、対象ファイル群では十分。
match_any() {
  local f=$1 p; shift
  for p in "$@"; do
    # shellcheck disable=SC2254
    case "$f" in $p) return 0 ;; esac
  done
  return 1
}

is_theirs_file()    { match_any "$1" "${THEIRS_FILES[@]}"; }
is_changelog_file() { match_any "$1" "${CHANGELOG_FILES[@]}"; }

# ----- バイナリ判定 (START..END 範囲での当該ファイル) -----
is_binary() {
  local f=$1 first
  first=$(git diff --numstat "$START" "$END" -- "$f" 2>/dev/null | awk 'NR==1{print $1}')
  [[ "$first" == "-" ]]
}

# ----- 集計用 -----
cnt_clean=0 cnt_autofix=0 cnt_conflict=0 cnt_theirs=0 cnt_delete=0 cnt_skip=0 cnt_binary=0
conflict_files=()

TMPDIR_WORK=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR_WORK"; }
trap cleanup EXIT

tb="$TMPDIR_WORK/base"
to="$TMPDIR_WORK/ours"
tt="$TMPDIR_WORK/theirs"
tout="$TMPDIR_WORK/out"

# 3-way マージを実行し、結果に応じてステージ/補正する。
# $1=file path
merge_3way() {
  local f=$1 rc

  git show "$START:$f" >"$tb" 2>/dev/null || : >"$tb"   # base (無ければ空 = 新規追加扱い)
  git show "$END:$f"   >"$tt" 2>/dev/null || : >"$tt"   # theirs
  if [[ -f "$f" ]]; then cp "$f" "$to"; else : >"$to"; fi # ours

  # まずは通常の 3-way マージ (競合は --diff3 マーカーで検出)
  set +e
  git merge-file -p --diff3 -L ours -L base -L theirs "$to" "$tb" "$tt" >"$tout" 2>/dev/null
  rc=$?
  set -e

  if [[ $rc -ge 255 ]]; then
    die "git merge-file がエラーを返しました: $f"
  fi

  if [[ $rc -eq 0 ]]; then
    mkdir -p "$(dirname "$f")"
    cp "$tout" "$f"
    git add -- "$f"
    cnt_clean=$((cnt_clean + 1))
    return
  fi

  # ---- 競合あり: CONFLICT_RESOLUTION に従って補正 ----
  case "$CONFLICT_RESOLUTION" in
    markers)
      mkdir -p "$(dirname "$f")"
      cp "$tout" "$f"          # マーカー付きで書き出すがステージしない
      conflict_files+=("$f")
      cnt_conflict=$((cnt_conflict + 1))
      ;;
    theirs|ours|union)
      set +e
      git merge-file -p "--$CONFLICT_RESOLUTION" -L ours -L base -L theirs \
        "$to" "$tb" "$tt" >"$tout" 2>/dev/null
      rc=$?
      set -e
      [[ $rc -lt 255 ]] || die "git merge-file (--$CONFLICT_RESOLUTION) がエラー: $f"
      mkdir -p "$(dirname "$f")"
      cp "$tout" "$f"
      git add -- "$f"
      conflict_files+=("$f")
      cnt_autofix=$((cnt_autofix + 1))
      ;;
    *)
      die "未知の CONFLICT_RESOLUTION: $CONFLICT_RESOLUTION"
      ;;
  esac
}

# theirs を無条件採用 (バイナリ / THEIRS_FILES 用)
take_theirs() {
  local f=$1
  mkdir -p "$(dirname "$f")"
  git show "$END:$f" >"$f"
  git add -- "$f"
}

# ----- 変更ファイルを 1 件ずつ処理 (--no-renames で rename は D+A に分解) -----
note "== ファイル単位マージ開始 =="
while IFS= read -r -d '' status && IFS= read -r -d '' path; do
  # CHANGELOG 無視
  if [[ "$IGNORE_CHANGELOG" -eq 1 ]] && is_changelog_file "$path"; then
    cnt_skip=$((cnt_skip + 1))
    continue
  fi

  case "$status" in
    D)
      # upstream で削除されたファイル
      git show "$START:$path" >"$tb" 2>/dev/null || : >"$tb"
      if [[ ! -f "$path" ]]; then
        cnt_skip=$((cnt_skip + 1)); continue           # ローカルにも無い
      fi
      if cmp -s "$path" "$tb"; then
        git rm --quiet -- "$path"                      # ローカル未改変 → 削除
        cnt_delete=$((cnt_delete + 1))
      else
        # ローカル改変あり × upstream 削除 (modify/delete)
        case "$CONFLICT_RESOLUTION" in
          theirs) git rm --quiet -- "$path"; cnt_delete=$((cnt_delete + 1));;
          ours)   cnt_skip=$((cnt_skip + 1));;          # 維持
          *)      conflict_files+=("$path (modify/delete)"); cnt_conflict=$((cnt_conflict + 1));;
        esac
      fi
      ;;
    A|M|T|*)
      if is_theirs_file "$path"; then
        take_theirs "$path"; cnt_theirs=$((cnt_theirs + 1)); continue
      fi
      if [[ "$IGNORE_CHANGELOG" -eq 0 ]] && is_changelog_file "$path"; then
        take_theirs "$path"; cnt_theirs=$((cnt_theirs + 1)); continue
      fi
      if is_binary "$path"; then
        take_theirs "$path"; cnt_binary=$((cnt_binary + 1)); continue   # バイナリは theirs 採用
      fi
      merge_3way "$path"
      ;;
  esac
done < <(git diff --name-status --no-renames -z "$START" "$END")

# ----- サマリ -----
note ""
note "================ マージ結果サマリ ================"
note "  自動マージ成功 (clean)      : $cnt_clean"
note "  競合を自動補正 ($CONFLICT_RESOLUTION) : $cnt_autofix"
note "  競合マーカー残し (要手動)   : $cnt_conflict"
note "  theirs 強制上書き           : $cnt_theirs"
note "  バイナリ theirs 採用        : $cnt_binary"
note "  削除                        : $cnt_delete"
note "  スキップ                    : $cnt_skip"
note "================================================="

if [[ ${#conflict_files[@]} -gt 0 ]]; then
  note ""
  note "▼ 競合が発生したファイル (要レビュー):"
  for f in "${conflict_files[@]}"; do note "    - $f"; done
fi

# ----- コミット or 案内 -----
if git diff --cached --quiet && git diff --quiet; then
  note ""
  note "変更はありませんでした。"
  exit 0
fi

# コミットメッセージ (英語 + 日本語 + トレーラ)
MSG_FILE="$TMPDIR_WORK/commit-msg.txt"
{
  printf 'modify: merge upstream %s (%s..%s)\n' "$UPSTREAM_BRANCH" "$SHORT_START" "$SHORT_END"
  printf '\n'
  printf 'modify: upstream %s を取り込み (%s..%s)\n' "$UPSTREAM_BRANCH" "$SHORT_START" "$SHORT_END"
  printf '\n'
  printf 'Upstream-Merge: %s\n' "$END"
} >"$MSG_FILE"

# markers モードで未解決競合が残っている場合は自動コミットしない
if [[ "$CONFLICT_RESOLUTION" == "markers" && $cnt_conflict -gt 0 ]]; then
  note ""
  note "競合マーカーが残っています。手動で解決し、解決後に以下でコミットしてください:"
  note "  git add -A && git commit -F \"<解決後のメッセージ。末尾に 'Upstream-Merge: $END' を含めること>\""
  note ""
  note "※ 次回以降の START 検出にはコミット本文の 'Upstream-Merge: <sha>' トレーラが必須です。"
  exit 2
fi

if [[ "$AUTO_COMMIT" -eq 1 ]]; then
  git commit --quiet -F "$MSG_FILE"
  note ""
  note "コミットしました: $(git rev-parse --short HEAD)"
else
  note ""
  note "ステージ済みです (AUTO_COMMIT=0)。内容を確認のうえ以下でコミットしてください:"
  note ""
  cat "$MSG_FILE" | sed 's/^/    /'
  note ""
  note "#---------------------------------------------------------"
  note "git commit -F - <<'EOF'"
  cat "$MSG_FILE"
  note "EOF"
  note "#---------------------------------------------------------"
  note ""
  note "※ 'Upstream-Merge: $END' トレーラは次回の START 検出に必須です。削除しないでください。"
fi
