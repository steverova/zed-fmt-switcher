import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	useKeyboard,
	useRenderer,
	useTerminalDimensions,
} from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collapseContext, type DiffLine, lineDiff } from "./diff";
import {
	addScripts,
	detectPackageManager,
	execCommand,
	findProjectDir,
	installCommand,
	isManagerAvailable,
	lastLine,
	missingPackages,
	PACKAGE_MANAGERS,
	type PackageManager,
	readScripts,
	removeConfigFiles,
	runCommand,
	scriptsFor,
	uninstallCommand,
	verifyCommand,
} from "./install";
import { resolveAction, resolveModalAction } from "./keys";
import { loadPrefs, savePrefs } from "./prefs";
import {
	buildKeymap,
	buildSettings,
	type DetectedFormatter,
	defaultFormatBufferKey,
	detectFormatBufferKey,
	detectFormatter,
	FORMAT_BUFFER_KEYS,
	FORMAT_ON_SAVE_MODES,
	FORMATTER_ORDER,
	FORMATTERS,
	type FormatOnSaveMode,
	type FormatterId,
	formatterLabel,
	globalSettingsPath,
	hasJsoncErrors,
	installedExtensions,
	keymapPathFor,
	localSettingsPath,
	readSettings,
	restoreLatestBackup,
	type Target,
	writeSettings,
} from "./zed";

interface Status {
	kind: "success" | "error" | "info";
	message: string;
}

interface ModalLine {
	text: string;
	color?: string;
}

interface Modal {
	title: string;
	lines: ModalLine[];
	hint: string;
	confirm: () => void | Promise<void>;
}

const ROW_IDS = [
	"formatter",
	"formatOnSave",
	"formatBuffer",
	"bufferKey",
	"target",
	"manager",
	"packages",
	"apply",
] as const;

type RowId = (typeof ROW_IDS)[number];

interface Row {
	id: RowId;
	label: string;
	value: string;
	color: string;
}

function cycleFormatter(id: FormatterId, delta: number): FormatterId {
	const index = FORMATTER_ORDER.indexOf(id);
	const next =
		(index + delta + FORMATTER_ORDER.length) % FORMATTER_ORDER.length;
	return FORMATTER_ORDER[next] ?? "biome";
}

function cycleMode(mode: FormatOnSaveMode, delta: number): FormatOnSaveMode {
	const index = FORMAT_ON_SAVE_MODES.indexOf(mode);
	const next =
		(index + delta + FORMAT_ON_SAVE_MODES.length) % FORMAT_ON_SAVE_MODES.length;
	return FORMAT_ON_SAVE_MODES[next] ?? "on";
}

function cycleKey(key: string, delta: number): string {
	const index = FORMAT_BUFFER_KEYS.indexOf(key);
	const base =
		index === -1
			? Math.max(0, FORMAT_BUFFER_KEYS.indexOf(defaultFormatBufferKey()))
			: index;
	const next =
		(base + delta + FORMAT_BUFFER_KEYS.length) % FORMAT_BUFFER_KEYS.length;
	return FORMAT_BUFFER_KEYS[next] ?? defaultFormatBufferKey();
}

function cycleManager(current: PackageManager, delta: number): PackageManager {
	const index = PACKAGE_MANAGERS.indexOf(current);
	const next =
		(index + delta + PACKAGE_MANAGERS.length) % PACKAGE_MANAGERS.length;
	return PACKAGE_MANAGERS[next] ?? current;
}

function statusColor(kind: Status["kind"]): string {
	if (kind === "success") return "#22c55e";
	if (kind === "error") return "#ef4444";
	return "#9ca3af";
}

function diffColor(type: DiffLine["type"]): string {
	if (type === "add") return "#22c55e";
	if (type === "remove") return "#ef4444";
	return "#6b7280";
}

function diffPrefix(type: DiffLine["type"]): string {
	if (type === "add") return "+ ";
	if (type === "remove") return "- ";
	return "  ";
}

