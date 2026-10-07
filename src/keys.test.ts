import { describe, expect, test } from "bun:test";
import { resolveAction, resolveModalAction } from "./keys";

describe("resolveAction", () => {
	test("row movement", () => {
		expect(resolveAction({ name: "up" })).toEqual({ type: "move", delta: -1 });
		expect(resolveAction({ name: "k" })).toEqual({ type: "move", delta: -1 });
		expect(resolveAction({ name: "down" })).toEqual({ type: "move", delta: 1 });
		expect(resolveAction({ name: "j" })).toEqual({ type: "move", delta: 1 });
	});

	test("value changes", () => {
		expect(resolveAction({ name: "left" })).toEqual({
			type: "change",
			delta: -1,
		});
		expect(resolveAction({ name: "h" })).toEqual({ type: "change", delta: -1 });
		expect(resolveAction({ name: "right" })).toEqual({
			type: "change",
			delta: 1,
		});
		expect(resolveAction({ name: "l" })).toEqual({ type: "change", delta: 1 });
	});

	test("action keys", () => {
		expect(resolveAction({ name: "return" })).toEqual({ type: "act" });
		expect(resolveAction({ name: "space" })).toEqual({ type: "act" });
		expect(resolveAction({ name: "p" })).toEqual({ type: "preview" });
		expect(resolveAction({ name: "u" })).toEqual({ type: "undo" });
		expect(resolveAction({ name: "i" })).toEqual({ type: "install" });
		expect(resolveAction({ name: "v" })).toEqual({ type: "verify" });
		expect(resolveAction({ name: "s" })).toEqual({ type: "scripts" });
		expect(resolveAction({ name: "x" })).toEqual({ type: "uninstall" });
		expect(resolveAction({ name: "t" })).toEqual({ type: "target" });
		expect(resolveAction({ name: "r" })).toEqual({ type: "reload" });
		expect(resolveAction({ name: "q" })).toEqual({ type: "quit" });
	});

	test("the Zed Format Buffer chord does nothing in the TUI", () => {
		expect(resolveAction({ name: "f", shift: true, option: true })).toBeNull();
		expect(resolveAction({ name: "f", shift: true, meta: true })).toBeNull();
		expect(resolveAction({ name: "f", ctrl: true })).toBeNull();
	});

	test("shifted letters are ignored", () => {
		expect(resolveAction({ name: "i", shift: true })).toBeNull();
		expect(resolveAction({ name: "p", shift: true })).toBeNull();
	});

	test("quit variants", () => {
		expect(resolveAction({ name: "escape" })).toEqual({ type: "quit" });
		expect(resolveAction({ name: "c", ctrl: true })).toEqual({ type: "quit" });
	});
});

describe("resolveModalAction", () => {
	test("confirms and cancels", () => {
		expect(resolveModalAction({ name: "y" })).toBe("confirm");
		expect(resolveModalAction({ name: "return" })).toBe("confirm");
		expect(resolveModalAction({ name: "n" })).toBe("cancel");
		expect(resolveModalAction({ name: "escape" })).toBe("cancel");
	});

	test("leaves arrows for scrolling", () => {
		expect(resolveModalAction({ name: "up" })).toBeNull();
		expect(resolveModalAction({ name: "down" })).toBeNull();
	});
});
