# zed-formatter-tui

TUI hecha con [OpenTUI](https://opentui.com) para configurar qué formatter usa **Zed** en el
ecosistema JavaScript/TypeScript: **Biome** o **Oxc (oxfmt + oxlint)**.

Configura Zed, prepara el proyecto (instala el paquete y su init) y nunca toca la configuración de
opencode ni ningún otro archivo.

## Qué escribe en Zed

Todo se escribe **por lenguaje** (`languages.<Lang>`), nunca con un `formatter` global. Es lo que
recomiendan las dos extensiones: un formatter global rompe lenguajes que la herramienta no soporta
(Rust, Python, etc.).

- `languages.<Lang>.formatter` → `[{ "language_server": { "name": "biome" | "oxfmt" } }]`
  (Oxc añade `{ "code_action": "source.fixAll.oxc" }` en JS/TS/TSX/Vue/Svelte).
- `languages.<Lang>.format_on_save` → el modo elegido.
- Biome añade `languages.<Lang>.code_actions_on_format` con
  `source.fixAll.biome` y `source.organizeImports.biome`.
- Si existe un `formatter` global de alguna de estas herramientas, **se elimina**.

No se escribe nada de Prettier: Biome es su propio formatter y Oxc tiene su propia extensión.

Además:

- **Preserva comentarios, comas finales y el resto de tus ajustes** (edición mínima con `jsonc-parser`).
- Respaldo con marca de tiempo en cada escritura: `settings.json.<fecha>.bak` (y para `keymap.json`).

## Formato (format on save y format buffer)

La fila **Format on save** cicla entre `on`, `off`, `modifications` y `modifications_if_available`.

La fila **Format buffer** añade/quita un atajo en `keymap.json` para `editor::Format` (formatea el
buffer completo). El atajo por defecto es el de Zed según plataforma (Windows `shift-alt-f`,
Linux `ctrl-shift-i`, macOS `cmd-shift-i`) y se cambia con `←/→` entre
`ctrl-shift-i`, `shift-alt-f`, `alt-shift-f` y `ctrl-alt-f`.

> El atajo que aparece en la fila (`Buffer key`) es el que se escribe en Zed, **no** un control de
> esta TUI. Para activarlo/desactivarlo usa la fila Format buffer (`enter` o `←/→`).

## Proyecto: detección e instalación

- **Directorio**: sube desde el cwd hasta el `package.json`.
- **Gestor de paquetes** (detectado): `pnpm-lock.yaml` → pnpm · `yarn.lock` → yarn ·
  `bun.lock`/`bun.lockb` → bun · `package-lock.json` → npm · o el campo `packageManager`. Fallback
  npm. Se cambia con `←/→` en la fila **Manager**.
- **Packages**: si falta el paquete del formatter, `enter` lo instala y ejecuta su init:

| Formatter | Instala (`-D -E`) | Init |
| --- | --- | --- |
| Biome | `@biomejs/biome` | `biome init` → `biome.json` |
| Oxc | `oxfmt` **y** `oxlint` | `oxfmt --init` → `.oxfmtrc.json`, `oxlint --init` → `.oxlintrc.json` |

Los comandos se adaptan al gestor, p. ej. `npm install -D -E @biomejs/biome && npx --yes biome init`.

Acciones globales:

- **`v` verificar**: corre `biome check .` / `oxfmt --check .` y resume el resultado.
- **`s` scripts**: añade scripts a `package.json` (`check`/`format`/`lint` según el formatter).
- **`x` cleanup**: desinstala los paquetes del otro formatter y borra sus archivos de config
  (con confirmación).

## Preview, respaldo y validación

- **`p` / Apply**: muestra un **diff** de `settings.json` y `keymap.json` y pide confirmación
  (`y`/`enter` aplica, `n`/`esc` cancela). Nada se escribe sin confirmar.
- **`u` undo**: restaura el `.bak` más reciente de `settings.json` y `keymap.json`.
- Si un archivo no es JSONC válido, la app **aborta con un mensaje** en vez de escribir.

## Preferencias

La app recuerda formatter, modo, atajo, gestor y target entre ejecuciones, en
`~/.config/zed-formatter-tui/config.json` (o `%APPDATA%\zed-formatter-tui\config.json` en Windows).
Puedes sobreescribir la ruta con `ZED_FORMATTER_TUI_CONFIG`.

## Requisitos

- [Bun](https://bun.sh) 1.3+ (usa el core nativo de OpenTUI).
- La extensión de Zed correspondiente instalada (`zed: extensions` → **Biome** u **Oxc**).

## Uso

### Con Bun (desde el repo)

```bash
bun install
bun start                 # edita el settings.json global de Zed
bun start --local         # edita ./.zed/settings.json del directorio actual
bun start --path <file>   # edita un settings.json explícito
```

### Como comando `zed-fmt`

**Opción A — `bun link`** (requiere Bun; usa el campo `bin` del `package.json`):

```bash
bun link
zed-fmt --help
```

**Opción B — binario standalone** (no requiere Bun ni Node):

```bash
bun run compile
```

Genera `dist\zed-fmt.exe` en Windows y `dist/zed-fmt` en Linux/macOS (Bun añade `.exe` solo en
Windows). Cópialo a una carpeta que ya esté en el PATH, o añade `dist` al PATH.

**Windows** (luego reabre la terminal):

```powershell
# copiar a la carpeta bin de bun (suele estar en PATH)
Copy-Item .\dist\zed-fmt.exe "$env:USERPROFILE\.bun\bin\zed-fmt.exe" -Force

# o añadir dist al PATH de usuario
$dir = "C:\Users\steve\Documents\tui-formatter\dist"
[Environment]::SetEnvironmentVariable(
  "Path",
  [Environment]::GetEnvironmentVariable("Path","User") + ";$dir",
  "User"
)
```

> Evita `setx PATH "%PATH%;..."`: mezcla el PATH de máquina y usuario y trunca a 1024 caracteres.

**Linux/macOS:**

```bash
chmod +x dist/zed-fmt
install -m 755 dist/zed-fmt ~/.local/bin/zed-fmt   # ~/.local/bin suele estar en PATH
# si no lo está, añade a ~/.bashrc o ~/.zshrc:
export PATH="$HOME/.local/bin:$PATH"
```

Una vez en el PATH, el comando es `zed-fmt`:

```bash
zed-fmt                   # settings.json global de Zed
zed-fmt --local           # ./.zed/settings.json del proyecto
zed-fmt --path <file>     # un settings.json explícito
zed-fmt --help
```

### Controles

| Tecla | Acción |
| --- | --- |
| `↑/↓` o `j/k` | mover entre filas |
| `←/→` o `h/l` | cambiar el valor de la fila |
| `enter`/`space` | acción de la fila (instalar / previsualizar) |
| `p` | preview y aplicar |
| `t` | alternar target global/proyecto |
| `i` / `v` / `s` | instalar / verificar / añadir scripts |
| `u` / `x` | deshacer / cleanup del otro formatter |
| `r` | recargar desde disco |
| `q` / `esc` | salir |

## Rutas que detecta

| Sistema | settings.json | extensiones instaladas |
| --- | --- | --- |
| Windows | `%APPDATA%\Zed\settings.json` | `%LOCALAPPDATA%\Zed\extensions\installed` |
| Linux   | `$XDG_CONFIG_HOME/zed/settings.json` (o `~/.config/zed/settings.json`) | `$XDG_DATA_HOME/zed/extensions/installed` |
| macOS   | `~/Library/Application Support/Zed/settings.json` | `~/Library/Application Support/Zed/extensions/installed` |

## Formatter → lenguaje

- **Biome**: JavaScript, TypeScript, TSX, JSON, JSONC, CSS, Vue.js, Astro, Svelte.
- **Oxc (oxfmt)**: JavaScript, TypeScript, TSX, JSON, JSON5, JSONC, CSS, SCSS, Less, HTML, Vue.js,
  Svelte, Markdown, MDX, YAML, TOML, GraphQL, Handlebars.

## Desarrollo

```bash
bun test          # lógica (settings/keymap/install/keys/diff) + render y flujo con OpenTUI
bun run typecheck # tsc --noEmit
bun run lint      # biome check .
```

Los tests cubren las **rutas de las tres plataformas** (Windows `%APPDATA%`, Linux `XDG_*`,
macOS `Application Support`) inyectando plataforma/env/home, así que se validan sin depender del
sistema donde corras los tests. El CI (`.github/workflows/ci.yml`) los ejecuta en Linux (Ubuntu).

## Estructura

```
src/
  index.tsx       entrada: parsea args y monta la app
  app.tsx         UI de OpenTUI (formulario + modal de preview)
  zed.ts          rutas, detección, edición JSONC de settings/keymap, backups
  install.ts      detección de proyecto/gestor, comandos, scripts, verificación
  keys.ts         resolución de teclas → acciones (y modal)
  diff.ts         diff de líneas para el preview
  prefs.ts        preferencias persistentes
  *.test.ts(x)    tests
```
