# Changelog

## [2.0.0] - 2026-04-05

### Added
- **Native binary support** — patches Bun-embedded binaries (WinGet, macOS, Linux direct download)
- Cross-platform path detection: Windows, macOS, Linux, Bun global installs
- `--dry-run` flag — test patch without saving
- `-o / --output` flag — write patched content to a new file
- macOS re-signing via `codesign` after binary patch
- vitest test suite — validates JS and binary patching across all versions from v2.0.64

### Changed
- IME detection: `\x08` (BS) → `\x7f` (DEL) — aligns with Claude Code's existing detection point
- Patch strategy: function-wrap → inline injection at `\x7f` handling site (more robust across versions)
- `findCliJs()` → `findClaudePath()` — now finds both `cli.js` and native binary
- PATCH_MARKER updated to `/* _vn_ime_fix_ */`
- Version bumped to 2.0.0

### Removed
- Windows-only restriction — now works on macOS and Linux

## [1.1.0] - 2025-05-01

### Added
- Auto-install SessionStart hook on first patch
- `--silent` flag for hook-based auto-patching

## [1.0.0] - 2025-04-01

### Added
- Initial release
- Patches npm-installed `cli.js` on Windows
- `--status`, `--restore`, `-f` flags
- Backup and restore support
- npx support
