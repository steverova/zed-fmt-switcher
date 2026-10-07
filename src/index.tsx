#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app";
import { resolveTarget } from "./zed";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
	console.log(`zed-formatter-tui

Configure which formatter Zed uses: Biome or Oxc (oxfmt/oxlint).

Usage:
  zed-fmt                   Edit the global Zed settings.json
  zed-fmt --local           Edit ./.zed/settings.json
  zed-fmt --path <file>     Edit an explicit settings.json

The TUI writes per-language Zed settings (never a global formatter),
optionally a Format Buffer keybinding, installs the formatter packages
and can add npm scripts. Every write keeps a timestamped .bak backup.
`);
	process.exit(0);
}

const target = resolveTarget(args);
const renderer = await createCliRenderer({ exitOnCtrlC: true });
createRoot(renderer).render(<App target={target} />);
