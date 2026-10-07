import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { prefsPath } from "./prefs";
import {
	buildKeymap,
	buildSettings,
	defaultFormatBufferKey,
	detectFormatBufferKey,
	detectFormatter,
	extensionsDir,
	globalSettingsPath,
	hasJsoncErrors,
	latestBackup,
	resolveTarget,
	restoreLatestBackup,
	writeSettings,
} from "./zed";

describe("detectFormatter", () => {
	test("detects biome from a legacy global formatter", () => {
		expect(
			detectFormatter(
				'{ "formatter": { "language_server": { "name": "biome" } } }',
			),
		).toBe("biome");
	});

	test("detects oxc from a language formatter", () => {
		const content =
			'{ "languages": { "JavaScript": { "formatter": [{ "language_server": { "name": "oxfmt" } }] } } }';
		expect(detectFormatter(content)).toBe("oxc");
	});

	test("returns none for empty content", () => {
		expect(detectFormatter("")).toBe("none");
	});

	test("returns none when nothing is configured", () => {
		expect(detectFormatter('{ "theme": "One Dark" }')).toBe("none");
	});
});

describe("buildSettings", () => {
	test("writes per-language config only (no global formatter, no prettier)", () => {
		const { content } = buildSettings("", "biome", { formatOnSave: "on" });
		const parsed = JSON.parse(content);

		expect(detectFormatter(content)).toBe("biome");
		expect(parsed.formatter).toBeUndefined();
		expect(content).not.toContain("prettier");
		expect(parsed.languages.TypeScript.formatter[0].language_server.name).toBe(
			"biome",
		);
		expect(parsed.languages.TypeScript.format_on_save).toBe("on");
		expect(
			parsed.languages.TypeScript.code_actions_on_format["source.fixAll.biome"],
		).toBe(true);
		expect(
			parsed.languages.TypeScript.code_actions_on_format[
				"source.organizeImports.biome"
			],
		).toBe(true);
	});

	test("switches biome → oxc, preserves comments and drops the global formatter", () => {
		const original = `{
  // keep this comment
  "theme": "One Dark",
  "formatter": { "language_server": { "name": "biome" } },
  "code_actions_on_format": { "source.fixAll.biome": true },
  "languages": { "JavaScript": { "formatter": { "language_server": { "name": "biome" } } } }
}
`;
		const { content } = buildSettings(original, "oxc", { formatOnSave: "on" });
		const parsed = parse(content);

		expect(content).toContain("// keep this comment");
		expect(content).toContain('"theme": "One Dark"');
		expect(parsed.formatter).toBeUndefined();
		expect(content).not.toContain("source.fixAll.biome");
		expect(parsed.languages.JavaScript.formatter[0].language_server.name).toBe(
			"oxfmt",
		);
		expect(parsed.languages.JavaScript.formatter[1].code_action).toBe(
			"source.fixAll.oxc",
		);
		expect(detectFormatter(content)).toBe("oxc");
	});

	test("honours format_on_save modes", () => {
		const { content } = buildSettings("", "biome", {
			formatOnSave: "modifications",
		});
		expect(JSON.parse(content).languages.TypeScript.format_on_save).toBe(
			"modifications",
		);
	});

	test("keeps CRLF line endings", () => {
		const { content } = buildSettings('{\r\n  "theme": "X"\r\n}\r\n', "biome", {
			formatOnSave: "on",
		});
		expect(content.includes("\r\n")).toBe(true);
	});

	test("switching back to biome cleans up oxc-only languages", () => {
		const original = '{\n  "theme": "One Dark"\n}\n';
		const withOxc = buildSettings(original, "oxc", {
			formatOnSave: "on",
		}).content;
		expect(withOxc).toContain('"Markdown"');
		expect(withOxc).toContain('"name": "oxfmt"');

		const withBiome = buildSettings(withOxc, "biome", {
			formatOnSave: "on",
		}).content;
		expect(withBiome).not.toContain("oxfmt");
		expect(withBiome).not.toContain('"Markdown"');
		expect(detectFormatter(withBiome)).toBe("biome");
		expect(
			JSON.parse(withBiome).languages.JavaScript.formatter[0].language_server
				.name,
		).toBe("biome");
	});
});

describe("hasJsoncErrors", () => {
	test("accepts JSONC with comments and trailing commas", () => {
		expect(hasJsoncErrors('{\n  // c\n  "a": 1,\n}\n')).toBe(false);
	});

	test("rejects malformed JSON", () => {
		expect(hasJsoncErrors('{ "a": }')).toBe(true);
	});
});

