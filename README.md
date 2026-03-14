# claude-type-vi

Fix Vietnamese IME input (Unikey/Telex) for Claude Code CLI on Windows.

## Problem

Claude Code CLI cannot handle Vietnamese input because Unikey sends backspace (`\x08`) + replacement chars embedded in the input string. The input handler doesn't process these embedded BS chars — it inserts the entire string as-is, causing duplicate/garbled characters (e.g., "tôi" → "toôooi").

## How it works

The patch wraps Claude Code's `onInput` handler. When embedded BS chars (`\x08`) are detected in the input string, it processes each character sequentially against the cursor state:
- `\x08` (BS) → `cursor.backspace()` — deletes the previous char
- Any other char → `cursor.insert(char)` — inserts normally

The final cursor state is applied atomically, avoiding stale-state issues from React re-renders.

## Quick Start

```bash
node patch-vietnamese-ime.js
```

Restart Claude Code after patching.

## Commands

| Command | Description |
|---------|-------------|
| `node patch-vietnamese-ime.js` | Patch cli.js (auto-finds, auto-backups) |
| `node patch-vietnamese-ime.js --silent` | Patch without output if already patched |
| `node patch-vietnamese-ime.js --status` | Check current patch status |
| `node patch-vietnamese-ime.js --restore` | Restore original cli.js from backup |
| `node patch-vietnamese-ime.js -f <path>` | Specify cli.js path manually |

## Restore

If something goes wrong after patching:

```bash
node patch-vietnamese-ime.js --restore
```

Then restart Claude Code.

Backup file location:
```
%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\cli.js.bak
```

## Auto-patch (optional)

Add to `~/.claude/settings.json` under `hooks.SessionStart`:

```json
{
  "type": "command",
  "command": "node \"C:/w/claude-type-vi/patch-vietnamese-ime.js\" --silent"
}
```

Re-run is safe (idempotent). Re-patches automatically after Claude Code updates.

## npm scripts

```bash
npm run patch        # patch
npm run patch:silent # patch (silent)
npm run status       # check status
npm run restore      # restore original
```
