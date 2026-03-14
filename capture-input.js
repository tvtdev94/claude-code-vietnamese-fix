#!/usr/bin/env node
/**
 * Capture raw stdin bytes to debug Vietnamese IME input.
 * Run: node capture-input.js
 * Type Vietnamese text, press Ctrl+C to stop.
 * Shows hex dump of every byte received.
 */
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding(null);

console.log("Type Vietnamese text (Ctrl+C to quit):\n");

process.stdin.on("data", (buf) => {
  const hex = [...buf].map(b => b.toString(16).padStart(2, "0")).join(" ");
  const chars = [...buf].map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : b === 0x7f ? "<DEL>" : b === 0x08 ? "<BS>" : `\\x${b.toString(16).padStart(2, "0")}`).join("");
  const utf8 = buf.toString("utf8");
  console.log(`HEX: ${hex}`);
  console.log(`RAW: ${chars}`);
  console.log(`UTF: ${utf8}`);
  console.log("---");
});

process.on("SIGINT", () => { console.log("\nDone."); process.exit(); });