describe("buildKeymap", () => {
	test("creates a Format Buffer binding in an empty keymap", () => {
		const { content } = buildKeymap("", { enabled: true, key: "ctrl-shift-i" });
		expect(detectFormatBufferKey(content)).toBe("ctrl-shift-i");
		const parsed = JSON.parse(content);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed[0].bindings["ctrl-shift-i"]).toBe("editor::Format");
	});

	test("moves the binding to a new key and preserves comments", () => {
		const original = `[
  // keep me
  { "bindings": { "ctrl-s": "workspace::Save" } }
]
`;
		const withBuffer = buildKeymap(original, {
			enabled: true,
			key: "ctrl-shift-i",
		}).content;
		expect(withBuffer).toContain("// keep me");
		expect(detectFormatBufferKey(withBuffer)).toBe("ctrl-shift-i");

		const moved = buildKeymap(withBuffer, {
			enabled: true,
			key: "alt-shift-f",
		}).content;
		expect(detectFormatBufferKey(moved)).toBe("alt-shift-f");
		expect(moved).not.toContain('"ctrl-shift-i"');
	});

	test("removes the binding and cleans up the empty block when disabled", () => {
		const original = `[
  { "bindings": { "ctrl-s": "workspace::Save" } }
]
`;
		const withBuffer = buildKeymap(original, {
			enabled: true,
			key: "ctrl-shift-i",
		}).content;
		const disabled = buildKeymap(withBuffer, {
			enabled: false,
			key: "ctrl-shift-i",
		}).content;
		expect(detectFormatBufferKey(disabled)).toBeUndefined();
		const parsed = JSON.parse(disabled);
		expect(parsed).toHaveLength(1);
		expect(parsed[0].bindings["ctrl-s"]).toBe("workspace::Save");
	});

	test("default key is platform specific", () => {
		expect(typeof defaultFormatBufferKey()).toBe("string");
	});
});

describe("backups", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "zedfmt-bak-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("writeSettings creates a backup and restoreLatestBackup recovers it", () => {
		const settingsPath = join(dir, "settings.json");
		writeFileSync(settingsPath, '{\n  "a": 1\n}\n', "utf8");

		writeSettings({ settingsPath, scope: "custom" }, '{\n  "a": 2\n}\n');
		expect(readFileSync(settingsPath, "utf8")).toContain('"a": 2');
		expect(latestBackup(settingsPath)).toBeDefined();

		const restored = restoreLatestBackup(settingsPath);
		expect(restored).toBeDefined();
		expect(readFileSync(settingsPath, "utf8")).toContain('"a": 1');
	});
});

describe("resolveTarget", () => {
	test("defaults to the global settings file", () => {
		expect(resolveTarget([])).toEqual({
			settingsPath: globalSettingsPath(),
			scope: "global",
		});
	});

	test("supports --local", () => {
		const target = resolveTarget(["--local"], "C:\\project");
		expect(target.scope).toBe("project");
		expect(target.settingsPath.endsWith("settings.json")).toBe(true);
	});

	test("supports --path", () => {
		const target = resolveTarget(
			["--path", "custom/settings.json"],
			"C:\\project",
		);
		expect(target.scope).toBe("custom");
		expect(existsSync(target.settingsPath)).toBe(false);
	});
});

describe("platform paths", () => {
	test("linux uses XDG when set", () => {
		const ctx = {
			platform: "linux" as const,
			env: {
				XDG_CONFIG_HOME: "/home/u/.config",
				XDG_DATA_HOME: "/home/u/.data",
			},
			home: "/home/u",
		};
		expect(globalSettingsPath(ctx)).toBe("/home/u/.config/zed/settings.json");
		expect(extensionsDir(ctx)).toBe("/home/u/.data/zed/extensions/installed");
		expect(prefsPath(ctx)).toBe(
			"/home/u/.config/zed-formatter-tui/config.json",
		);
	});

	test("linux defaults without XDG", () => {
		const ctx = { platform: "linux" as const, env: {}, home: "/home/u" };
		expect(globalSettingsPath(ctx)).toBe("/home/u/.config/zed/settings.json");
		expect(extensionsDir(ctx)).toBe(
			"/home/u/.local/share/zed/extensions/installed",
		);
	});

	test("windows uses APPDATA and LOCALAPPDATA", () => {
		const ctx = {
			platform: "win32" as const,
			env: {
				APPDATA: "C:\\Users\\u\\AppData\\Roaming",
				LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
			},
			home: "C:\\Users\\u",
		};
		expect(globalSettingsPath(ctx)).toBe(
			"C:\\Users\\u\\AppData\\Roaming\\Zed\\settings.json",
		);
		expect(extensionsDir(ctx)).toBe(
			"C:\\Users\\u\\AppData\\Local\\Zed\\extensions\\installed",
		);
		expect(prefsPath(ctx)).toBe(
			"C:\\Users\\u\\AppData\\Roaming\\zed-formatter-tui\\config.json",
		);
	});

	test("macos uses Application Support", () => {
		const ctx = { platform: "darwin" as const, env: {}, home: "/Users/u" };
		expect(globalSettingsPath(ctx)).toBe(
			"/Users/u/Library/Application Support/Zed/settings.json",
		);
		expect(extensionsDir(ctx)).toBe(
			"/Users/u/Library/Application Support/Zed/extensions/installed",
		);
	});

	test("ZED_FORMATTER_TUI_CONFIG overrides the prefs path", () => {
		const ctx = {
			platform: "linux" as const,
			env: { ZED_FORMATTER_TUI_CONFIG: "/tmp/custom.json" },
			home: "/home/u",
		};
		expect(prefsPath(ctx)).toBe("/tmp/custom.json");
	});
});
