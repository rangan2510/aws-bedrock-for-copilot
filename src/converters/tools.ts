import type * as bedrockRuntime from "@aws-sdk/client-bedrock-runtime";
import { CachePointType } from "@aws-sdk/client-bedrock-runtime";
import { createHash } from "node:crypto";
import type { LanguageModelChatTool } from "vscode";
import { type LanguageModelChatProvider, LanguageModelChatToolMode } from "vscode";

import { logger } from "../logger";
import { getModelProfile } from "../profiles";
import { convertSchema } from "./schema";

/**
 * Bedrock validates `toolSpec.name` against a 64-character limit (CLI-observed:
 * `Member must have length less than or equal to 64`) and Anthropic further
 * requires `^[a-zA-Z0-9_-]+$`. VS Code tool names -- especially MCP tools with
 * long generated names like `activate_fallback_mcp_pylance_mcp_s_..._1` -- can
 * exceed both, and one bad name anywhere in the tool config rejects the entire
 * request.
 *
 * Unlike tool IDs, tool NAMES are semantic: the model calls a tool by this
 * name, and VS Code must receive the ORIGINAL name back or the tool invocation
 * fails to resolve. So sanitization must be paired with a reverse map
 * (see buildToolNameReverseMap) that restores the original name on the way in.
 *
 * Same proven design as sanitizeToolId (fork.7): deterministic, injective via
 * a short SHA-256 suffix of the original name, and capped at 64 chars.
 * Already-valid names pass through untouched so the common path is a no-op.
 */
const VALID_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_TOOL_NAME_LENGTH = 64;
const TOOL_NAME_HASH_LENGTH = 8;

export function sanitizeToolName(name: string): string {
  if (VALID_TOOL_NAME_PATTERN.test(name) && name.length <= MAX_TOOL_NAME_LENGTH) {
    return name;
  }

  const hash = createHash("sha256").update(name).digest("hex").slice(0, TOOL_NAME_HASH_LENGTH);
  const substituted = name.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  const prefixBudget = MAX_TOOL_NAME_LENGTH - TOOL_NAME_HASH_LENGTH - 1; // 1 for "_"
  const prefix = substituted.slice(0, prefixBudget) || "tool";
  const safe = `${prefix}_${hash}`;

  logger.debug("[Tool Converter] Sanitized tool name for Bedrock", {
    original: name,
    originalLength: name.length,
    sanitized: safe,
  });

  return safe;
}

/**
 * Build the sanitized-name -> original-name map for restoring tool names on
 * inbound tool calls. Only tools whose names actually changed are included,
 * so lookups stay cheap for the common all-valid case.
 */
export function buildToolNameReverseMap(
  tools: readonly LanguageModelChatTool[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const tool of tools ?? []) {
    const sanitized = sanitizeToolName(tool.name);
    if (sanitized !== tool.name) {
      map.set(sanitized, tool.name);
    }
  }
  return map;
}

/**
 * Convert VSCode tools to Bedrock tool configuration
 */
export function convertTools(
  options: Parameters<LanguageModelChatProvider["provideLanguageModelChatResponse"]>[2],
  modelId: string,
  extendedThinkingEnabled?: boolean,
  promptCachingEnabled?: boolean,
): bedrockRuntime.ToolConfiguration | undefined {
  if (!options.tools || options.tools.length === 0) {
    return undefined;
  }

  logger.debug(`Converting ${options.tools.length} tools for model ${modelId}`);

  const profile = getModelProfile(modelId);

  // Convert tools to Bedrock format
  // VSCode already provides tools in the correct format, we just need to wrap them
  const tools = options.tools.map(
    (tool: LanguageModelChatTool): bedrockRuntime.Tool => ({
      toolSpec: {
        description: tool.description,
        inputSchema: {
          json: convertSchema(tool.inputSchema),
        },
        name: sanitizeToolName(tool.name),
      },
    }),
  );

  // Add cache point after tool definitions if prompt caching is supported and enabled
  // This is one of three strategic cache points: after system messages,
  // after tool definitions, and after tool results (within 4-point limit)
  // promptCachingEnabled defaults to true if not specified
  const cachingEnabled = promptCachingEnabled ?? true;
  if (profile.supportsPromptCaching && cachingEnabled && tools.length > 0) {
    tools.push({ cachePoint: { type: CachePointType.DEFAULT } });
  }

  const config: bedrockRuntime.ToolConfiguration = { tools };

  // Add tool choice if supported by the model
  // CRITICAL: Cannot set tool_choice when extended thinking enabled
  // API error: "Thinking may not be enabled when tool_choice forces tool use"
  if (profile.supportsToolChoice && options.toolMode !== undefined && !extendedThinkingEnabled) {
    if (options.toolMode === LanguageModelChatToolMode.Required) {
      config.toolChoice = { any: {} } satisfies bedrockRuntime.AnyToolChoice;
    } else if (options.toolMode === LanguageModelChatToolMode.Auto) {
      config.toolChoice = { auto: {} } satisfies bedrockRuntime.AutoToolChoice;
    }
  } else if (
    profile.supportsToolChoice &&
    options.toolMode !== undefined &&
    extendedThinkingEnabled
  ) {
    logger.debug("[Tool Converter] Skipping tool_choice (incompatible with extended thinking)", {
      requestedMode: options.toolMode,
    });
  }

  logger.debug("Tool configuration created successfully");
  return config;
}
