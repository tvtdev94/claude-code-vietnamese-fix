# claude-code-vietnamese-fix

> Fix Vietnamese input (Telex/VNI) for Claude Code CLI on Windows — one command, zero config.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-blue)]()
[![Claude Code](https://img.shields.io/badge/Claude_Code-v2.x-blueviolet)]()

## The Problem

Vietnamese users **cannot type** in Claude Code CLI. Characters get duplicated or garbled.

**Expected:** `tôi` → **Actual:** `toôooi`

Unikey sends backspace (`\x08`) + replacement chars embedded in the input string. Claude Code's input handler doesn't process these embedded BS chars — it inserts the entire string as-is.

## Quick Start

### Option 1: npx (no install needed)

```bash
npx claude-code-vietnamese-fix
```

### Option 2: Install globally

```bash
npm install -g claude-code-vietnamese-fix
claude-code-vietnamese-fix
```

### Option 3: Clone and run

```bash
git clone https://github.com/tvtdev94/claude-code-vietnamese-fix.git
cd claude-code-vietnamese-fix
node patch-vietnamese-ime.js
```

Then **restart Claude Code**.

## How it works

The patch wraps Claude Code's `onInput` handler. When embedded BS chars (`\x08`) are detected, it processes each character sequentially against the cursor state:
- `\x08` (BS) → `cursor.backspace()` — deletes the previous char
- Any other char → `cursor.insert(char)` — inserts normally

The final cursor state is applied atomically.

## Commands

| Command | Description |
|---------|-------------|
| `npx claude-code-vietnamese-fix` | Patch cli.js (auto-finds, auto-backups) |
| `npx claude-code-vietnamese-fix --status` | Check current patch status |
| `npx claude-code-vietnamese-fix --restore` | Restore original cli.js from backup |
| `npx claude-code-vietnamese-fix --silent` | Patch without output if already patched |

## Auto-patch After Updates

Claude Code updates will overwrite the patch. Add a SessionStart hook to auto-patch:

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "npx claude-code-vietnamese-fix --silent"
          }
        ]
      }
    ]
  }
}
```

The script is **idempotent** — safe to run on every session start.

## Restore

If anything goes wrong:

```bash
npx claude-code-vietnamese-fix --restore
```

Backup location: `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\cli.js.bak`

## Compatibility

| Item | Status |
|------|--------|
| Windows 10/11 | ✅ |
| Unikey (Telex) | ✅ Tested |
| Unikey (VNI, VIQR) | ⚠️ Untested (should work) |
| OpenKey / EVKey | ⚠️ Untested (should work) |
| npm global install | ✅ |
| NVM for Windows | ✅ |
| Claude Code v2.x | ✅ |

## Debug

Capture raw input bytes to diagnose IME behavior:

```bash
node capture-input.js
# Type Vietnamese text, press Ctrl+C to stop
```

## Related

- [Issue #3961](https://github.com/anthropics/claude-code/issues/3961) — Unicode Input Handling Fails for Vietnamese Characters
- [Issue #7989](https://github.com/anthropics/claude-code/issues/7989) — Error typing Vietnamese Telex
- [Issue #10429](https://github.com/anthropics/claude-code/issues/10429) — Vietnamese Input Not Working

## License

[MIT](LICENSE)
