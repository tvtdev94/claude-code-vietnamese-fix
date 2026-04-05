#!/usr/bin/env node

/**
 * Patch Claude Code CLI to fix Vietnamese IME input on Windows/macOS/Linux.
 * Supports both npm-installed (cli.js) and native binary versions.
 *
 * Root cause: Vietnamese IME (Unikey, OpenKey, EVKey) embeds \x7f (DEL) chars
 * in input strings. Claude Code's input handler inserts the entire string as-is,
 * causing duplicate/garbled characters.
 *
 * Fix: Intercept the existing \x7f detection point in Claude Code's input handler.
 * Strip \x7f chars, insert remaining chars char-by-char into cursor state, then
 * apply the final state atomically.
 *
 * Usage:
 *   node patch-vietnamese-ime.js            # patch (auto-find cli.js or binary)
 *   node patch-vietnamese-ime.js --silent   # patch, no output if already patched
 *   node patch-vietnamese-ime.js --restore  # restore from backup
 *   node patch-vietnamese-ime.js --status   # check patch status
 *   node patch-vietnamese-ime.js --dry-run  # test patch without saving
 *   node patch-vietnamese-ime.js -f <path>  # specify target file manually
 *   node patch-vietnamese-ime.js -o <path>  # write patched output to new file
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const os = require("os");

const PATCH_MARKER = "/* _vn_ime_fix_ */";

// --- CLI argument parsing ---

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    silent: false,
    restore: false,
    status: false,
    dryRun: false,
    file: null,
    output: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--silent") opts.silent = true;
    else if (args[i] === "--restore") opts.restore = true;
    else if (args[i] === "--status") opts.status = true;
    else if (args[i] === "--dry-run" || args[i] === "-d") opts.dryRun = true;
    else if (args[i] === "-f" || args[i] === "--file") opts.file = args[++i];
    else if (args[i] === "-o" || args[i] === "--output") opts.output = args[++i];
    else if (args[i] === "-h" || args[i] === "--help") {
      console.log(`
Usage:
  claude-code-vietnamese-fix [options]

Options:
  -f, --file <path>   Path to cli.js or claude binary
  -d, --dry-run       Test without overwriting the file
  -o, --output <path> Write patched content to a new file
  --silent            No output if already patched
  --restore           Restore original from backup
  --status            Show patch/backup/hook status
  -h, --help          Show this help message
`);
      process.exit(0);
    }
  }
  return opts;
}

// --- Locate cli.js or binary ---