export function App({ target: initialTarget }: { target: Target }) {
	const renderer = useRenderer();
	const { height } = useTerminalDimensions();
	const prefs = useMemo(() => loadPrefs(), []);

	const [selected, setSelected] = useState<FormatterId>(() =>
		prefs.formatter === "oxc" ? "oxc" : "biome",
	);
	const [formatOnSave, setFormatOnSave] = useState<FormatOnSaveMode>(() =>
		FORMAT_ON_SAVE_MODES.includes(prefs.formatOnSave as FormatOnSaveMode)
			? (prefs.formatOnSave as FormatOnSaveMode)
			: "on",
	);
	const [formatBuffer, setFormatBuffer] = useState(
		() => prefs.formatBuffer ?? true,
	);
	const [formatBufferKey, setFormatBufferKey] = useState(
		() => prefs.formatBufferKey ?? defaultFormatBufferKey(),
	);
	const [scope, setScope] = useState<"global" | "project" | "custom">(
		() => initialTarget.scope,
	);
	const customPath =
		initialTarget.scope === "custom" ? initialTarget.settingsPath : undefined;

	const [current, setCurrent] = useState<DetectedFormatter>("none");
	const [extensions, setExtensions] = useState<Set<string>>(() => new Set());
	const [status, setStatus] = useState<Status | null>(null);

	const [projectDir, setProjectDir] = useState(() =>
		findProjectDir(process.cwd()),
	);
	const [detectedManager, setDetectedManager] = useState<PackageManager>("npm");
	const [managerOverride, setManagerOverride] = useState<PackageManager | null>(
		() =>
			PACKAGE_MANAGERS.includes(prefs.manager as PackageManager)
				? (prefs.manager as PackageManager)
				: null,
	);
	const [managerReady, setManagerReady] = useState(true);
	const [missing, setMissing] = useState<string[]>([]);
	const [scriptsPresent, setScriptsPresent] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);

	const [focusIndex, setFocusIndex] = useState(0);
	const [modal, setModal] = useState<Modal | null>(null);

	const target = useMemo<Target>(() => {
		if (scope === "custom" && customPath)
			return { settingsPath: customPath, scope: "custom" };
		if (scope === "project")
			return { settingsPath: localSettingsPath(), scope: "project" };
		return { settingsPath: globalSettingsPath(), scope: "global" };
	}, [scope, customPath]);

	const keymapPath = keymapPathFor(target.settingsPath);
	const manager = managerOverride ?? detectedManager;
	const def = FORMATTERS[selected];

	const refreshProject = useCallback(
		(formatterId: FormatterId, pm: PackageManager) => {
			const dir = findProjectDir(process.cwd());
			setProjectDir(dir);
			setDetectedManager(detectPackageManager(dir));
			setMissing(missingPackages(dir, FORMATTERS[formatterId].packages));
			const wanted = scriptsFor(formatterId);
			const present = readScripts(dir);
			setScriptsPresent(Object.keys(wanted).every((name) => name in present));
			setManagerReady(isManagerAvailable(pm));
		},
		[],
	);

	const refreshFromDisk = useCallback(
		(formatterId: FormatterId, pm: PackageManager) => {
			const content = readSettings(target.settingsPath);
			setCurrent(detectFormatter(content));
			const keymapContent = readSettings(keymapPath);
			const existingKey = detectFormatBufferKey(keymapContent);
			setFormatBuffer(Boolean(existingKey));
			if (existingKey) setFormatBufferKey(existingKey);
			setExtensions(installedExtensions());
			refreshProject(formatterId, pm);
		},
		[keymapPath, refreshProject, target.settingsPath],
	);

	const initialized = useRef(false);
	useEffect(() => {
		if (initialized.current) return;
		initialized.current = true;
		if (initialTarget.scope !== "custom" && prefs.targetScope)
			setScope(prefs.targetScope);
		const content = readSettings(target.settingsPath);
		const detected = detectFormatter(content);
		setCurrent(detected);
		if (detected === "biome" || detected === "oxc") setSelected(detected);
		const keymapContent = readSettings(keymapPath);
		const existingKey = detectFormatBufferKey(keymapContent);
		setFormatBuffer(Boolean(existingKey));
		if (existingKey) setFormatBufferKey(existingKey);
		setExtensions(installedExtensions());
		refreshProject(
			detected === "oxc" ? "oxc" : "biome",
			managerOverride ?? detectPackageManager(process.cwd()),
		);
		setStatus({
			kind: "info",
			message: existsSync(target.settingsPath) ? "Loaded." : "No settings yet.",
		});
	}, [
		initialTarget.scope,
		keymapPath,
		managerOverride,
		prefs.targetScope,
		refreshProject,
		target.settingsPath,
	]);

	useEffect(() => {
		savePrefs({
			formatter: selected,
			formatOnSave,
			formatBuffer,
			formatBufferKey,
			manager: managerOverride ?? undefined,
			targetScope: scope === "custom" ? undefined : scope,
		});
	}, [
		selected,
		formatOnSave,
		formatBuffer,
		formatBufferKey,
		managerOverride,
		scope,
	]);

	const reload = useCallback(() => {
		refreshFromDisk(selected, manager);
		setStatus({ kind: "info", message: "Reloaded from disk." });
	}, [manager, refreshFromDisk, selected]);

	const applyNow = useCallback(
		(
			settingsContent: string,
			keymapContent: string,
			keymapChanged: boolean,
		) => {
			writeSettings(target, settingsContent);
			if (keymapChanged)
				writeSettings(
					{ settingsPath: keymapPath, scope: target.scope },
					keymapContent,
				);
			setCurrent(detectFormatter(settingsContent));
			refreshProject(selected, manager);
			setStatus({
				kind: "success",
				message: `Applied ${def.label} to ${scope} settings.`,
			});
		},
		[def.label, keymapPath, manager, refreshProject, scope, selected, target],
	);

	const openPreview = useCallback(() => {
		const settingsOriginal = readSettings(target.settingsPath);
		const keymapOriginal = readSettings(keymapPath);
		if (hasJsoncErrors(settingsOriginal)) {
			setStatus({
				kind: "error",
				message: `${target.settingsPath} is not valid JSONC. Fix it first.`,
			});
			return;
		}
		if (hasJsoncErrors(keymapOriginal)) {
			setStatus({
				kind: "error",
				message: `${keymapPath} is not valid JSONC. Fix it first.`,
			});
			return;
		}

		const settings = buildSettings(settingsOriginal, selected, {
			formatOnSave,
		});
		const keymap = buildKeymap(keymapOriginal, {
			enabled: formatBuffer,
			key: formatBufferKey,
		});

		const lines: ModalLine[] = [{ text: "settings.json", color: "#93c5fd" }];
		const settingsDiff = collapseContext(
			lineDiff(settingsOriginal, settings.content),
		);
		if (settingsDiff.length === 0)
			lines.push({ text: "  (no changes)", color: "#6b7280" });
		for (const line of settingsDiff) {
			lines.push({
				text: `${diffPrefix(line.type)}${line.text}`,
				color: diffColor(line.type),
			});
		}
		lines.push({ text: "", color: "#6b7280" });
		lines.push({ text: "keymap.json", color: "#93c5fd" });
		const keymapDiff = collapseContext(
			lineDiff(keymapOriginal, keymap.content),
		);
		if (!keymap.changed || keymapDiff.length === 0)
			lines.push({ text: "  (no changes)", color: "#6b7280" });
		for (const line of keymapDiff) {
			lines.push({
				text: `${diffPrefix(line.type)}${line.text}`,
				color: diffColor(line.type),
			});
		}

		setModal({
			title: "Preview changes",
			lines,
			hint: "y / enter apply · n / esc cancel",
			confirm: () => applyNow(settings.content, keymap.content, keymap.changed),
		});
	}, [
		applyNow,
		formatBuffer,
		formatBufferKey,
		formatOnSave,
		keymapPath,
		selected,
		target.settingsPath,
	]);

	const install = useCallback(async () => {
		if (busy) return;
		const pm = manager;
		setBusy(`Installing ${def.packages.join(", ")} with ${pm}…`);
		setStatus({
			kind: "info",
			message: `Installing ${def.packages.join(", ")} with ${pm}…`,
		});

		const installResult = await runCommand(
			installCommand(pm, def.packages),
			projectDir,
		);
		if (installResult.code !== 0) {
			setBusy(null);
			setStatus({
				kind: "error",
				message: `Install failed (${installResult.code}): ${lastLine(installResult.stderr || installResult.stdout)}`,
			});
			return;
		}

		for (const step of def.init) {
			const result = await runCommand(
				execCommand(pm, step.bin, step.args),
				projectDir,
			);
			if (result.code !== 0) {
				setBusy(null);
				setStatus({
					kind: "error",
					message: `${step.bin} init failed (${result.code}): ${lastLine(result.stderr || result.stdout)}`,
				});
				return;
			}
		}

		setBusy(null);
		refreshProject(selected, pm);
		setStatus({
			kind: "success",
			message: `Installed ${def.packages.join(", ")} and initialized config.`,
		});
	}, [busy, def, manager, projectDir, refreshProject, selected]);

	const verify = useCallback(async () => {
		if (busy) return;
		const pm = manager;
		setBusy(`Running ${def.label} check…`);
		setStatus({ kind: "info", message: `Running ${def.label} check…` });
		const result = await runCommand(verifyCommand(pm, selected), projectDir);
		setBusy(null);
		if (result.code === 0) {
			setStatus({ kind: "success", message: `${def.label} check passed.` });
		} else {
			setStatus({
				kind: "error",
				message: `${def.label} check failed (${result.code}): ${lastLine(result.stderr || result.stdout)}`,
			});
		}
	}, [busy, def.label, manager, projectDir, selected]);

	const addScriptsAction = useCallback(() => {
		try {
			const written = addScripts(projectDir, scriptsFor(selected));
			refreshProject(selected, manager);
			setStatus({
				kind: "success",
				message: `Added scripts: ${written.join(", ")}`,
			});
		} catch (error) {
			setStatus({
				kind: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}, [manager, projectDir, refreshProject, selected]);

	const undo = useCallback(() => {
		const settingsBackup = restoreLatestBackup(target.settingsPath);
		const keymapBackup = restoreLatestBackup(keymapPath);
		if (!settingsBackup && !keymapBackup) {
			setStatus({ kind: "error", message: "No backups found." });
			return;
		}
		reload();
		setStatus({ kind: "success", message: "Restored latest backup." });
	}, [keymapPath, reload, target.settingsPath]);

	const openCleanup = useCallback(() => {
		const others = FORMATTER_ORDER.filter((id) => id !== selected).map(
			(id) => FORMATTERS[id],
		);
		const packages = others.flatMap((other) => other.packages);
		const files = others
			.flatMap((other) => other.configFiles)
			.filter((file) => existsSync(join(projectDir, file)));
		setModal({
			title: "Cleanup other formatters",
			lines: [
				{ text: "Remove from the project:", color: "#f59e0b" },
				{ text: `packages: ${packages.join(", ")}`, color: "#e5e7eb" },
				{
					text: `config files: ${files.length ? files.join(", ") : "none"}`,
					color: "#e5e7eb",
				},
			],
			hint: "y / enter cleanup · n / esc cancel",
			confirm: async () => {
				setBusy("Cleaning up…");
				const result = await runCommand(
					uninstallCommand(manager, packages),
					projectDir,
				);
				const removed = removeConfigFiles(projectDir, files);
				setBusy(null);
				refreshProject(selected, manager);
				if (result.code !== 0) {
					setStatus({
						kind: "error",
						message: `Uninstall failed (${result.code}): ${lastLine(result.stderr || result.stdout)}`,
					});
					return;
				}
				setStatus({
					kind: "success",
					message: `Removed ${packages.join(", ")}${removed.length ? ` and ${removed.join(", ")}` : ""}.`,
				});
			},
		});
	}, [manager, projectDir, refreshProject, selected]);

	const rows = useMemo<Row[]>(() => {
		const installed = missing.length === 0;
		return [
			{
				id: "formatter",
				label: "Formatter",
				value: def.label,
				color: "#e5e7eb",
			},
			{
				id: "formatOnSave",
				label: "Format on save",
				value: formatOnSave,
				color: "#e5e7eb",
			},
			{
				id: "formatBuffer",
				label: "Format buffer",
				value: formatBuffer ? "on" : "off",
				color: formatBuffer ? "#22c55e" : "#f59e0b",
			},
			{
				id: "bufferKey",
				label: "Buffer key",
				value: formatBufferKey,
				color: "#e5e7eb",
			},
			{ id: "target", label: "Target", value: scope, color: "#e5e7eb" },
			{
				id: "manager",
				label: "Manager",
				value: `${manager} (${managerOverride ? "manual" : "detected"})${managerReady ? "" : " — not found"}`,
				color: managerReady ? "#e5e7eb" : "#f59e0b",
			},
			{
				id: "packages",
				label: "Packages",
				value: installed
					? `${def.packages.join(", ")} installed ✓`
					: `${missing.join(", ")} — enter to install`,
				color: installed ? "#22c55e" : "#f59e0b",
			},
			{
				id: "apply",
				label: "Apply",
				value: "preview & write",
				color: "#93c5fd",
			},
		];
	}, [
		def.label,
		def.packages,
		formatBuffer,
		formatBufferKey,
		formatOnSave,
		manager,
		managerOverride,
		managerReady,
		missing,
		scope,
	]);

	const changeFocused = useCallback(
		(delta: number) => {
			const id = ROW_IDS[focusIndex];
			switch (id) {
				case "formatter":
					setSelected((value) => cycleFormatter(value, delta));
					break;
				case "formatOnSave":
					setFormatOnSave((value) => cycleMode(value, delta));
					break;
				case "formatBuffer":
					setFormatBuffer((value) => !value);
					break;
				case "bufferKey":
					setFormatBufferKey((value) => cycleKey(value, delta));
					break;
				case "target":
					if (scope !== "custom")
						setScope((value) => (value === "global" ? "project" : "global"));
					break;
				case "manager":
					setManagerOverride((value) =>
						cycleManager(value ?? detectedManager, delta),
					);
					break;
				default:
					break;
			}
		},
		[detectedManager, focusIndex, scope],
	);

	const actFocused = useCallback(() => {
		const id = ROW_IDS[focusIndex];
		if (id === "packages") void install();
		else if (id === "apply") openPreview();
		else changeFocused(1);
	}, [changeFocused, focusIndex, install, openPreview]);

	useKeyboard((key) => {
		if (modal) {
			const action = resolveModalAction(key);
			if (action === "cancel") setModal(null);
			else if (action === "confirm") {
				const pending = modal.confirm;
				setModal(null);
				void pending();
			}
			return;
		}

		const action = resolveAction(key);
		if (!action) return;
		switch (action.type) {
			case "quit":
				renderer.destroy();
				break;
			case "move":
				setFocusIndex(
					(value) => (value + action.delta + ROW_IDS.length) % ROW_IDS.length,
				);
				break;
			case "change":
				changeFocused(action.delta);
				break;
			case "act":
				actFocused();
				break;
			case "preview":
				openPreview();
				break;
			case "undo":
				undo();
				break;
			case "install":
				void install();
				break;
			case "verify":
				void verify();
				break;
			case "scripts":
				addScriptsAction();
				break;
			case "uninstall":
				openCleanup();
				break;
			case "target":
				if (scope !== "custom")
					setScope((value) => (value === "global" ? "project" : "global"));
				break;
			case "reload":
				reload();
				break;
		}
	});

	const extensionReady =
		def.extensionId === "" || extensions.has(def.extensionId);
	const maxModalLines = Math.max(3, height - 8);

	if (modal) {
		const visible = modal.lines.slice(0, maxModalLines);
		const hidden = modal.lines.length - visible.length;
		return (
			<box
				style={{
					flexDirection: "column",
					padding: 1,
					width: "100%",
					height: "100%",
				}}
			>
				<box
					title={modal.title}
					titleColor="#93c5fd"
					style={{
						border: true,
						borderStyle: "rounded",
						flexDirection: "column",
						padding: 1,
						flexGrow: 1,
						overflow: "hidden",
					}}
				>
					{visible.map((line, index) => (
						<text key={`${index}-${line.text}`} fg={line.color ?? "#e5e7eb"}>
							{line.text}
						</text>
					))}
					{hidden > 0 ? (
						<text fg="#6b7280">{`  … (${hidden} more lines)`}</text>
					) : null}
				</box>
				<text fg="#6b7280">{modal.hint}</text>
			</box>
		);
	}

	return (
		<box
			style={{
				flexDirection: "column",
				padding: 1,
				width: "100%",
				height: "100%",
			}}
		>
			<box
				title="Zed Formatter TUI"
				titleColor="#93c5fd"
				style={{
					border: true,
					borderStyle: "rounded",
					flexDirection: "column",
					padding: 1,
					overflow: "hidden",
				}}
			>
				{rows.map((row, index) => {
					const focused = index === focusIndex;
					return (
						<box
							key={row.id}
							style={{
								flexDirection: "row",
								gap: 1,
								...(focused ? { backgroundColor: "#1e3a8a" } : {}),
							}}
						>
							<text fg={focused ? "#93c5fd" : "#4b5563"}>
								{focused ? "❯" : " "}
							</text>
							<text fg={focused ? "#ffffff" : "#e5e7eb"}>
								{row.label.padEnd(15)}
							</text>
							<text fg={row.color}>{row.value}</text>
						</box>
					);
				})}

				<text fg="#6b7280">{`settings  ${target.settingsPath}`}</text>
				<text fg="#6b7280">{`project   ${projectDir}`}</text>
				<text fg="#6b7280">{`current   ${formatterLabel(current)}`}</text>
				<text fg="#6b7280">
					{`extensions  biome ${extensions.has("biome") ? "✓" : "✗"}  oxc ${extensions.has("oxc") ? "✓" : "✗"}`}
				</text>
				{extensionReady ? null : (
					<text fg="#f59e0b">{`! Install the "${def.extensionId}" extension in Zed`}</text>
				)}
				{busy ? <text fg="#f59e0b">{busy}</text> : null}
				{status ? (
					<text fg={statusColor(status.kind)}>{status.message}</text>
				) : null}
			</box>

			<text fg="#6b7280">
				↑/↓ row · ←/→ change · enter act · p preview · t target
			</text>
			<text fg="#6b7280">
				i install · v verify · s scripts · u undo · x cleanup · r reload · q
				quit
			</text>
		</box>
	);
}
