import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { type PathContext, platformJoin } from "./zed";

export interface Prefs {
	formatter?: string;
	formatOnSave?: string;
	formatBuffer?: boolean;
	formatBufferKey?: string;
	manager?: string;
	targetScope?: "global" | "project";
}

/** User config for this TUI, kept out of the Zed settings files. */
export function prefsPath(overrides?: Partial<PathContext>): string {
	const env = overrides?.env ?? process.env;
	const platform = overrides?.platform ?? process.platform;
	const home = overrides?.home ?? homedir();

	const override = env.ZED_FORMATTER_TUI_CONFIG;
	if (override && override.trim()) return override;

	if (platform === "win32") {
		const appData =
			env.APPDATA && env.APPDATA.trim()
				? env.APPDATA
				: platformJoin(platform, home, "AppData", "Roaming");
		return platformJoin(platform, appData, "zed-formatter-tui", "config.json");
	}
	if (platform === "darwin") {
		return platformJoin(
			platform,
			home,
			"Library",
			"Application Support",
			"zed-formatter-tui",
			"config.json",
		);
	}
	const base =
		env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim()
			? env.XDG_CONFIG_HOME
			: platformJoin(platform, home, ".config");
	return platformJoin(platform, base, "zed-formatter-tui", "config.json");
}

export function loadPrefs(path = prefsPath()): Prefs {
	if (!existsSync(path)) return {};
	try {
		const value = JSON.parse(readFileSync(path, "utf8"));
		return value && typeof value === "object" ? (value as Prefs) : {};
	} catch {
		return {};
	}
}

export function savePrefs(prefs: Prefs, path = prefsPath()): void {
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
	} catch {
		// Preferences are best-effort; never break the app over them.
	}
}
