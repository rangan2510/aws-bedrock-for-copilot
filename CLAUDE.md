# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A VSCode extension that integrates AWS Bedrock foundation models (Claude, Llama, Mistral, etc.) into GitHub Copilot Chat using AWS named profiles for authentication. Built on VSCode's `LanguageModelChatProvider` API.

## Essential Commands

### Development

```bash
bun install                               # Install dependencies (also downloads VSCode API definitions)
bunx tsgo --noEmit                        # Run TypeScript type checking (no emit)
bunx eslint -f compact --fix FILENAME.ts  # Run ESLint
```

### Testing

Uses `mocha` via `vscode-test`

```bash

bun run test             # Run tests
```

## Architecture Overview

### Core Flow

1. **Extension activation** (extension.ts) → Registers `BedrockChatModelProvider` with VSCode
2. **Model listing** → `BedrockAPIClient` fetches available models via AWS SDK
3. **Chat requests** → Messages converted to Bedrock format → Streamed responses via `ConverseStream` API
4. **Stream processing** → `StreamProcessor` handles content blocks and tool calls

### Key Components

**Provider Layer** (src/provider.ts)

- `BedrockChatModelProvider`: Main VSCode integration implementing `LanguageModelChatProvider`
- `provideLanguageModelChatInformation()`: Lists available Bedrock models
- `provideLanguageModelChatResponse()`: Handles chat requests with streaming
- Token estimation using char_count/4 approximation

**AWS Integration** (src/bedrock-client.ts)

- `BedrockAPIClient`: Wraps AWS SDK Bedrock clients
- Uses `fromIni()` credential provider when profile specified
- Falls back to default AWS credential chain when no profile
- Handles both foundation models and cross-region inference profiles

**Message Conversion** (src/converters/)

- `messages.ts`: VSCode messages → Bedrock Converse API format
- `tools.ts`: VSCode tools → Bedrock tool configuration
- `schema.ts`: Tool schemas → JSON Schema format
- Handles text, images, tool calls, and tool results

**Stream Processing** (src/stream-processor.ts)

- Processes Bedrock `ConverseStream` events
- `contentBlockStart` → Initiates tool calls
- `contentBlockDelta` → Streams text or tool inputs
- `contentBlockStop` → Finalizes tool calls
- Uses `ToolBuffer` to accumulate streaming JSON tool parameters

**Configuration** (src/commands/manage-settings.ts, src/aws-profiles.ts)

- `manageSettings()`: Interactive UI for profile/region selection
- `listAwsProfiles()`: Parses ~/.aws/credentials and ~/.aws/config files
- Settings persisted in VSCode `globalState` (Memento)

**Logging** (src/logger.ts)

- Uses `LogOutputChannel` for structured logging with severity levels
- Passes structured data directly to VSCode (objects remain objects, not stringified)
- Integrates with VSCode's "Export Logs..." feature for log export
- Log levels (from most to least verbose):
  - `trace()`: Very verbose stream processing details (deltas, indices)
  - `debug()`: Debugging information (tool calls, message conversions)
  - `info()`: Normal operational flow (requests, completions)
  - `warn()`: Non-critical issues (progress report failures)
  - `error()`: Error conditions requiring attention
- Automatically manages log files for debugging
- Legacy `log()` method deprecated (forwards to `info()`)

### Model Capabilities (src/profiles.ts)

Different Bedrock models have varying capabilities:

- **Tool choice modes**: Some models support `any`/`auto`/`tool`, others only support absence vs presence
- **Tool result formats**: Models differ in how they expect tool results (JSON vs text)
- Check model-specific profiles when debugging tool calling issues

## Important Patterns

## File Organization

```text
src/
├── extension.ts              # Entry point, activation
├── provider.ts               # Main LanguageModelChatProvider
├── bedrock-client.ts         # AWS SDK wrapper
├── stream-processor.ts       # Stream event handler
├── tool-buffer.ts            # JSON accumulator for streaming tools
├── profiles.ts               # Model capability profiles
├── aws-profiles.ts           # AWS config file parsing
├── logger.ts                 # Centralized logging
├── validation.ts             # Request validation
├── types.ts                  # TypeScript interfaces
├── commands/
│   └── manage-settings.ts    # Settings UI
└── converters/
    ├── messages.ts           # Message format conversion
    ├── tools.ts              # Tool format conversion
    └── schema.ts             # JSON Schema conversion
```

## Configuration Files

- **package.json**: VSCode contribution point `languageModelChatProviders` with vendor `"bedrock"`
- **tsconfig.json**: Strict mode, ES2024 target, Node16 modules
- **eslint.config.mjs**: TypeScript ESLint + stylistic plugin
- **.vscode-test.mjs**: VSCode Tests runner
- **lefthook.yml**: Git hooks config

## Common Issues

## VSCode API Requirements

- `engines.vscode`: `^1.116.0`. `LanguageModelChatProvider` is a **proposed (unstable) API** — Microsoft can change its shape in any VS Code release with no deprecation cycle. Every VS Code update is a potential breakage point (this fork's changelog is largely such fixes: `agentMode`/`isUserSelectable` in 1.116, body-timeout, empty-response, etc.). An `engines.vscode` upper bound would be ideal but `vsce` rejects compound ranges, so the activation guard below is the safety net.
- **After each VS Code update: rebuild + reinstall the VSIX and retest.** There is no auto-update (sideloaded, not on Marketplace — the Marketplace rejects proposed-API extensions). Bump the `engines.vscode` upper bound only after retesting on the new version.
- `extension.ts` has an activation-time guard that fails loudly if `vscode.lm.registerLanguageModelChatProvider` is missing.
- Uses proposed/experimental APIs; `src/vscode.d.ts` is downloaded via `bun run download-api` but the `agentMode`/`isUserSelectable` picker fields are hand-patched (via the `PickerLanguageModelChatInformation` intersection type in `provider.ts`).
- VS Code 1.120+ enforces the reported `maxInputTokens`/`maxOutputTokens` when packing conversations for BYOK/provider models — so accurate token limits and the `contextSafetyMargin` reservation matter for avoiding context-overflow.

## Development Workflow

1. Make code changes
2. Run `bun run check-types` and `bun run lint` before committing
