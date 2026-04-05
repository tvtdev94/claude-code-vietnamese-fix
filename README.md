# claude-code-vietnamese-fix

> Fix Vietnamese input (Telex/VNI) for Claude Code CLI — supports npm and native binary (WinGet/direct download).

[![npm version](https://img.shields.io/npm/v/claude-code-vietnamese-fix)](https://www.npmjs.com/package/claude-code-vietnamese-fix)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)]()
[![Claude Code](https://img.shields.io/badge/Claude_Code-v2.x-blueviolet)]()

## The Problem

Vietnamese users **cannot type** in Claude Code CLI. Characters get duplicated or garbled.

**Expected:** `tôi` → **Actual:** `toôooi`

Vietnamese IME (Unikey, OpenKey, EVKey) embeds `\x7f` (DEL) chars in input strings. Claude Code's input handler inserts the entire string as-is, causing duplicate/garbled output.

## Quick Start

```bash
npx claude-code-vietnamese-fix
```

Then **restart Claude Code**.

### Other install options

```bash
# Install globally
npm install -g claude-code-vietnamese-fix
claude-code-vietnamese-fix

# Clone and run
git clone https://github.com/tvtdev94/claude-code-vietnamese-fix.git
cd claude-code-vietnamese-fix
node patch-vietnamese-ime.js
```

## How it works

The patch intercepts the existing `\x7f` detection point in Claude Code's input handler. It strips `\x7f` chars, inserts remaining chars one-by-one into the cursor state, then applies the final state atomically.

Works for both:
- **npm install** — patches `cli.js` directly
- **Native binary** (WinGet, direct download) — patches the embedded JS inside the Bun binary

## Commands

| Command | Description |
|---------|-------------|
| `npx claude-code-vietnamese-fix` | Auto-detect and patch (creates backup) |
| `npx claude-code-vietnamese-fix --status` | Show patch/backup/hook status |
| `npx claude-code-vietnamese-fix --restore` | Restore original from backup |
| `npx claude-code-vietnamese-fix --silent` | Patch silently (no output if already patched) |
| `npx claude-code-vietnamese-fix --dry-run` | Test patch without saving |
| `npx claude-code-vietnamese-fix -f <path>` | Specify target file manually |
| `npx claude-code-vietnamese-fix -o <path>` | Write patched output to a new file |

## Auto-patch After Updates

Claude Code updates overwrite the patch. Add a SessionStart hook to auto-patch on every session:

`~/.claude/settings.json`:

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

```bash
npx claude-code-vietnamese-fix --restore
```

## Compatibility

| Item | Status |
|------|--------|
| Windows 10/11 | ✅ |
| macOS | ✅ |
| Linux | ✅ |
| Unikey (Telex/VNI/VIQR) | ✅ |
| OpenKey / EVKey | ✅ |
| npm global install | ✅ |
| NVM for Windows | ✅ |
| Bun global install | ✅ |
| **Native binary (WinGet)** | ✅ |
| **Native binary (macOS/Linux)** | ✅ |
| Claude Code v2.x | ✅ |

## Related

- [Issue #3961](https://github.com/anthropics/claude-code/issues/3961) — Unicode Input Handling Fails for Vietnamese Characters
- [Issue #7989](https://github.com/anthropics/claude-code/issues/7989) — Error typing Vietnamese Telex
- [Issue #10429](https://github.com/anthropics/claude-code/issues/10429) — Vietnamese Input Not Working

## License

[MIT](LICENSE)
