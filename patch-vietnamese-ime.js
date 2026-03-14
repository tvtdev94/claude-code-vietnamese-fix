#!/usr/bin/env node

/**
 * Patch Claude Code CLI to fix Vietnamese IME input (Unikey/Telex) on Windows.
 *
 * Root cause: Unikey sends backspace chars (\x08) embedded in the input string
 * along with replacement chars. Claude Code's input handler doesn't process
 * these embedded BS chars — it inserts the entire string as-is, causing
 * duplicate/garbled characters.
 *
 * Fix: Wrap the input handler to detect embedded \x08 (BS) in the input
 * string. When found, process each char sequentially: regular chars get
 * inserted, \x08 triggers a cursor.backspace(). The result is applied
 * atomically to avoid stale-state issues.
 *
 * Usage:
 *   node patch-vietnamese-ime.js            # patch (auto-find cli.js)
 *   node patch-vietnamese-ime.js --silent   # patch, no output if already patched
 *   node patch-vietnamese-ime.js --restore  # restore from backup
 *   node patch-vietnamese-ime.js --status   # check patch status
 *   node patch-vietnamese-ime.js -f <path>  # specify cli.js path manually
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PATCH_MARKER = "/* _vietnamese_ime_fix_v4_ */";

// --- CLI argument parsing ---

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { silent: false, restore: false, status: false, file: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--silent") opts.silent = true;
    else if (args[i] === "--restore") opts.restore = true;
    else if (args[i] === "--status") opts.status = true;
    else if (args[i] === "-f" || args[i] === "--file") opts.file = args[++i];
  }
  return opts;
}

// --- Locate cli.js on Windows ---

function findCliJs() {
  const run = (cmd) => {
    try {
      return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
        .toString().split(/\r?\n/)[0].trim();
    } catch { return ""; }
  };
  const exists = (p) => p && fs.existsSync(p);

  // npm global
  try {
    const npmRoot = run("npm root -g");
    const p = path.join(npmRoot, "@anthropic-ai", "claude-code", "cli.js");
    if (exists(p)) return p;
  } catch {}

  // Common Windows paths
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
  return null;
}

// --- Patch logic ---

function patchContent(content) {
  if (content.includes(PATCH_MARKER)) {
    return { success: true, alreadyPatched: true };
  }

  let patched = content;

  // Find the input handler function:
  //   function n(t,r){let l=G?G(t,r):t;if(l===""&&t!=="")return;...}
  // This is the onInput handler for Claude Code's text input component.
  const outerRe = /function\s+([\w$]+)\(([\w$]+),([\w$]+)\)\{let\s+([\w$]+)=([\w$]+)\?\5\(\2,\3\):\2;if\(\4===""&&\2!==""\)return;/;
  const outerMatch = patched.match(outerRe);

  if (!outerMatch) {
    return { success: false, message: "Patch failed: input handler function not found" };
  }

  const [fullMatch, fn, p1, p2, p3, p4] = outerMatch;

  // The wrapper intercepts input strings containing \x08 (BS) chars.
  // When detected, it processes each char against the cursor state `h`:
  //   - \x08: cursor.backspace()
  //   - other: cursor.insert(char)
  // Then applies the final state atomically.
  //
  // For strings without \x08, passes through to original handler unchanged.
  //
  // Variables from the enclosing closure (captured by the original function):
  //   h = cursor state, q = setText, L = setOffset
  //   These are referenced via the original function's scope.
  const wrapper =
    `${PATCH_MARKER}` +
    `function ${fn}(${p1},${p2}){` +
      // Check for embedded BS chars (0x08) — Vietnamese IME signature
      `if(!${p2}.backspace&&!${p2}.delete&&${p1}.includes("\\b")){` +
        // Process char-by-char against cursor state h (from enclosing closure)
        `var _c=h;` +
        `for(var _i=0;_i<${p1}.length;_i++){` +
          `var _ch=${p1}[_i];` +
          `if(_ch==="\\b"){` +
            `_c=_c.backspace()` +
          `}else{` +
            `_c=_c.insert(_ch)` +
          `}` +
        `}` +
        // Apply final state atomically
        `if(!h.equals(_c)){` +
          `if(h.text!==_c.text)q(_c.text);` +
          `L(_c.offset)` +
        `}` +
        `return` +
      `}` +
      // No embedded BS: pass through to original handler
      `return _imeR(${p1},${p2})}` +
    // Original function renamed to _imeR
    `function _imeR(${p1},${p2}){` +
      `let ${p3}=${p4}?${p4}(${p1},${p2}):${p1};` +
      `if(${p3}===""&&${p1}!=="")return;`;

  patched = patched.replace(fullMatch, wrapper);

  if (patched.includes(fullMatch) && !patched.includes("_imeR")) {
    return { success: false, message: "Patch: replacement failed" };
  }

  return { success: true, alreadyPatched: false, content: patched };
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

  // Add hook to existing SessionStart entry or create new one
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];

  const matcher = "startup|resume|clear|compact";
  let target = settings.hooks.SessionStart.find((e) => e.matcher === matcher);
  if (!target) {
    target = { matcher, hooks: [] };
    settings.hooks.SessionStart.push(target);
  }
  target.hooks.push({ type: "command", command: HOOK_COMMAND });

  // Ensure .claude dir exists
  const claudeDir = path.join(homeDir, ".claude");
  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  if (!silent) console.log("Hook installed: auto-patch on SessionStart");
}

