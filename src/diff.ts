export type DiffType = "same" | "add" | "remove";

export interface DiffLine {
	type: DiffType;
	text: string;
}

/** Minimal LCS line diff. Files edited here are small, so O(n·m) is fine. */
export function lineDiff(before: string, after: string): DiffLine[] {
	const a = before.split(/\r?\n/);
	const b = after.split(/\r?\n/);
	const n = a.length;
	const m = b.length;

	const dp: number[][] = Array.from({ length: n + 1 }, () =>
		new Array<number>(m + 1).fill(0),
	);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i]![j] =
				a[i] === b[j]
					? dp[i + 1]![j + 1]! + 1
					: Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
		}
	}

	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			out.push({ type: "same", text: a[i]! });
			i++;
			j++;
		} else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
			out.push({ type: "remove", text: a[i]! });
			i++;
		} else {
			out.push({ type: "add", text: b[j]! });
			j++;
		}
	}
	while (i < n) out.push({ type: "remove", text: a[i++]! });
	while (j < m) out.push({ type: "add", text: b[j++]! });

	return out;
}

/** Keep only changed lines plus `context` unchanged lines around them. */
export function collapseContext(lines: DiffLine[], context = 1): DiffLine[] {
	const changed: number[] = [];
	lines.forEach((line, index) => {
		if (line.type !== "same") changed.push(index);
	});
	if (changed.length === 0) return [];

	const keep = new Set<number>();
	for (const index of changed) {
		for (
			let k = Math.max(0, index - context);
			k <= Math.min(lines.length - 1, index + context);
			k++
		)
			keep.add(k);
	}

	const out: DiffLine[] = [];
	let last = -2;
	for (let index = 0; index < lines.length; index++) {
		if (!keep.has(index)) continue;
		if (out.length > 0 && index !== last + 1)
			out.push({ type: "same", text: "  …" });
		out.push(lines[index]!);
		last = index;
	}
	return out;
}

export function countChanges(lines: DiffLine[]): number {
	return lines.filter((line) => line.type !== "same").length;
}
