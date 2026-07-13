import * as vscode from "vscode";

import { manageSettings } from "./commands/manage-settings";
import { logger } from "./logger";
import { BedrockChatModelProvider } from "./provider";
import { statusBar } from "./status-bar";

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("AWS Bedrock for Copilot", { log: true });
  logger.initialize(outputChannel, context.extensionMode);

  // Log activation message with debugging tips
  logger.info(
    "AWS Bedrock for Copilot extension activated. For verbose debugging, set log level to Debug via the output channel dropdown menu.",
  );

  // Proposed-API sanity check. registerLanguageModelChatProvider is a proposed
  // (unstable) VS Code API. A VS Code update can rename or remove it without a
  // deprecation cycle. If it is missing, fail loudly with an actionable message
  // instead of a cryptic "x is not a function" deep in activation. See
  // repo memory: proposed API = rebuild + retest after each VS Code update.
  if (typeof vscode.lm?.registerLanguageModelChatProvider !== "function") {
    const msg =
      "AWS Bedrock for Copilot: this VS Code build does not expose " +
      "vscode.lm.registerLanguageModelChatProvider (a proposed API this extension " +
      `depends on). VS Code version: ${vscode.version}. The extension may need to be ` +
      "rebuilt against a newer proposed API. Models will not appear in the picker.";
    logger.error(msg);
    void vscode.window.showErrorMessage(msg);
    return;
  }

  const provider = new BedrockChatModelProvider(context.secrets, context.globalState);

  // Status bar activity indicator (auto-hides when idle). Clicking it opens the
  // manage command for quick access to settings.
  statusBar.initialize({
    command: "aws-bedrock-for-copilot.manage",
    enabled:
      vscode.workspace.getConfiguration("aws-bedrock-for-copilot").get<boolean>("showStatusBar") ??
      true,
    label: "Bedrock",
  });

  // Register provider and ensure it is disposed with the extension
  const providerDisposable = vscode.lm.registerLanguageModelChatProvider(
    "aws-bedrock-for-copilot",
    provider,
  );
  const manageCmdDisposable = vscode.commands.registerCommand(
    "aws-bedrock-for-copilot.manage",
    async () => {
      await manageSettings(context.secrets, context.globalState);
    },
  );

  // Refresh provider model list when relevant things change so UI updates immediately
  const cfgDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("aws-bedrock-for-copilot.showStatusBar")) {
      statusBar.setEnabled(
        vscode.workspace
          .getConfiguration("aws-bedrock-for-copilot")
          .get<boolean>("showStatusBar") ?? true,
      );
    }
    if (
      e.affectsConfiguration("aws-bedrock-for-copilot.region") ||
      e.affectsConfiguration("aws-bedrock-for-copilot.profile") ||
      e.affectsConfiguration("aws-bedrock-for-copilot.preferredModel") ||
      e.affectsConfiguration("aws-bedrock-for-copilot.promptCaching.enabled") ||
      e.affectsConfiguration("aws-bedrock-for-copilot.reasoningEffort") ||
      e.affectsConfiguration("aws-bedrock-for-copilot.contextSafetyMargin") ||
      e.affectsConfiguration("aws-bedrock-for-copilot.showDeprecatedModels") ||
      e.affectsConfiguration("aws-bedrock-for-copilot.anthropic.thinking.enabled") ||
      e.affectsConfiguration("aws-bedrock-for-copilot.anthropic.thinking.budgetTokens") ||
      e.affectsConfiguration("aws-bedrock-for-copilot.anthropic.thinking.effort") ||
      e.affectsConfiguration("aws-bedrock-for-copilot.anthropic.context1M.enabled") ||
      e.affectsConfiguration(
        "aws-bedrock-for-copilot.anthropic.inferenceProfiles.preferRegional",
      ) ||
      // Legacy (pre-namespace) keys -- still honored for backward compatibility
      e.affectsConfiguration("aws-bedrock-for-copilot.thinking.enabled") ||
      e.affectsConfiguration("aws-bedrock-for-copilot.thinking.budgetTokens") ||
      e.affectsConfiguration("aws-bedrock-for-copilot.thinking.effort") ||
      e.affectsConfiguration("aws-bedrock-for-copilot.context1M.enabled") ||
      e.affectsConfiguration("aws-bedrock-for-copilot.inferenceProfiles.preferRegional") ||
      e.affectsConfiguration("github.copilot.chat.anthropic.thinking.enabled") ||
      e.affectsConfiguration("github.copilot.chat.anthropic.thinking.maxTokens")
    ) {
      provider.notifyModelInformationChanged("configuration changed");
    }
  });

  // Debounce secrets changes: this event is global and fires on any secret update
  // across the workspace (all extensions); cannot filter by key. Debounce to
  // coalesce rapid or unrelated updates into a single refresh.
  let secretsRefreshHandle: ReturnType<typeof setTimeout> | undefined;
  const secretsDisposable = context.secrets.onDidChange(() => {
    if (secretsRefreshHandle) {
      clearTimeout(secretsRefreshHandle);
    }
    secretsRefreshHandle = setTimeout(() => {
      provider.notifyModelInformationChanged("secrets changed (debounced)");
      secretsRefreshHandle = undefined;
    }, 400);
  });

  // Clear any pending debounce timer on extension dispose to prevent firing after cleanup
  const secretsDebounceDisposable = new vscode.Disposable(() => {
    if (secretsRefreshHandle) {
      clearTimeout(secretsRefreshHandle);
      secretsRefreshHandle = undefined;
    }
  });

  // When user selects/deselects models in the global quick pick, refresh the list.
  // However, we need to skip events during the initial model fetch to avoid feedback loops:
  // 1. Extension activates → 2. Provider returns models → 3. VS Code fires onDidChangeChatModels →
  // 4. If we immediately refresh, model IDs may differ (due to profile accessibility tests) →
  // 5. This can cause the user's model selection to be lost
  //
  // We use the provider's isInitialFetchComplete() flag to know when the first fetch is done,
  // and only respond to subsequent onDidChangeChatModels events (user-initiated changes).
  let lmRefreshHandle: ReturnType<typeof setTimeout> | undefined;

  const lmDisposable = vscode.lm.onDidChangeChatModels(() => {
    // Skip events until the initial model fetch is complete to avoid feedback loops
    if (!provider.isInitialFetchComplete()) {
      logger.debug("[Extension] Ignoring onDidChangeChatModels before initial fetch complete");
      return;
    }

    // Debounce to coalesce rapid changes
    if (lmRefreshHandle) {
      clearTimeout(lmRefreshHandle);
    }
    lmRefreshHandle = setTimeout(() => {
      provider.notifyModelInformationChanged("selected chat models changed");
      lmRefreshHandle = undefined;
    }, 500);
  });

  // Clear any pending lm refresh timer on extension dispose
  const lmDebounceDisposable = new vscode.Disposable(() => {
    if (lmRefreshHandle) {
      clearTimeout(lmRefreshHandle);
      lmRefreshHandle = undefined;
    }
  });

  context.subscriptions.push(
    outputChannel,
    { dispose: () => statusBar.dispose() },
    provider,
    providerDisposable,
    manageCmdDisposable,
    cfgDisposable,
    secretsDisposable,
    secretsDebounceDisposable,
    lmDisposable,
    lmDebounceDisposable,
  );
}

export function deactivate() {
  logger.trace("deactivate called");
}
