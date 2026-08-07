#!/bin/bash
# Migrate sessions from Flutter (CatBoard) format to Quinki format
# Source: ~/.pi/agent/ (Flutter data directory)
# Target: ~/.quinki/ (Quinki data directory)
#
# Usage: bash scripts/migrate-flutter-sessions.sh [source_dir] [target_dir]
# Defaults: source=$HOME/.pi/agent, target=$HOME/.quinki

set -e

SRC_DIR="${1:-$HOME/.pi/agent}"
DST_DIR="${2:-$HOME/.quinki}"

export SRC_DIR DST_DIR

python3 << 'PYEOF'
import json, os, shutil

src_dir = os.environ['SRC_DIR']
dst_dir = os.environ['DST_DIR']

src_sessions_file = os.path.join(src_dir, 'dashboard-sessions.json')
dst_sessions_file = os.path.join(dst_dir, 'quinki-sessions.json')
src_session_base = os.path.join(src_dir, 'sessions', 'dashboard')
dst_session_base = os.path.join(dst_dir, 'sessions', 'quinki')

print(f"=== Quinki Session Migration ===")
print(f"Source: {src_dir}")
print(f"Target: {dst_dir}")
print()

if not os.path.exists(src_sessions_file):
    print(f"ERROR: Source sessions metadata not found: {src_sessions_file}")
    exit(1)

with open(src_sessions_file) as f:
    flutter_sessions = json.load(f)

print(f"Found {len(flutter_sessions)} Flutter sessions")

existing = []
if os.path.exists(dst_sessions_file):
    with open(dst_sessions_file) as f:
        existing = json.load(f)
    print(f"Existing Quinki sessions: {len(existing)}")

existing_ids = {s.get('id') for s in existing}
migrated = list(existing)
migrated_count = 0
skipped_count = 0

for fs in flutter_sessions:
    key = fs.get('key', '')
    if not key or key in existing_ids or key.startswith('__delegate_') or key == '__dashboard_expert__':
        print(f"  SKIP: {key or '(no key)'}")
        skipped_count += 1
        continue

    quinki_session = {
        'id': key,
        'title': fs.get('label', 'Chat'),
        'createdAt': fs.get('createdAt', 0),
        'lastActivity': fs.get('lastActivity', 0),
        'order': fs.get('order', 0),
        'model': fs.get('model', ''),
        'thinkingLevel': fs.get('thinkingLevel', 'off'),
        'mode': fs.get('mode', 'plan'),
        'agentId': fs.get('agentId', ''),
        'workingDir': fs.get('workingDir', ''),
        'compactionAuto': fs.get('compactionAuto', True),
        'compactionThreshold': fs.get('compactionThreshold', 80),
    }

    src_session_dir = os.path.join(src_session_base, key)
    dst_session_dir = os.path.join(dst_session_base, key)

    if os.path.isdir(src_session_dir):
        os.makedirs(dst_session_dir, exist_ok=True)
        jsonl_files = [f for f in os.listdir(src_session_dir) if f.endswith('.jsonl')]

        if not jsonl_files:
            print(f"  SKIP (no .jsonl): {key}")
            skipped_count += 1
            continue

        for jf in jsonl_files:
            shutil.copy2(
                os.path.join(src_session_dir, jf),
                os.path.join(dst_session_dir, jf)
            )

        migrated.append(quinki_session)
        migrated_count += 1
        print(f"  MIGRATED: {key} ({len(jsonl_files)} .jsonl) — {quinki_session['title']}")
    else:
        print(f"  SKIP (no dir): {key}")
        skipped_count += 1

with open(dst_sessions_file, 'w') as f:
    json.dump(migrated, f, indent=2)

print(f"\n=== Done ===")
print(f"  Migrated: {migrated_count}")
print(f"  Skipped:  {skipped_count}")
print(f"  Total Quinki sessions: {len(migrated)}")
PYEOF