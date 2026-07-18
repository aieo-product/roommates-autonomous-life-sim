#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
archive_path="${1:-$project_dir/.sites/roommates-sites.tgz}"
build_dir="$project_dir/dist"
hosting_file="$project_dir/.openai/hosting.json"

test -f "$build_dir/server/index.js" || {
  echo "Missing dist/server/index.js. Run npm run build:sites first." >&2
  exit 2
}
test -f "$build_dir/client/index.html" || {
  echo "Missing dist/client/index.html. Run npm run build:sites first." >&2
  exit 2
}
test -f "$hosting_file" || {
  echo "Missing .openai/hosting.json." >&2
  exit 2
}

stage_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$stage_dir"
}
trap cleanup EXIT

mkdir -p "$stage_dir/dist/.openai"
cp -R "$build_dir"/. "$stage_dir/dist"/
cp "$hosting_file" "$stage_dir/dist/.openai/hosting.json"

if test -d "$project_dir/drizzle"; then
  mkdir -p "$stage_dir/dist/.openai/drizzle"
  cp -R "$project_dir/drizzle"/. "$stage_dir/dist/.openai/drizzle"/
fi

mkdir -p "$(dirname "$archive_path")"
tar -C "$stage_dir" -czf "$archive_path" dist

archive_entries="$(tar -tzf "$archive_path")"
grep -qx 'dist/server/index.js' <<<"$archive_entries"
grep -qx 'dist/client/index.html' <<<"$archive_entries"
grep -qx 'dist/.openai/hosting.json' <<<"$archive_entries"

printf '%s\n' "$archive_path"