function findClaudePath() {
  const isWin = os.platform() === "win32";

  const run = (cmd) => {
    try {
      return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
        .toString().split(/\r?\n/)[0].trim();
    } catch { return ""; }
  };
  const exists = (p) => p && fs.existsSync(p);

  // 1) which / where
  for (const cmd of [isWin ? "where claude" : "which claude"]) {
    const p = run(cmd);
    if (exists(p)) {
      if (!isWin) {
        try { return execSync(`realpath "${p}"`).toString().trim(); } catch {}
      }
      return p;
    }
  }

  // 2) Bun global paths
  const bunInstall =
    process.env.BUN_INSTALL ||
    (isWin
      ? path.join(process.env.USERPROFILE || "", ".bun")
      : path.join(process.env.HOME || "", ".bun"));

  const bunPaths = [
    path.join(bunInstall, "bin", isWin ? "claude.exe" : "claude"),
    path.join(bunInstall, "bin", isWin ? "claude.cmd" : "claude"),
    path.join(bunInstall, "install", "global", "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
  ];
  for (const p of bunPaths) {
    if (exists(p)) return p;
  }

  // 3) npm global
  try {
    const npmRoot = run("npm root -g");
    const p = path.join(npmRoot, "@anthropic-ai", "claude-code", "cli.js");
    if (exists(p)) return p;
  } catch {}

  // 4) Windows fallbacks
  if (isWin) {
    const paths = [
      path.join(process.env.APPDATA || "", "npm", "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
      path.join(process.env.LOCALAPPDATA || "", "npm", "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
    ];
    if (process.env.NVM_HOME) {
      try {
        for (const dir of fs.readdirSync(process.env.NVM_HOME)) {
          paths.push(path.join(process.env.NVM_HOME, dir, "node_modules", "@anthropic-ai", "claude-code", "cli.js"));
        }
      } catch {}
    }
    for (const p of paths) { if (exists(p)) return p; }
  }

  return null;
}

// --- Patch logic for cli.js (npm install) ---

// Pattern matching the \x7f detection + cursor state application in Claude Code:
//   l.match(/\x7f/g)...if(!S.equals(CA)){if(S.text!==CA.text)Q(CA.text);T(CA.offset)}ct1(),lt1();return
const PATCH_RE = /(?<m0>(?<var0>[\w$]+)\.match\(\/\\x7f\/g\).*?)(?<m1>if\(!(?<var1>[\w$]+)\.equals\((?<var2>[\w$]+)\)\){if\(\k<var1>\.text!==\k<var2>\.text\)(?<func1>[\w$]+)\(\k<var2>\.text\);(?<func2>[\w$]+)\(\k<var2>\.offset\)})(?<m2>(?:[\w$]+\(\),?\s*)*;?\s*return)/g;

function buildPatch(m0, m1, var0, var2, m2) {
  return `
${PATCH_MARKER}
${m0}
let _vn = ${var0}.replace(/\\x7f/g, "");
if (_vn.length > 0) {
    for (const _c of _vn) ${var2} = ${var2}.insert(_c);
    ${m1}
}
${m2}
`;
}

function patchContentJs(fileContent) {
  if (fileContent.includes(PATCH_MARKER)) {
    return { success: true, alreadyPatched: true };
  }

  const newContent = fileContent.replace(PATCH_RE, (...args) => {
    const { m0, m1, var0, var2, m2 } = args[args.length - 1];
    return buildPatch(m0, m1, var0, var2, m2);
  });

  if (newContent.length === fileContent.length) {
    return { success: false, message: "Patch failed: no match found in cli.js" };
  }

  return { success: true, alreadyPatched: false, content: newContent };
}

// --- Patch logic for native binary (Bun-embedded JS) ---

function patchContentBinary(binaryContent) {
  if (binaryContent.includes(PATCH_MARKER)) {
    return { success: true, alreadyPatched: true };
  }

  const matches = [];
  const newContent = binaryContent.replace(PATCH_RE, (...args) => {
    const groups = args[args.length - 1];
    const offset = args[args.length - 3];
    const { m0, m1, var0, var2, m2 } = groups;

    // Compact version (strip leading whitespace) to minimize size diff
    const patched = buildPatch(m0, m1, var0, var2, m2).replace(/^\s+/gm, "");
    matches.push({ diff: patched.length - args[0].length, index: offset });
    return patched;
  });

  if (matches.length === 0) {
    return { success: false, message: "Patch failed: no match found in binary" };
  }

  // Bun binary embeds JS sections prefixed with \x00// @bun.
  // We must compensate for the added bytes by trimming the pragma comment.
  const pragma = "// @bun ";
  const pragmaLength = pragma.length;
  let result = newContent;

  for (let i = 0; i < matches.length; i++) {
    const matchIdx = matches[i].index;
    const prevIdx = i === 0 ? 0 : matches[i - 1].index;

    for (let j = matchIdx - 1; j >= prevIdx; j--) {
      if (result[j] === "\x00") {
        if (result.slice(j + 1, j + 1 + pragmaLength) === pragma) {
          // Find the first newline+// after the pragma
          for (let k = j + 1 + pragmaLength; k < matchIdx; k++) {
            if (result[k] === "\n" && result[k + 1] === "/" && result[k + 2] === "/") {
              const diff = matches[i].diff;
              const sliceStart = k + 3;
              result = result.slice(0, sliceStart) + result.slice(sliceStart + diff);
              matches[i].found = true;
              break;
            }
          }
          if (matches[i].found) break;
        }
      }
    }
    if (!matches[i].found) break;
  }

  if (matches.every((m) => !m.found)) {
    return { success: false, message: "Patch failed: could not adjust binary pragma" };
  }

  return { success: true, alreadyPatched: false, content: result };
}

// --- Auto-install SessionStart hook ---

const HOOK_COMMAND = "npx claude-code-vietnamese-fix --silent";

function installHook(silent) {
  const homeDir = process.env.USERPROFILE || process.env.HOME || "";
  const settingsPath = path.join(homeDir, ".claude", "settings.json");

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch { return; }
  }

  // Check if hook already exists
  const hooks = settings.hooks?.SessionStart || [];
  for (const entry of hooks) {
    for (const h of (entry.hooks || [])) {
      if (h.command && h.command.includes("claude-code-vietnamese-fix")) return;
    }
  }

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];

  const matcher = "startup|resume|clear|compact";
  let target = settings.hooks.SessionStart.find((e) => e.matcher === matcher);
  if (!target) {
    target = { matcher, hooks: [] };
    settings.hooks.SessionStart.push(target);
  }
  target.hooks.push({ type: "command", command: HOOK_COMMAND });

  const claudeDir = path.join(homeDir, ".claude");
  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  if (!silent) console.log("Hook installed: auto-patch on SessionStart");
}

// --- Backup & restore ---

function backupPath(targetPath) { return targetPath + ".bak"; }

function createBackup(targetPath) {
  const bak = backupPath(targetPath);
  fs.copyFileSync(targetPath, bak);
  return bak;
}

function restoreBackup(targetPath) {
  const bak = backupPath(targetPath);
  if (!fs.existsSync(bak)) return { success: false, message: "No backup found at " + bak };
  fs.copyFileSync(bak, targetPath);
  return { success: true };
}

// --- Main ---

function main() {
  const opts = parseArgs();
  const targetPath = opts.file || findClaudePath();

  if (!targetPath || !fs.existsSync(targetPath)) {
    console.error("Error: Could not find Claude Code (cli.js or binary).");
    if (targetPath) console.error("Tried: " + targetPath);
    process.exit(1);
  }

  console.log("Target: " + targetPath);

  if (opts.status) {
    const content = fs.readFileSync(targetPath, "latin1");
    const patched = content.includes(PATCH_MARKER);
    console.log("Status: " + (patched ? "PATCHED" : "NOT PATCHED"));
    console.log("Backup: " + (fs.existsSync(backupPath(targetPath)) ? "EXISTS" : "NONE"));
    const homeDir = process.env.USERPROFILE || process.env.HOME || "";
    const sp = path.join(homeDir, ".claude", "settings.json");
    let hookInstalled = false;
    try {
      const s = JSON.parse(fs.readFileSync(sp, "utf8"));
      hookInstalled = JSON.stringify(s).includes("claude-code-vietnamese-fix");
    } catch {}
    console.log("Hook: " + (hookInstalled ? "INSTALLED" : "NOT INSTALLED"));
    process.exit(0);
  }

  if (opts.restore) {
    const result = restoreBackup(targetPath);
    if (!result.success) { console.error(result.message); process.exit(1); }
    console.log("Restored from backup: " + targetPath);
    process.exit(0);
  }

  // Restore from backup first if exists (ensure clean base for re-patching)
  // Skip restore for --dry-run and --output to avoid touching the live file
  if (!opts.dryRun && !opts.output && fs.existsSync(backupPath(targetPath))) {
    fs.copyFileSync(backupPath(targetPath), targetPath);
  }

  const content = fs.readFileSync(targetPath, "latin1");
  const isJs = targetPath.endsWith(".js");
  const result = isJs ? patchContentJs(content) : patchContentBinary(content);

  if (result.alreadyPatched) {
    if (!opts.silent) console.log("Already patched — skipping");
    process.exit(0);
  }

  if (!result.success) {
    console.error(result.message);
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log("Dry run: patch applied successfully (not saved).");
    process.exit(0);
  }

  const finalPath = opts.output || targetPath;

  // Backup original before writing (skip if writing to a different output path)
  if (!opts.output) {
    createBackup(targetPath);
    if (!opts.silent) console.log("Backup: " + backupPath(targetPath));
  }

  fs.writeFileSync(finalPath, result.content, "latin1");
  console.log("Patched: " + finalPath);

  // Re-sign binary on macOS (required to pass Gatekeeper)
  if (os.platform() === "darwin" && !isJs) {
    try {
      execSync(`codesign --sign - --force --preserve-metadata=entitlements,requirements,flags "${finalPath}"`, { stdio: "inherit" });
      console.log("Re-signed binary successfully.");
    } catch (e) {
      console.error("Warning: Re-sign failed:", e.message);
      console.error(`Run manually: codesign --sign - --force --preserve-metadata=entitlements,requirements,flags "${finalPath}"`);
    }
  }

  // Auto-install SessionStart hook (only for npm cli.js, not binary)
  if (isJs && !opts.output) {
    installHook(opts.silent);
  }
}

if (require.main === module) {
  main();
}

// Export for testing
module.exports = { PATCH_MARKER, patchContentJs, patchContentBinary };
