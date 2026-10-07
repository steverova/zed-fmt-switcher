export interface KeyLike {
	name: string;
	ctrl?: boolean;
	meta?: boolean;
	option?: boolean;
	super?: boolean;
	hyper?: boolean;
	shift?: boolean;
}

export type UiAction =
	| { type: "quit" }
	| { type: "move"; delta: number }
	| { type: "change"; delta: number }
	| { type: "act" }
	| { type: "preview" }
	| { type: "undo" }
	| { type: "install" }
	| { type: "verify" }
	| { type: "scripts" }
	| { type: "uninstall" }
	| { type: "target" }
	| { type: "reload" }
	| null;

function isChord(key: KeyLike): boolean {
	return Boolean(key.ctrl || key.meta || key.option || key.super || key.hyper);
}

/**
 * Map an OpenTUI key event to a UI action.
 *
 * Modifier chords are ignored on purpose: the key shown next to "Buffer key" is
 * a Zed shortcut (for example `shift-alt-f`), not a control of this TUI.
 */
export function resolveAction(key: KeyLike): UiAction {
	const name = key.name;

	if (key.ctrl && name === "c") return { type: "quit" };
	if (!isChord(key) && name === "escape") return { type: "quit" };

	// Arrow keys are not chords on any layout.
	if (name === "up") return { type: "move", delta: -1 };
	if (name === "down") return { type: "move", delta: 1 };
	if (name === "left") return { type: "change", delta: -1 };
	if (name === "right") return { type: "change", delta: 1 };

	if (isChord(key)) return null;
	if (key.shift) return null;

	if (name === "return" || name === "enter" || name === "space")
		return { type: "act" };
	if (name === "q") return { type: "quit" };
	if (name === "k") return { type: "move", delta: -1 };
	if (name === "j") return { type: "move", delta: 1 };
	if (name === "h") return { type: "change", delta: -1 };
	if (name === "l") return { type: "change", delta: 1 };
	if (name === "p") return { type: "preview" };
	if (name === "u") return { type: "undo" };
	if (name === "i") return { type: "install" };
	if (name === "v") return { type: "verify" };
	if (name === "s") return { type: "scripts" };
	if (name === "x") return { type: "uninstall" };
	if (name === "t") return { type: "target" };
	if (name === "r") return { type: "reload" };

	return null;
}

export type ModalAction = "confirm" | "cancel" | null;

/** Keys while a modal is open. Everything else (arrows) is left to the scroll box. */
export function resolveModalAction(key: KeyLike): ModalAction {
	if (key.ctrl && key.name === "c") return "cancel";
	if (key.name === "y" || key.name === "return" || key.name === "enter")
		return "confirm";
	if (key.name === "n" || key.name === "escape") return "cancel";
	return null;
}
