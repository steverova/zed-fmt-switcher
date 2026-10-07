import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyEdits, modify } from "jsonc-parser";
import type { FormatterId } from "./zed";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export const PACKAGE_MANAGERS: PackageManager[] = [
	"npm",
	"pnpm",
	"yarn",
	"bun",
];

export interface Command {
	command: string;
	args: string[];
}

/* -------------------------------------------------------------------------- */
/* Project detection                                                          */
/* -------------------------------------------------------------------------- */

/** Walk up from `start` until a package.json is found (or the filesystem root). */
export function findProjectDir(start: string): string {
	let dir = start;
	while (true) {
		if (existsSync(join(dir, "package.json"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return start;
		dir = parent;
	}
}

export function readPackageJson(
	dir: string,
): Record<string, unknown> | undefined {
	const file = join(dir, "package.json");
	if (!existsSync(file)) return undefined;
	try {
		const value = JSON.parse(readFileSync(file, "utf8"));
		return value && typeof value === "object"
			? (value as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/** Detect the package manager from lockfiles, then the `packageManager` field. */
export function detectPackageManager(dir: string): PackageManager {
	if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(join(dir, "yarn.lock"))) return "yarn";
	if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, "bun.lockb")))
		return "bun";
	if (existsSync(join(dir, "package-lock.json"))) return "npm";

	const field = readPackageJson(dir)?.packageManager;
	if (typeof field === "string") {
		const name = field.split("@")[0];
		if (name === "npm" || name === "pnpm" || name === "yarn" || name === "bun")
			return name;
	}

	return "npm";
}

/** A package is considered installed when it is declared or present in node_modules. */
export function isPackageInstalled(dir: string, pkg: string): boolean {
	const json = readPackageJson(dir);
	for (const key of [
		"dependencies",
		"devDependencies",
		"optionalDependencies",
	]) {
		const deps = json?.[key];
		if (
			deps &&
			typeof deps === "object" &&
			pkg in (deps as Record<string, unknown>)
		)
			return true;
	}
	return existsSync(join(dir, "node_modules", ...pkg.split("/")));
}

export function missingPackages(dir: string, packages: string[]): string[] {
	return packages.filter((pkg) => !isPackageInstalled(dir, pkg));
}

/** Whether the package manager binary is available on PATH. */
export function isManagerAvailable(pm: PackageManager): boolean {
	try {
		const finder = process.platform === "win32" ? "where" : "which";
		const result = spawnSync(finder, [pm], { stdio: "ignore" });
		return result.status === 0;
	} catch {
		return false;
	}
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

export function installCommand(
	pm: PackageManager,
	packages: string[],
): Command {
	switch (pm) {
		case "pnpm":
			return { command: "pnpm", args: ["add", "-D", "-E", ...packages] };
		case "yarn":
			return { command: "yarn", args: ["add", "-D", "-E", ...packages] };
		case "bun":
			return { command: "bun", args: ["add", "-d", "-E", ...packages] };
		default:
			return { command: "npm", args: ["install", "-D", "-E", ...packages] };
	}
}

export function uninstallCommand(
	pm: PackageManager,
	packages: string[],
): Command {
	switch (pm) {
		case "pnpm":
			return { command: "pnpm", args: ["remove", ...packages] };
		case "yarn":
			return { command: "yarn", args: ["remove", ...packages] };
		case "bun":
			return { command: "bun", args: ["remove", ...packages] };
		default:
			return { command: "npm", args: ["uninstall", ...packages] };
	}
}

/** Run a locally installed binary through the package manager. */
export function execCommand(
	pm: PackageManager,
	bin: string,
	args: string[],
): Command {
	switch (pm) {
		case "pnpm":
			return { command: "pnpm", args: ["exec", bin, ...args] };
		case "yarn":
			return { command: "yarn", args: [bin, ...args] };
		case "bun":
			return { command: "bunx", args: [bin, ...args] };
		default:
			return { command: "npx", args: ["--yes", bin, ...args] };
	}
}

/** Command that checks formatting without writing files. */
export function verifyCommand(pm: PackageManager, id: FormatterId): Command {
	switch (id) {
		case "oxc":
			return execCommand(pm, "oxfmt", ["--check", "."]);
		default:
			return execCommand(pm, "biome", ["check", "."]);
	}
}

/** npm scripts offered per formatter. */
export function scriptsFor(id: FormatterId): Record<string, string> {
	switch (id) {
		case "oxc":
			return {
				format: "oxfmt",
				"format:check": "oxfmt --check",
				lint: "oxlint",
			};
		default:
			return {
				check: "biome check .",
				"check:fix": "biome check --write .",
				format: "biome format --write .",
			};
	}
}

export function readScripts(dir: string): Record<string, string> {
	const scripts = readPackageJson(dir)?.scripts;
	if (!scripts || typeof scripts !== "object") return {};
	return scripts as Record<string, string>;
}

/** Add scripts to package.json (preserving its formatting). Returns the names written. */
export function addScripts(
	dir: string,
	scripts: Record<string, string>,
): string[] {
	const file = join(dir, "package.json");
	let text = existsSync(file) ? readFileSync(file, "utf8") : "{}\n";
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const formattingOptions = {
		tabSize: 2,
		insertSpaces: true,
		eol,
		insertFinalNewline: text.endsWith("\n"),
	};
	const written: string[] = [];

	for (const [name, command] of Object.entries(scripts)) {
		const edits = modify(text, ["scripts", name], command, {
			formattingOptions,
		});
		if (edits && edits.length > 0) text = applyEdits(text, edits);
		written.push(name);
	}

	writeFileSync(file, text, "utf8");
	return written;
}

/** Delete formatter config files if present. Returns the removed file names. */
export function removeConfigFiles(dir: string, files: string[]): string[] {
	const removed: string[] = [];
	for (const file of files) {
		const path = join(dir, file);
		if (!existsSync(path)) continue;
		try {
			unlinkSync(path);
			removed.push(file);
		} catch {
			// ignore
		}
	}
	return removed;
}

export interface RunResult {
	code: number | null;
	stdout: string;
	stderr: string;
	display: string;
}

/** Run a command in `cwd`, capturing output. Uses a shell on Windows for `.cmd` shims. */
export function runCommand(cmd: Command, cwd: string): Promise<RunResult> {
	const display = [cmd.command, ...cmd.args].join(" ");
	return new Promise((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(cmd.command, cmd.args, {
				cwd,
				shell: process.platform === "win32",
				env: process.env,
			});
		} catch (error) {
			resolve({ code: -1, stdout: "", stderr: String(error), display });
			return;
		}

		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) =>
			resolve({ code: -1, stdout, stderr: stderr + String(error), display }),
		);
		child.on("close", (code) => resolve({ code, stdout, stderr, display }));
	});
}

/** Last non-empty line of command output, trimmed for the status bar. */
export function lastLine(text: string, max = 120): string {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const line = lines.at(-1) ?? "";
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
