import { describe, expect, test } from "bun:test";
import { collapseContext, countChanges, lineDiff } from "./diff";

describe("lineDiff", () => {
	test("marks identical lines as same", () => {
		const diff = lineDiff("a\nb\n", "a\nb\n");
		expect(diff.every((line) => line.type === "same")).toBe(true);
	});

	test("detects an added line", () => {
		const diff = lineDiff("a\n", "a\nb\n");
		expect(
			diff.filter((line) => line.type === "add").map((line) => line.text),
		).toContain("b");
		expect(countChanges(diff)).toBe(1);
	});

	test("detects a removed line", () => {
		const diff = lineDiff("a\nb\n", "a\n");
		expect(
			diff.some((line) => line.type === "remove" && line.text === "b"),
		).toBe(true);
	});

	test("detects a change as remove + add", () => {
		const diff = lineDiff("a", "b");
		expect(diff).toEqual([
			{ type: "remove", text: "a" },
			{ type: "add", text: "b" },
		]);
	});
});

describe("collapseContext", () => {
	test("drops long unchanged runs", () => {
		const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
		const after = before.replace("line 10", "line ten");
		const collapsed = collapseContext(lineDiff(before, after), 1);
		expect(collapsed.length).toBeLessThan(8);
		expect(collapsed.some((line) => line.type === "remove")).toBe(true);
		expect(collapsed.some((line) => line.type === "add")).toBe(true);
	});

	test("returns nothing when there are no changes", () => {
		expect(collapseContext(lineDiff("a\n", "a\n"))).toEqual([]);
	});
});