// --- Backup & restore ---

function backupPath(cliPath) { return cliPath + ".bak"; }

function createBackup(cliPath) {
  const bak = backupPath(cliPath);
  fs.copyFileSync(cliPath, bak);
  return bak;
}

function restoreBackup(cliPath) {
  const bak = backupPath(cliPath);
  if (!fs.existsSync(bak)) return { success: false, message: "No backup found at " + bak };
  fs.copyFileSync(bak, cliPath);
  return { success: true };
}

// --- Main ---

function main() {
  const opts = parseArgs();
  const cliPath = opts.file || findCliJs();

  if (!cliPath || !fs.existsSync(cliPath)) {
    console.error("Error: Could not find Claude Code cli.js");
    if (cliPath) console.error("Tried: " + cliPath);
    process.exit(1);
  }

  if (opts.status) {
    const content = fs.readFileSync(cliPath, "latin1");
    const patched = content.includes(PATCH_MARKER);
    console.log(`Target: ${cliPath}`);
    console.log(`Status: ${patched ? "PATCHED" : "NOT PATCHED"}`);
    console.log(`Backup: ${fs.existsSync(backupPath(cliPath)) ? "EXISTS" : "NONE"}`);
    const homeDir = process.env.USERPROFILE || process.env.HOME || "";
    const sp = path.join(homeDir, ".claude", "settings.json");
    let hookInstalled = false;
    try {
      const s = JSON.parse(fs.readFileSync(sp, "utf8"));
      hookInstalled = JSON.stringify(s).includes("claude-code-vietnamese-fix");
    } catch {}
    console.log(`Hook: ${hookInstalled ? "INSTALLED" : "NOT INSTALLED"}`);
    process.exit(0);
  }

  if (opts.restore) {
    const result = restoreBackup(cliPath);
    if (!result.success) { console.error(result.message); process.exit(1); }
    console.log("Restored cli.js from backup");
    process.exit(0);
  }

  // Restore from backup first if exists (ensure clean base for patching)
  if (fs.existsSync(backupPath(cliPath))) {
    fs.copyFileSync(backupPath(cliPath), cliPath);
  }

  const content = fs.readFileSync(cliPath, "latin1");
  const result = patchContent(content);

  if (result.alreadyPatched) {
    if (!opts.silent) console.log("Already patched — skipping");
    process.exit(0);
  }

  if (!result.success) {
    console.error(result.message);
    process.exit(1);
  }

  // Backup original before writing patch
  createBackup(cliPath);
  if (!opts.silent) console.log("Backup: " + backupPath(cliPath));

  fs.writeFileSync(cliPath, result.content, "latin1");
  console.log("Patched: " + cliPath);

  // Auto-install SessionStart hook for auto-patching after updates
  installHook(opts.silent);
}

main();
