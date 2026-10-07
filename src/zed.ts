import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	posix,
	resolve,
	win32,
} from "node:path";
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser";

export type FormatterId = "biome" | "oxc";
export type DetectedFormatter = FormatterId | "none" | "invalid";

export type FormatOnSaveMode =
	| "on"
	| "off"
	| "modifications"
	| "modifications_if_available";
export const FORMAT_ON_SAVE_MODES: FormatOnSaveMode[] = [
	"on",
	"off",
	"modifications",
	"modifications_if_available",
];

export interface FormatterDefinition {
	/** Stable identifier used across the UI. */
	id: FormatterId;
	/** Human readable name. */
	label: string;
	/** Short description shown in the list. */
	description: string;
	/** Language server name provided by the Zed extension. */
	languageServer: string;
	/** Extension folder name inside Zed's `extensions/installed`. */
	extensionId: string;
	/** Languages this formatter will be assigned to. */
	languages: string[];
	/** Actions written into `languages.<Lang>.code_actions_on_format`. */
	codeActionsOnFormat: string[];
	/** Action appended inside `languages.<Lang>.formatter` (Oxc style). */
	formatterCodeAction?: string;
	/** Languages that also get `formatterCodeAction`. */
	lintLanguages: string[];
	/** npm packages installed as dev dependencies. */
	packages: string[];
	/** Init commands run after installing, as `bin` + args. */
	init: Array<{ bin: string; args: string[] }>;
	/** Config files created by the init step, used for cleanup. */
	configFiles: string[];
}

const JS_LANGUAGES = [
	"JavaScript",
	"TypeScript",
	"TSX",
	"JSON",
	"JSONC",
	"CSS",
	"Vue.js",
	"Svelte",
];

export const FORMATTERS: Record<FormatterId, FormatterDefinition> = {
	biome: {
		id: "biome",
		label: "Biome",
		description: "formatter + linter",
		languageServer: "biome",
		extensionId: "biome",
		languages: [...JS_LANGUAGES, "Astro"],
		codeActionsOnFormat: [
			"source.fixAll.biome",
			"source.organizeImports.biome",
		],
		lintLanguages: [],
		packages: ["@biomejs/biome"],
		init: [{ bin: "biome", args: ["init"] }],
		configFiles: ["biome.json", "biome.jsonc"],
	},
	oxc: {
		id: "oxc",
		label: "Oxc (oxfmt)",
		description: "oxfmt formatter + oxlint",
		languageServer: "oxfmt",
		extensionId: "oxc",
		languages: [
			...JS_LANGUAGES,
			"JSON5",
			"SCSS",
			"Less",
			"HTML",
			"Markdown",
			"MDX",
			"YAML",
			"TOML",
			"GraphQL",
			"Handlebars",
		],
		codeActionsOnFormat: [],
		formatterCodeAction: "source.fixAll.oxc",
		lintLanguages: ["JavaScript", "TypeScript", "TSX", "Vue.js", "Svelte"],
		packages: ["oxfmt", "oxlint"],
		init: [
			{ bin: "oxfmt", args: ["--init"] },
			{ bin: "oxlint", args: ["--init"] },
		],
		configFiles: [".oxfmtrc.json", ".oxlintrc.json"],
	},
};

export const FORMATTER_ORDER: FormatterId[] = ["biome", "oxc"];

const LANGUAGE_SERVER_TO_FORMATTER: Record<string, FormatterId> = {
	biome: "biome",
	oxfmt: "oxc",
	oxc: "oxc",
};

export interface Target {
	/** Absolute path to the Zed `settings.json` that will be edited. */
	settingsPath: string;
	scope: "global" | "project" | "custom";
}

/* -------------------------------------------------------------------------- */
/* Paths                                                                      */
/* -------------------------------------------------------------------------- */

export interface PathContext {
	platform: NodeJS.Platform;
	env: NodeJS.ProcessEnv;
	home: string;
}

/** Join using the separators of the *target* platform (so Linux paths are testable anywhere). */
export function platformJoin(
	platform: NodeJS.Platform,
	...parts: string[]
): string {
	return platform === "win32" ? win32.join(...parts) : posix.join(...parts);
}

