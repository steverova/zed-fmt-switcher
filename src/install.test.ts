import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectPackageManager,
	execCommand,
	findProjectDir,
	installCommand,
	missingPackages,
} from "./install";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "zedfmt-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("detectPackageManager", () => {
	test("pnpm from pnpm-lock.yaml", () => {
		writeFileSync(join(dir, "pnpm-lock.yaml"), "");
		expect(detectPackageManager(dir)).toBe("pnpm");
	});

	test("yarn from yarn.lock", () => {
		writeFileSync(join(dir, "yarn.lock"), "");
		expect(detectPackageManager(dir)).toBe("yarn");
	});

	test("bun from bun.lockb", () => {
		writeFileSync(join(dir, "bun.lockb"), "");
		expect(detectPackageManager(dir)).toBe("bun");
	});

	test("npm from package-lock.json", () => {
		writeFileSync(join(dir, "package-lock.json"), "");
		expect(detectPackageManager(dir)).toBe("npm");
	});

	test("from the packageManager field", () => {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ packageManager: "pnpm@9.0.0" }),
		);
		expect(detectPackageManager(dir)).toBe("pnpm");
	});

	test("defaults to npm", () => {
		expect(detectPackageManager(dir)).toBe("npm");
	});
});

describe("installCommand", () => {
	test("npm installs with -D -E", () => {
		expect(installCommand("npm", ["@biomejs/biome"])).toEqual({
			command: "npm",
			args: ["install", "-D", "-E", "@biomejs/biome"],
		});
	});

	test("pnpm add", () => {
		expect(installCommand("pnpm", ["oxfmt", "oxlint"])).toEqual({
			command: "pnpm",
			args: ["add", "-D", "-E", "oxfmt", "oxlint"],
		});
	});

	test("yarn add", () => {
		expect(installCommand("yarn", ["oxfmt"])).toEqual({
			command: "yarn",
			args: ["add", "-D", "-E", "oxfmt"],
		});
	});

	test("bun add -d", () => {
		expect(installCommand("bun", ["oxfmt"])).toEqual({
			command: "bun",
			args: ["add", "-d", "-E", "oxfmt"],
		});
	});
});

describe("execCommand", () => {
	test("npm uses npx", () => {
		expect(execCommand("npm", "biome", ["init"])).toEqual({
			command: "npx",
			args: ["--yes", "biome", "init"],
		});
	});

	test("pnpm uses exec", () => {
		expect(execCommand("pnpm", "biome", ["init"])).toEqual({
			command: "pnpm",
			args: ["exec", "biome", "init"],
		});
	});

	test("yarn runs the binary", () => {
		expect(execCommand("yarn", "biome", ["init"])).toEqual({
			command: "yarn",
			args: ["biome", "init"],
		});
	});

	test("bun uses bunx", () => {
		expect(execCommand("bun", "oxfmt", ["--init"])).toEqual({
			command: "bunx",
			args: ["oxfmt", "--init"],
		});
	});
});

describe("findProjectDir", () => {
	test("walks up to the nearest package.json", () => {
		mkdirSync(join(dir, "packages", "app"), { recursive: true });
		writeFileSync(join(dir, "package.json"), "{}");
		expect(findProjectDir(join(dir, "packages", "app"))).toBe(dir);
	});
});

describe("missingPackages", () => {
	test("reports packages not declared or installed", () => {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ devDependencies: { oxfmt: "^1.0.0" } }),
		);
		expect(missingPackages(dir, ["oxfmt", "oxlint"])).toEqual(["oxlint"]);
	});

	test("detects scoped packages in node_modules", () => {
		mkdirSync(join(dir, "node_modules", "@biomejs", "biome"), {
			recursive: true,
		});
		expect(missingPackages(dir, ["@biomejs/biome"])).toEqual([]);
	});
});
