---
description: "Apply parallel extension identity changes so this fork can run alongside the upstream extension"
agent: "agent"
---

Apply the parallel extension identity changes described in [AGENTS.md](../../AGENTS.md#parallel-extension-identity).

The default prefix is `aws-bedrock-for-copilot`. If the user provided an argument, use it as the prefix instead.

## Steps

### 1. package.json

- Set `name` to `aws-bedrock-for-copilot`
- Set `contributes.languageModelChatProviders[0].vendor` to `{{prefix}}`
- Set `contributes.languageModelChatProviders[0].displayName` to `AWS Bedrock for Copilot`
- Set `contributes.languageModelChatProviders[0].managementCommand` to `{{prefix}}.manage`
- Set `contributes.commands[0].command` to `{{prefix}}.manage`
- Set `contributes.commands[0].title` to `Manage AWS Bedrock for Copilot`
- Set `contributes.configuration.title` to `AWS Bedrock for Copilot`
- Rename every configuration property key from `bedrock.*` to `{{prefix}}.*` (e.g., `bedrock.region` becomes `{{prefix}}.region`)

### 2. src/extension.ts

- `registerLanguageModelChatProvider("bedrock", ...)` -> use `"{{prefix}}"`
- `registerCommand("bedrock.manage", ...)` -> use `"{{prefix}}.manage"`
- Output channel name: `"Amazon Bedrock Models"` -> `"AWS Bedrock for Copilot"`
- All `affectsConfiguration("bedrock.X")` calls -> use `"{{prefix}}.X"`

### 3. src/settings.ts

- `getConfiguration("bedrock")` -> `getConfiguration("{{prefix}}")`

### 4. src/provider.ts

- `family: "bedrock"` -> `family: "{{prefix}}"` (3 occurrences)
- `executeCommand("bedrock.manage")` -> `executeCommand("{{prefix}}.manage")`

### 5. src/commands/manage-settings.ts

- `getConfiguration("bedrock")` -> `getConfiguration("{{prefix}}")`

### 6. src/test/provider.test.ts

- `family: "bedrock"` -> `family: "{{prefix}}"` in test assertions

## Important

- Do NOT rename globalState keys (`bedrock.authMethod`, `bedrock.hasRunBefore`, etc.) or SecretStorage keys (`bedrock.apiKey`, etc.) -- they are scoped per extension ID and do not conflict.
- After changes, run `bun run check-types` and `bun run lint` to validate.