function pathContext(overrides?: Partial<PathContext>): PathContext {
	return {
		platform: overrides?.platform ?? process.platform,
		env: overrides?.env ?? process.env,
		home: overrides?.home ?? homedir(),
	};
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
	const value = env[name];
	return value && value.trim() ? value : undefined;
}

/** Zed user settings file for the current platform. */
export function globalSettingsPath(overrides?: Partial<PathContext>): string {
	const { platform, env, home } = pathContext(overrides);
	if (platform === "win32") {
		const appData =
			envValue(env, "APPDATA") ??
			platformJoin(platform, home, "AppData", "Roaming");
		return platformJoin(platform, appData, "Zed", "settings.json");
	}
	if (platform === "darwin") {
		return platformJoin(
			platform,
			home,
			"Library",
			"Application Support",
			"Zed",
			"settings.json",
		);
	}
	const base =
		envValue(env, "XDG_CONFIG_HOME") ?? platformJoin(platform, home, ".config");
	return platformJoin(platform, base, "zed", "settings.json");
}

/** Directory where Zed unpacks installed extensions. */
export function extensionsDir(overrides?: Partial<PathContext>): string {
	const { platform, env, home } = pathContext(overrides);
	if (platform === "win32") {
		const localAppData =
			envValue(env, "LOCALAPPDATA") ??
			platformJoin(platform, home, "AppData", "Local");
		return platformJoin(
			platform,
			localAppData,
			"Zed",
			"extensions",
			"installed",
		);
	}
	if (platform === "darwin") {
		return platformJoin(
			platform,
			home,
			"Library",
			"Application Support",
			"Zed",
			"extensions",
			"installed",
		);
	}
	const base =
		envValue(env, "XDG_DATA_HOME") ??
		platformJoin(platform, home, ".local", "share");
	return platformJoin(platform, base, "zed", "extensions", "installed");
}

export function localSettingsPath(cwd = process.cwd()): string {
	return join(cwd, ".zed", "settings.json");
}

/**
 * Resolve which settings file to edit from CLI arguments.
 *
 *   (no args)          global user settings
 *   --local            ./.zed/settings.json of the current directory
 *   --path <file>      an explicit settings.json
 */
export function resolveTarget(argv: string[], cwd = process.cwd()): Target {
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--local")
			return { settingsPath: localSettingsPath(cwd), scope: "project" };
		if (arg === "--path" || arg === "--settings") {
			const value = argv[i + 1];
			if (!value) throw new Error(`Missing value for ${arg}`);
			return { settingsPath: toAbsolute(value, cwd), scope: "custom" };
		}
		if (arg?.startsWith("--path="))
			return {
				settingsPath: toAbsolute(arg.slice("--path=".length), cwd),
				scope: "custom",
			};
		if (arg?.startsWith("--settings=")) {
			return {
				settingsPath: toAbsolute(arg.slice("--settings=".length), cwd),
				scope: "custom",
			};
		}
	}
	return { settingsPath: globalSettingsPath(), scope: "global" };
}

function toAbsolute(path: string, cwd: string): string {
	return isAbsolute(path) ? path : resolve(cwd, path);
}

/** Folder names of the currently installed Zed extensions. */
export function installedExtensions(): Set<string> {
	const dir = extensionsDir();
	if (!existsSync(dir)) return new Set();
	try {
		return new Set(
			readdirSync(dir, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name),
		);
	} catch {
		return new Set();
	}
}

/* -------------------------------------------------------------------------- */
/* Reading + detection                                                        */
/* -------------------------------------------------------------------------- */

