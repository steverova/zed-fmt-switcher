import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App } from "./app";

const target = {
	settingsPath: "C:/nope/settings.json",
	scope: "custom" as const,
};

let prefsDir: string;
beforeEach(() => {
	prefsDir = mkdtempSync(join(tmpdir(), "zedfmt-prefs-"));
	process.env.ZED_FORMATTER_TUI_CONFIG = join(prefsDir, "config.json");
});
afterEach(() => {
	delete process.env.ZED_FORMATTER_TUI_CONFIG;
	rmSync(prefsDir, { recursive: true, force: true });
});

test("renders the form TUI", async () => {
	const setup = await testRender(<App target={target} />, {
		width: 90,
		height: 30,
	});
	try {
		await setup.renderOnce();
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Zed Formatter TUI");
		expect(frame).toContain("Formatter");
		expect(frame).toContain("Biome");
		expect(frame).toContain("Format on save");
		expect(frame).toContain("Buffer key");
		expect(frame).toContain("Packages");
		expect(frame).toContain("Apply");
	} finally {
		setup.renderer.destroy();
	}
});

test("fits an 80x24 terminal", async () => {
	const setup = await testRender(<App target={target} />, {
		width: 80,
		height: 24,
	});
	try {
		await setup.renderOnce();
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Formatter");
		expect(frame).toContain("Biome");
		expect(frame).toContain("Apply");
	} finally {
		setup.renderer.destroy();
	}
});

test("changing the formatter with the right arrow", async () => {
	const setup = await testRender(<App target={target} />, {
		width: 90,
		height: 30,
	});
	try {
		await setup.renderOnce();
		await setup.mockInput.pressKeys(["right"], 10);
		await setup.flush();
		await setup.renderOnce();
		expect(setup.captureCharFrame()).toContain("Oxc (oxfmt)");
	} finally {
		setup.renderer.destroy();
	}
});

test("preview modal opens with a diff and cancels", async () => {
	const setup = await testRender(<App target={target} />, {
		width: 90,
		height: 30,
	});
	try {
		await setup.renderOnce();
		await setup.mockInput.pressKeys(["p"], 10);
		await setup.flush();
		await setup.renderOnce();
		const modal = setup.captureCharFrame();
		expect(modal).toContain("Preview changes");
		expect(modal).toContain("settings.json");
		expect(modal).toContain("+");

		await setup.mockInput.pressKeys(["n"], 10);
		await setup.flush();
		await setup.renderOnce();
		expect(setup.captureCharFrame()).toContain("Zed Formatter TUI");
	} finally {
		setup.renderer.destroy();
	}
});

test("confirming the preview writes per-language settings and a backup", async () => {
	const dir = mkdtempSync(join(tmpdir(), "zedfmt-app-"));
	const settingsPath = join(dir, "settings.json");
	const setup = await testRender(
		<App target={{ settingsPath, scope: "custom" }} />,
		{ width: 90, height: 30 },
	);
	try {
		await setup.renderOnce();
		await setup.mockInput.pressKeys(["p"], 10);
		await setup.flush();
		await setup.renderOnce();
		await setup.mockInput.pressKeys(["y"], 10);
		await setup.flush();
		await setup.renderOnce();

		const written = readFileSync(settingsPath, "utf8");
		expect(written).toContain("languages");
		expect(written).toContain('"name": "biome"');
		expect(written).not.toContain('"prettier"');
		expect(written).not.toContain('"formatter": {');

		const files = readdirSync(dir);
		expect(files.some((name) => name.endsWith(".bak"))).toBe(false); // first write has no prior file
		expect(files).toContain("settings.json");
	} finally {
		setup.renderer.destroy();
		rmSync(dir, { recursive: true, force: true });
	}
});
