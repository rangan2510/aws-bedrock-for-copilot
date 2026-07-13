import * as vscode from "vscode";

/**
 * Status bar activity indicator.
 *
 * Shows transient activity for this extension in the VS Code status bar:
 * - Reading the model list on startup / refresh
 * - Streaming a response (with a live token estimate)
 * - Auth / account errors and stream errors
 *
 * The item auto-hides when there is no activity, so when several providers are
 * installed only the one currently doing work is visible. A short "done" / error
 * flash is shown after a request completes, then the item hides again.
 *
 * Mirrors the singleton pattern of `logger`. Created and disposed in
 * `extension.ts`; call sites are the provider (request lifecycle) and the
 * stream processor (token increments).
 */
class StatusBar {
  /** Number of in-flight streaming requests (VS Code can run several at once). */
  private activeRequests = 0;
  /** Whether the model list is currently being fetched. */
  private readingModels = false;
  /** Running token estimate for the current burst of streaming activity. */
  private streamedTokens = 0;
  /** Whether the user has enabled the status bar (config-driven). */
  private enabled = true;
  private item: undefined | vscode.StatusBarItem;
  /** Handle for the timed revert-to-hidden after a done/error flash. */
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  /** Vendor label shown in the status bar (e.g. "Bedrock"). */
  private label = "Bedrock";

  /**
   * Initialize the status bar item. Safe to call once from activation.
   * @param command Optional command id to run when the item is clicked.
   */
  initialize(options: { command?: string; enabled: boolean; label: string }): void {
    this.label = options.label;
    this.enabled = options.enabled;
    if (!this.item) {
      this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
      if (options.command) {
        this.item.command = options.command;
      }
    }
    // Start hidden; only shows on activity.
    this.item.hide();
  }

  /** Update the enabled state at runtime (config change). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.item?.hide();
    }
  }

  /** Signal that the model list is being fetched. */
  startReadingModels(): void {
    this.readingModels = true;
    this.render(
      "$(sync~spin)",
      `${this.label}: reading models`,
      `${this.label} for Copilot -- fetching the available model list`,
    );
  }

  /** Signal that model fetch finished (success). Hides unless a stream is active. */
  finishReadingModels(modelCount?: number): void {
    this.readingModels = false;
    if (this.activeRequests > 0) {
      // A request already started; keep showing streaming state.
      this.renderStreaming();
      return;
    }
    const detail = typeof modelCount === "number" ? ` (${modelCount})` : "";
    this.flash(
      "$(check)",
      `${this.label}: models ready${detail}`,
      `${this.label} for Copilot -- model list loaded`,
    );
  }

  /** Signal a startup/auth/account error while reading models or configuring. */
  reportAccountError(message: string): void {
    this.readingModels = false;
    this.flash(
      "$(error)",
      `${this.label}: account error`,
      `${this.label} for Copilot -- ${message}`,
      6000,
    );
  }

  /** Begin a streaming request. Reference-counted for concurrency. */
  startRequest(): void {
    this.activeRequests++;
    if (this.activeRequests === 1) {
      // Reset the token counter at the start of a fresh burst.
      this.streamedTokens = 0;
    }
    this.renderStreaming();
  }

  /** Add to the running token estimate during streaming. */
  addTokens(tokens: number): void {
    if (tokens <= 0) {
      return;
    }
    this.streamedTokens += tokens;
    if (this.activeRequests > 0) {
      this.renderStreaming();
    }
  }

  /**
   * Record the provider's exact output-token usage (e.g. from a Bedrock
   * metadata event). Snaps the displayed counter to the exact value.
   */
  setExactOutputTokens(tokens: number): void {
    if (tokens <= 0) {
      return;
    }
    this.streamedTokens = tokens;
    if (this.activeRequests > 0) {
      this.renderStreaming();
    }
  }

  /**
   * Finish a streaming request. Reference-counted: the "done" flash only shows
   * once all concurrent requests complete.
   * @param exactOutputTokens If the provider has an exact usage count, snap to it.
   */
  finishRequest(exactOutputTokens?: number): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    if (typeof exactOutputTokens === "number" && exactOutputTokens > 0) {
      this.streamedTokens = exactOutputTokens;
    }
    if (this.activeRequests > 0) {
      this.renderStreaming();
      return;
    }
    this.flash(
      "$(check)",
      `${this.label}: ${this.formatTokens(this.streamedTokens)} tokens`,
      `${this.label} for Copilot -- response complete (${this.formatTokens(
        this.streamedTokens,
      )} output tokens, estimated)`,
    );
  }

  /** Report a stream error. Decrements the active count and flashes an error. */
  errorRequest(message?: string): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.flash(
      "$(warning)",
      `${this.label}: stream error`,
      `${this.label} for Copilot -- ${message ?? "the response stream failed"}`,
      6000,
    );
  }

  dispose(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = undefined;
    }
    this.item?.dispose();
    this.item = undefined;
  }

  private renderStreaming(): void {
    const tokens =
      this.streamedTokens > 0 ? ` \u00b7 ${this.formatTokens(this.streamedTokens)} tok` : "";
    this.render(
      "$(sync~spin)",
      `${this.label}: streaming${tokens}`,
      `${this.label} for Copilot -- streaming a response (${this.formatTokens(
        this.streamedTokens,
      )} tokens so far, estimated)`,
    );
  }

  /** Render a persistent state (no auto-hide). */
  private render(icon: string, text: string, tooltip: string): void {
    if (!this.enabled || !this.item) {
      return;
    }
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = undefined;
    }
    this.item.text = `${icon} ${text}`;
    this.item.tooltip = tooltip;
    this.item.show();
  }

  /** Render a transient state that reverts to hidden after `ms`. */
  private flash(icon: string, text: string, tooltip: string, ms = 3000): void {
    if (!this.enabled || !this.item) {
      return;
    }
    this.item.text = `${icon} ${text}`;
    this.item.tooltip = tooltip;
    this.item.show();
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
    }
    this.hideTimer = setTimeout(() => {
      // Only hide if nothing else became active in the meantime.
      if (this.activeRequests === 0 && !this.readingModels) {
        this.item?.hide();
      }
      this.hideTimer = undefined;
    }, ms);
  }

  private formatTokens(n: number): string {
    return new Intl.NumberFormat("en-US").format(Math.round(n));
  }
}

export const statusBar = new StatusBar();
