# Repository Guidelines

## Fork Context

This is an internal fork of [tinovyatkin/amazon-bedrock-copilot-chat](https://github.com/tinovyatkin/amazon-bedrock-copilot-chat) used for quick bugfixes. It runs as a **parallel extension** alongside the upstream version. See [Parallel Extension Identity](#parallel-extension-identity) for the identity boundaries that keep both versions conflict-free.

## Project Structure & Module Organization

- Source: `src/` (extension entry `extension.ts`, provider `provider.ts`, Bedrock client `bedrock-client.ts`, converters under `converters/`, commands under `commands/`, tests in `src/test/`).
- Build output: `dist/` (bundled extension) and `out/` (VSCode test fixtures); VSIX goes to `dist/extension.vsix`.
- Assets & docs: `assets/`, `docs/`, top-level config for lint/format/hooks.
- Architecture: `extension.ts` activates → `provider.ts` lists models and streams replies → `converters/` adapt messages/tools → `stream-processor.ts` buffers tool params and text → `logger.ts` records logs.

## Build, Test, and Development Commands

- `bun install` or `npm install` – install deps and VSCode API d.ts via postinstall.
- `bun run compile` – build the extension to `dist/extension.js` (CJS, sourcemaps).
- `bun run package` – same as compile; used by `vscode:prepublish`.
- `bun run vsce:package` – create `dist/extension.vsix` for manual install.
- `bun run check-types` – type-check with `tsgo` (no emit).
- `bun run lint` / `bun run format` / `bun run format:check` – ESLint + Prettier.
- `bun run test` – runs `vscode-test` (pretest runs type-check).
- `bun run download-api` – refresh proposed VSCode API d.ts when upgrading VSCode.
- Dev loop: open in VSCode ≥1.104.0, press `F5` to launch Extension Development Host; check `BedrockChat*.log`.

## Coding Style & Naming Conventions

- 2-space indentation, LF endings (`.editorconfig`). Prettier enforces 100-char width and JSDoc rules.
- TypeScript; prefer type-only imports and `readonly` fields; avoid `console` (use `logger`).
- Keep imports logically grouped; follow existing Bedrock provider abstractions (client → profiles → provider → stream processor).

## Testing Guidelines

- Unit/integration tests live in `src/test/*.test.ts`; name new specs `<feature>.test.ts`.
- For tests that hit AWS, guard with environment checks to avoid accidental spend; prefer mocked clients where possible.
- Run `bun run test` before PRs; add repro steps for manual E2E. Tests use `mocha` via `vscode-test`.

## Commit & Pull Request Guidelines

- Commitlint types: `build|chore|ci|ai|docs|feat|fix|perf|refactor|revert|style|test`; scope optional; header ≤150 chars. Body/footer blank lines required; no terminal periods.
- Hooks: `lefthook` runs format/lint/typecheck and commitlint; install with `lefthook install` if not active.
- PRs: include what/why, tests run (`bun run test`, manual steps), AWS resources touched, and screenshots or clips if UI/UX changes.

## Parallel Extension Identity

This fork must use distinct identifiers so it can be installed alongside the upstream extension. The identifiers below use the prefix `aws-bedrock-for-copilot` instead of the upstream `bedrock`. Use `/fork-extension` prompt to apply these changes automatically.

### What must be unique (global VSCode namespace)

| Identifier type    | Upstream value                | Fork value                       | Location                                                                               |
| ------------------ | ----------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| Extension name     | `amazon-bedrock-copilot-chat` | `aws-bedrock-for-copilot`        | `package.json` `name`                                                                  |
| Publisher          | `vtkn`                        | `rangan2510`                     | `package.json` `publisher`                                                             |
| Vendor             | `bedrock`                     | `aws-bedrock-for-copilot`        | `package.json` `contributes.languageModelChatProviders[0].vendor`                      |
| Display name       | `Amazon Bedrock`              | `AWS Bedrock for Copilot`        | `package.json` `contributes.languageModelChatProviders[0].displayName`                 |
| Management command | `bedrock.manage`              | `aws-bedrock-for-copilot.manage` | `package.json` `contributes` + `extension.ts`                                          |
| Config namespace   | `bedrock.*`                   | `aws-bedrock-for-copilot.*`      | `package.json` `contributes.configuration.properties` + `settings.ts` + `extension.ts` |

### What is already isolated (scoped per extension ID)

GlobalState keys and SecretStorage keys (e.g., `bedrock.authMethod`, `bedrock.apiKey`) are scoped per extension ID. They do NOT conflict across parallel installs and do NOT need renaming.

### Files requiring identity changes

When forking, the following source files contain hardcoded identity strings:

- `package.json` -- extension name, vendor, commands, config property keys
- `src/extension.ts` -- vendor registration, command registration, output channel name, config listeners
- `src/settings.ts` -- `getConfiguration("bedrock")` calls
- `src/provider.ts` -- `family: "bedrock"` in model info objects
- `src/commands/manage-settings.ts` -- `getConfiguration("bedrock")` calls
- `src/test/provider.test.ts` -- `family: "bedrock"` in test assertions

### Syncing with upstream

When pulling changes from the upstream repo, identity-related conflicts will appear in the files above. Resolve by keeping the fork prefix. The `/fork-extension` prompt can re-apply the identity changes after a merge.