export function readSettings(path: string): string {
	if (!existsSync(path)) return "";
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

function parseJsonc(content: string): { value: unknown; errors: ParseError[] } {
	const errors: ParseError[] = [];
	const value = parse(content, errors, {
		allowTrailingComma: true,
		disallowComments: false,
	});
	return { value, errors };
}

/** True when the document cannot be parsed as JSONC. */
export function hasJsoncErrors(content: string): boolean {
	if (!content.trim()) return false;
	return parseJsonc(content).errors.length > 0;
}

/** Figure out which formatter the given settings already prefer. */
export function detectFormatter(content: string): DetectedFormatter {
	if (!content.trim()) return "none";

	const { value, errors } = parseJsonc(content);
	if (value === undefined || value === null || typeof value !== "object") {
		return errors.length > 0 ? "invalid" : "none";
	}

	const json = value as Record<string, unknown>;

	const direct = formatterFromValue(json.formatter);
	if (direct) return direct;

	const languages = json.languages;
	if (languages && typeof languages === "object") {
		for (const lang of Object.values(languages as Record<string, unknown>)) {
			if (!lang || typeof lang !== "object") continue;
			const found = formatterFromValue(
				(lang as Record<string, unknown>).formatter,
			);
			if (found) return found;
		}
	}

	return "none";
}

function formatterFromValue(value: unknown): FormatterId | undefined {
	if (!value || typeof value === "string") return undefined;
	const entries = Array.isArray(value) ? value : [value];
	for (const entry of entries) {
		const found = formatterFromObject(entry);
		if (found) return found;
	}
	return undefined;
}

function formatterFromObject(entry: unknown): FormatterId | undefined {
	if (!entry || typeof entry !== "object") return undefined;
	const record = entry as Record<string, unknown>;

	const server = record.language_server;
	if (server && typeof server === "object") {
		const name = (server as Record<string, unknown>).name;
		if (typeof name === "string" && LANGUAGE_SERVER_TO_FORMATTER[name])
			return LANGUAGE_SERVER_TO_FORMATTER[name];
	}

	const external = record.external;
	if (external && typeof external === "object") {
		const command = (external as Record<string, unknown>).command;
		if (typeof command === "string") {
			const base = command.split(/[\\/]/).pop() ?? command;
			if (base.startsWith("biome")) return "biome";
			if (base.startsWith("oxfmt") || base.startsWith("oxc")) return "oxc";
		}
	}

	return undefined;
}

/* -------------------------------------------------------------------------- */
/* Building the new settings                                                  */
/* -------------------------------------------------------------------------- */

export interface BuildOptions {
	/** `format_on_save` value written to each targeted language. */
	formatOnSave: FormatOnSaveMode;
}

export interface BuildResult {
	content: string;
	labels: string[];
}

interface PendingEdit {
	path: (string | number)[];
	value: unknown;
	label: string;
}

interface FormattingOptions {
	tabSize: number;
	insertSpaces: boolean;
	eol: string;
	insertFinalNewline: boolean;
}

function languageFormatterValue(
	def: FormatterDefinition,
	language: string,
): unknown[] {
	const value: unknown[] = [{ language_server: { name: def.languageServer } }];
	if (def.formatterCodeAction && def.lintLanguages.includes(language)) {
		value.push({ code_action: def.formatterCodeAction });
	}
	return value;
}

function formatterUsesDefinition(
	value: unknown,
	def: FormatterDefinition,
): boolean {
	if (!value) return false;
	const entries = Array.isArray(value) ? value : [value];
	return entries.some((entry) => {
		if (!entry || typeof entry !== "object") return false;
		const record = entry as Record<string, unknown>;
		const server = record.language_server;
		return (
			!!server &&
			typeof server === "object" &&
			(server as Record<string, unknown>).name === def.languageServer
		);
	});
}

/**
 * Apply the chosen formatter to a Zed settings file while preserving comments,
 * trailing commas and unrelated settings.
 *
 * Everything is written per language (never a global `formatter`), which is what
 * both the Biome and Oxc Zed extensions recommend.
 */
export function buildSettings(
	original: string,
	id: FormatterId,
	options: BuildOptions,
): BuildResult {
	const def = FORMATTERS[id];
	const others = FORMATTER_ORDER.filter((other) => other !== id).map(
		(other) => FORMATTERS[other],
	);
	const labels: string[] = [];

	let text = original.trim() ? original : "{}\n";
	const currentJson = parseJsonc(text).value;
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const formattingOptions: FormattingOptions = {
		tabSize: 2,
		insertSpaces: true,
		eol,
		insertFinalNewline: text.endsWith("\n") || text === "{}\n",
	};

	const apply = (path: (string | number)[], value: unknown): void => {
		text = applyOne(text, path, value, formattingOptions);
	};

	const edits: PendingEdit[] = [];

	// Remove a global formatter/code actions we manage: both extensions want
	// per-language configuration, and a global formatter breaks other languages.
	const globalFormatter = getPath(currentJson, ["formatter"]);
	if (
		globalFormatter &&
		[def, ...others].some((candidate) =>
			formatterUsesDefinition(globalFormatter, candidate),
		)
	) {
		edits.push({
			path: ["formatter"],
			value: undefined,
			label: "remove global formatter",
		});
	}
	for (const candidate of [def, ...others]) {
		for (const action of candidate.codeActionsOnFormat) {
			edits.push({
				path: ["code_actions_on_format", action],
				value: undefined,
				label: `remove global ${action}`,
			});
		}
	}

	// Per-language overrides.
	for (const language of def.languages) {
		edits.push({
			path: ["languages", language, "formatter"],
			value: languageFormatterValue(def, language),
			label: `languages.${language}.formatter → ${def.label}`,
		});
		edits.push({
			path: ["languages", language, "format_on_save"],
			value: options.formatOnSave,
			label: `languages.${language}.format_on_save → ${options.formatOnSave}`,
		});
		for (const other of others) {
			for (const action of other.codeActionsOnFormat) {
				edits.push({
					path: ["languages", language, "code_actions_on_format", action],
					value: undefined,
					label: `remove languages.${language}.${action}`,
				});
			}
		}
		for (const action of def.codeActionsOnFormat) {
			edits.push({
				path: ["languages", language, "code_actions_on_format", action],
				value: true,
				label: `languages.${language}.${action}`,
			});
		}
	}

	// Drop overrides that only belonged to the other formatters.
	for (const other of others) {
		for (const language of other.languages) {
			if (def.languages.includes(language)) continue;
			const entry = getPath(currentJson, ["languages", language]);
			if (!entry || typeof entry !== "object") continue;
			if (
				!formatterUsesDefinition(
					(entry as Record<string, unknown>).formatter,
					other,
				)
			)
				continue;
			edits.push({
				path: ["languages", language, "formatter"],
				value: undefined,
				label: `remove languages.${language}.formatter`,
			});
			edits.push({
				path: ["languages", language, "format_on_save"],
				value: undefined,
				label: `remove languages.${language}.format_on_save`,
			});
			edits.push({
				path: ["languages", language, "code_actions_on_format"],
				value: undefined,
				label: `remove languages.${language}.code_actions_on_format`,
			});
		}
	}

	for (const edit of edits) {
		// jsonc-parser throws when asked to delete a missing property.
		if (
			edit.value === undefined &&
			!pathExists(parseJsonc(text).value, edit.path)
		)
			continue;
		apply(edit.path, edit.value);
		labels.push(edit.label);
	}

	text = removeEmptyObjects(text, formattingOptions);

	return { content: text, labels };
}

function applyOne(
	text: string,
	path: (string | number)[],
	value: unknown,
	options: FormattingOptions,
): string {
	if (value === undefined && !pathExists(parseJsonc(text).value, path))
		return text;
	const edits = modify(text, path, value, { formattingOptions: options });
	return edits && edits.length > 0 ? applyEdits(text, edits) : text;
}

function removeEmptyObjects(text: string, options: FormattingOptions): string {
	const languages = getPath(parseJsonc(text).value, ["languages"]);
	if (languages && typeof languages === "object" && !Array.isArray(languages)) {
		for (const language of Object.keys(languages as Record<string, unknown>)) {
			const entry = getPath(parseJsonc(text).value, ["languages", language]);
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
			const actions = (entry as Record<string, unknown>).code_actions_on_format;
			if (
				actions &&
				typeof actions === "object" &&
				Object.keys(actions).length === 0
			) {
				text = applyOne(
					text,
					["languages", language, "code_actions_on_format"],
					undefined,
					options,
				);
			}
			const updated = getPath(parseJsonc(text).value, ["languages", language]);
			if (
				updated &&
				typeof updated === "object" &&
				!Array.isArray(updated) &&
				Object.keys(updated).length === 0
			) {
				text = applyOne(text, ["languages", language], undefined, options);
			}
		}
	}

	const globalActions = getPath(parseJsonc(text).value, [
		"code_actions_on_format",
	]);
	if (
		globalActions &&
		typeof globalActions === "object" &&
		!Array.isArray(globalActions) &&
		Object.keys(globalActions).length === 0
	) {
		text = applyOne(text, ["code_actions_on_format"], undefined, options);
	}

	return text;
}

function pathExists(root: unknown, path: (string | number)[]): boolean {
	let current: unknown = root;
	for (const key of path) {
		if (current === null || typeof current !== "object") return false;
		if (Array.isArray(current)) {
			if (typeof key !== "number" || key < 0 || key >= current.length)
				return false;
			current = current[key];
		} else {
			const record = current as Record<string, unknown>;
			if (!(key in record)) return false;
			current = record[key];
		}
	}
	return true;
}

function getPath(root: unknown, path: (string | number)[]): unknown {
	let current: unknown = root;
	for (const key of path) {
		if (current === null || typeof current !== "object") return undefined;
		if (Array.isArray(current)) {
			if (typeof key !== "number") return undefined;
			current = current[key];
		} else {
			current = (current as Record<string, unknown>)[key];
		}
	}
	return current;
}

/* -------------------------------------------------------------------------- */
/* Keymap (Format Buffer)                                                     */
/* -------------------------------------------------------------------------- */

/** Zed action that formats the whole document ("Format Buffer"). */
export const FORMAT_BUFFER_ACTION = "editor::Format";

/** Keys offered by the TUI for the Format Buffer binding. */
export const FORMAT_BUFFER_KEYS = [
	"ctrl-shift-i",
	"shift-alt-f",
	"alt-shift-f",
	"ctrl-alt-f",
];

/** The key Zed binds to Format Buffer by default on this platform. */
export function defaultFormatBufferKey(): string {
	if (process.platform === "win32") return "shift-alt-f";
	if (process.platform === "darwin") return "cmd-shift-i";
	return "ctrl-shift-i";
}

/** `keymap.json` lives next to `settings.json`. */
export function keymapPathFor(settingsPath: string): string {
	return join(dirname(settingsPath), "keymap.json");
}

function readKeymapArray(text: string): unknown[] | undefined {
	if (!text.trim()) return [];
	const value = parseJsonc(text).value;
	return Array.isArray(value) ? value : undefined;
}

function actionMatches(value: unknown): boolean {
	if (value === FORMAT_BUFFER_ACTION) return true;
	return Array.isArray(value) && value[0] === FORMAT_BUFFER_ACTION;
}

/** Returns the key currently bound to Format Buffer, if any. */
export function detectFormatBufferKey(content: string): string | undefined {
	const array = readKeymapArray(content);
	if (!array) return undefined;
	for (const block of array) {
		if (!block || typeof block !== "object" || Array.isArray(block)) continue;
		const bindings = (block as Record<string, unknown>).bindings;
		if (!bindings || typeof bindings !== "object") continue;
		for (const [key, value] of Object.entries(
			bindings as Record<string, unknown>,
		)) {
			if (actionMatches(value)) return key;
		}
	}
	return undefined;
}

export interface KeymapOptions {
	/** Whether a Format Buffer binding should exist. */
	enabled: boolean;
	/** Key to bind to Format Buffer. */
	key: string;
}

export interface KeymapResult {
	content: string;
	changed: boolean;
}

/**
 * Add, move or remove the Format Buffer key binding in `keymap.json`,
 * preserving comments and unrelated bindings.
 */
export function buildKeymap(
	original: string,
	options: KeymapOptions,
): KeymapResult {
	const before = original;
	let text = original.trim() ? original : "[]\n";
	const array = readKeymapArray(text);
	// Never clobber a file we do not understand.
	if (!array) return { content: before, changed: false };

	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const formattingOptions: FormattingOptions = {
		tabSize: 2,
		insertSpaces: true,
		eol,
		insertFinalNewline: text.endsWith("\n"),
	};

	const apply = (path: (string | number)[], value: unknown): void => {
		text = applyOne(text, path, value, formattingOptions);
	};

	const found: Array<{ block: number; key: string }> = [];
	array.forEach((block, index) => {
		if (!block || typeof block !== "object" || Array.isArray(block)) return;
		const bindings = (block as Record<string, unknown>).bindings;
		if (!bindings || typeof bindings !== "object") return;
		for (const [key, value] of Object.entries(
			bindings as Record<string, unknown>,
		)) {
			if (actionMatches(value)) found.push({ block: index, key });
		}
	});

	if (options.enabled) {
		if (found.length === 0) {
			apply([array.length], {
				context: "Editor",
				bindings: { [options.key]: FORMAT_BUFFER_ACTION },
			});
		} else {
			const target = found[0]!;
			if (target.key !== options.key)
				apply([target.block, "bindings", target.key], undefined);
			for (const extra of found.slice(1))
				apply([extra.block, "bindings", extra.key], undefined);
			apply([target.block, "bindings", options.key], FORMAT_BUFFER_ACTION);
		}
	} else {
		for (const entry of found)
			apply([entry.block, "bindings", entry.key], undefined);

		// Drop blocks that only contained the binding we just removed.
		const remaining = readKeymapArray(text);
		if (remaining) {
			for (let index = remaining.length - 1; index >= 0; index--) {
				const block = remaining[index];
				if (!block || typeof block !== "object" || Array.isArray(block))
					continue;
				const record = block as Record<string, unknown>;
				const bindings = record.bindings;
				const onlyManaged = Object.keys(record).every(
					(key) => key === "context" || key === "bindings",
				);
				if (
					onlyManaged &&
					bindings &&
					typeof bindings === "object" &&
					Object.keys(bindings).length === 0
				) {
					apply([index], undefined);
				}
			}
		}
	}

	return { content: text, changed: text !== before };
}

/* -------------------------------------------------------------------------- */
/* Writing + backups                                                          */
/* -------------------------------------------------------------------------- */

export interface WriteResult {
	backup?: string;
}

/**
 * Write settings to disk. A timestamped backup is created next to the original
 * file, and the write is done through a temp file + rename for safety.
 */
export function writeSettings(target: Target, content: string): WriteResult {
	mkdirSync(dirname(target.settingsPath), { recursive: true });

	let backup: string | undefined;
	if (existsSync(target.settingsPath)) {
		backup = createBackup(target.settingsPath);
	}

	const temp = `${target.settingsPath}.tmp-${process.pid}`;
	writeFileSync(temp, content, "utf8");
	try {
		renameSync(temp, target.settingsPath);
	} catch {
		copyFileSync(temp, target.settingsPath);
		unlinkSync(temp);
	}

	return { backup };
}

function createBackup(path: string): string | undefined {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const backup = `${path}.${stamp}.bak`;
	try {
		copyFileSync(path, backup);
		return backup;
	} catch {
		return undefined;
	}
}

/** Newest `*.bak` file next to `path`, if any. */
export function latestBackup(path: string): string | undefined {
	const dir = dirname(path);
	if (!existsSync(dir)) return undefined;
	const prefix = `${basename(path)}.`;
	try {
		const candidates = readdirSync(dir)
			.filter((name) => name.startsWith(prefix) && name.endsWith(".bak"))
			.sort();
		const last = candidates.at(-1);
		return last ? join(dir, last) : undefined;
	} catch {
		return undefined;
	}
}

/** Restore the newest backup over `path`, backing up the current file first. */
export function restoreLatestBackup(path: string): string | undefined {
	const backup = latestBackup(path);
	if (!backup) return undefined;
	if (existsSync(path)) createBackup(path);
	copyFileSync(backup, path);
	return backup;
}

export function formatterLabel(value: DetectedFormatter): string {
	if (value === "none") return "not configured";
	if (value === "invalid") return "unreadable JSONC";
	return FORMATTERS[value].label;
}
