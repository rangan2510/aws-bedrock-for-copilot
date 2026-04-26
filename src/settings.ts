import * as vscode from "vscode";
import { getProfileRegion } from "./aws-profiles";

/**
 * Settings helper that reads configuration with priority order:
 * 1. VSCode workspace settings (.vscode/settings.json)
 * 2. VSCode user settings (global)
 * 3. GlobalState (for backward compatibility)
 * 4. Profile configuration (for region)
 * 5. Environment variables (for region)
 * 6. Default value
 */

export interface BedrockSettings {
  context1M: {
    enabled: boolean;
  };
  inferenceProfiles: {
    preferRegional: boolean;
  };
  preferredModel: string | undefined;
  profile: string | undefined;
  promptCaching: {
    enabled: boolean;
  };
  /**
   * `reasoning_effort` value sent to non-Anthropic models that support it
   * (OpenAI gpt-oss, DeepSeek V3.2, Moonshot Kimi, Qwen3, GLM, MiniMax).
   */
  reasoningEffort: ReasoningEffort;
  region: string;
  thinking: {
    budgetTokens: number;
    effort: ThinkingEffort;
    enabled: boolean;
  };
}

/**
 * Thinking effort level for Anthropic adaptive-thinking models (Opus 4.6, 4.7, Sonnet 4.6).
 * Controls how eager Claude is about spending tokens when responding.
 * - "low": Most efficient -- significant token savings with some capability reduction
 * - "medium": Balanced approach with moderate token savings
 * - "high" (default): Maximum capability with no constraints (equivalent to omitting effort)
 * - "xhigh": Extended capability for long-horizon work (Opus 4.7 only)
 * - "max": Absolute maximum capability (Opus 4.6, 4.7, Sonnet 4.6 only)
 *
 * Note: Bedrock gates xhigh and max per-model. Unsupported levels fall back to "high".
 */
export type ThinkingEffort = "high" | "low" | "max" | "medium" | "xhigh";

/**
 * Reasoning effort for non-Anthropic models that accept the OpenAI-style
 * `reasoning_effort` field via additionalModelRequestFields.
 * - "minimal": OpenAI gpt-oss only -- silently rejected by other vendors (we'd downgrade to "low")
 * - "low" / "medium" / "high": Standard tiers
 */
export type ReasoningEffort = "high" | "low" | "medium" | "minimal";

/**
 * Get Bedrock settings with priority order
 */
export async function getBedrockSettings(globalState: vscode.Memento): Promise<BedrockSettings> {
  const config = vscode.workspace.getConfiguration("aws-bedrock-for-copilot");

  // Read profile first (needed for region resolution)
  // Note: null in config means "use default credentials", so we check inspect() for undefined
  const profileInspect = config.inspect<null | string>("profile");
  let profile: string | undefined;

  if (profileInspect?.workspaceValue !== undefined) {
    // Workspace setting takes precedence
    profile = profileInspect.workspaceValue ?? undefined;
  } else if (profileInspect?.globalValue === undefined) {
    // Fall back to globalState for backward compatibility
    profile = globalState.get<string>("bedrock.profile");
  } else {
    // User setting takes precedence over globalState
    profile = profileInspect.globalValue ?? undefined;
  }

  // Read region with priority: workspace > user > globalState > profile config > env vars > default
  const region: string =
    config.get<string>("region") ??
    globalState.get<string>("bedrock.region") ??
    (profile ? await getProfileRegion(profile) : undefined) ??
    process.env.AWS_DEFAULT_REGION ??
    process.env.AWS_REGION ??
    "us-east-1";

  // Read preferred model with priority: workspace > user > globalState > default
  const preferredModelInspect = config.inspect<null | string>("preferredModel");
  let preferredModel: string | undefined;

  if (preferredModelInspect?.workspaceValue !== undefined) {
    preferredModel = preferredModelInspect.workspaceValue ?? undefined;
  } else if (preferredModelInspect?.globalValue === undefined) {
    // No globalState fallback for preferredModel as it's a new setting
    preferredModel = undefined;
  } else {
    preferredModel = preferredModelInspect.globalValue ?? undefined;
  }

  // Read Anthropic-namespaced settings with backward-compat fallback to the
  // pre-namespace flat keys (so users who set `thinking.effort` keep working).
  const context1MEnabled =
    config.get<boolean>("anthropic.context1M.enabled") ??
    config.get<boolean>("context1M.enabled") ??
    true;

  const promptCachingEnabled = config.get<boolean>("promptCaching.enabled") ?? true;

  const preferRegionalInferenceProfiles =
    config.get<boolean>("anthropic.inferenceProfiles.preferRegional") ??
    config.get<boolean>("inferenceProfiles.preferRegional") ??
    false;

  // Check GitHub Copilot's anthropic thinking settings first, then namespaced, then legacy
  const copilotConfig = vscode.workspace.getConfiguration("github.copilot.chat.anthropic");
  const copilotThinkingEnabled = copilotConfig.get<boolean>("thinking.enabled");
  const copilotThinkingMaxTokens = copilotConfig.get<number>("thinking.maxTokens");

  const thinkingEnabled =
    copilotThinkingEnabled ??
    config.get<boolean>("anthropic.thinking.enabled") ??
    config.get<boolean>("thinking.enabled") ??
    true;
  const thinkingBudgetTokens =
    copilotThinkingMaxTokens ??
    config.get<number>("anthropic.thinking.budgetTokens") ??
    config.get<number>("thinking.budgetTokens") ??
    10_000;

  // Anthropic thinking effort (default "high")
  const validEffortValues: ThinkingEffort[] = ["high", "low", "max", "medium", "xhigh"];
  const rawEffort =
    config.get<string>("anthropic.thinking.effort") ?? config.get<string>("thinking.effort");
  const thinkingEffort: ThinkingEffort =
    rawEffort && validEffortValues.includes(rawEffort as ThinkingEffort)
      ? (rawEffort as ThinkingEffort)
      : "high";

  // Non-Anthropic reasoning_effort (default "high")
  const validReasoningValues: ReasoningEffort[] = ["high", "low", "medium", "minimal"];
  const rawReasoning = config.get<string>("reasoningEffort");
  const reasoningEffort: ReasoningEffort =
    rawReasoning && validReasoningValues.includes(rawReasoning as ReasoningEffort)
      ? (rawReasoning as ReasoningEffort)
      : "high";

  return {
    context1M: {
      enabled: context1MEnabled,
    },
    inferenceProfiles: {
      preferRegional: preferRegionalInferenceProfiles,
    },
    preferredModel,
    profile,
    promptCaching: {
      enabled: promptCachingEnabled,
    },
    reasoningEffort,
    region,
    thinking: {
      budgetTokens: Math.max(1024, thinkingBudgetTokens),
      effort: thinkingEffort,
      enabled: thinkingEnabled,
    },
  };
}

/**
 * Update Bedrock settings in both workspace configuration and globalState
 * @param target - ConfigurationTarget (Workspace or Global)
 * @param globalState - VSCode global state for backward compatibility
 */
export async function updateBedrockSettings(
  setting: "preferredModel" | "profile" | "region",
  value: string | undefined,
  target: vscode.ConfigurationTarget,
  globalState: vscode.Memento,
): Promise<void> {
  const config = vscode.workspace.getConfiguration("aws-bedrock-for-copilot");

  // Update VSCode settings
  await config.update(setting, value, target);

  // Also update globalState for backward compatibility
  // Only do this for region and profile, not preferredModel (new setting)
  if (setting === "region" || setting === "profile") {
    await globalState.update(`bedrock.${setting}`, value);
  }
}
