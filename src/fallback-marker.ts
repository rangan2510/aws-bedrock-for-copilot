/**
 * Sentinel-marked fallback messages.
 *
 * Background:
 * The stream processor emits user-friendly fallback text when the model
 * returns no usable content (empty stream, malformed tool call, MAX_TOKENS
 * on thinking, etc.). VS Code stores these emitted text parts in the chat
 * history and replays the entire history on every subsequent turn.
 *
 * Without a marker, those fallbacks are sent back to the model verbatim
 * as prior assistant turns, where they act as few-shot examples teaching
 * the model to imitate the fallback wording on later genuinely-empty
 * end_turns. Users then see real-looking responses such as
 *   "*(The model returned an empty response. Please try again or rephrase
 *     your request.)*"
 * even when no fallback gate fired -- it is the model echoing its own
 * (poisoned) history.
 *
 * Mitigation:
 * Wrap every fallback string with an invisible Unicode sentinel
 * (\u200B = zero-width space, \u2063 = invisible separator). The sentinel
 * is rendered as nothing in the UI but lets the message converter detect
 * and skip these parts when replaying assistant history to Bedrock.
 *
 * The wrapped text remains a valid `LanguageModelTextPart`; we just refuse
 * to forward it back to the model on the next turn.
 */

/**
 * Invisible sentinel placed at the start of every fallback message we emit.
 *
 * Order: ZERO WIDTH SPACE (U+200B), INVISIBLE SEPARATOR (U+2063), ZERO WIDTH SPACE.
 * Highly unlikely to appear naturally in either user input or model output
 * and renders as zero pixels in every monospace font VS Code uses.
 */
export const FALLBACK_SENTINEL = "\u200B\u2063\u200B";

/**
 * Known fallback message bodies emitted in earlier extension versions
 * (before we marked them with a sentinel). Stripping these by exact match
 * lets users recover from already-poisoned conversations without having to
 * start a new chat.
 */
export const LEGACY_FALLBACK_BODIES: readonly string[] = [
  "*(The model produced only internal reasoning, but the thinking display is not supported in this environment. Please try again or rephrase your request.)*",
  "*(The model exhausted its token budget on internal reasoning without producing a visible response. This can happen in long conversations. Please try starting a new conversation or rephrasing your request.)*",
  "*(The model returned an empty response. Please try again or rephrase your request.)*",
  "*(The model attempted a tool call but the response could not be processed. This model may have limited tool calling support. Please try again or use a different model.)*",
  "*(The model produced a malformed tool call that could not be parsed. This is often transient -- please try again or rephrase your request.)*",
  "*(The model produced a malformed output that could not be parsed. This is often transient -- please try again or rephrase your request.)*",
  "*(The server closed the streaming connection without sending any data. This can happen with very large requests or transient AWS Bedrock issues. Please try again, or start a new conversation if the problem persists.)*",
  "*(The model did not produce a response. Please try again or rephrase your request.)*",
];

const LEGACY_FALLBACK_SET = new Set(LEGACY_FALLBACK_BODIES.map((s) => s.trim()));

/**
 * Wrap a fallback message body with the sentinel so it can be filtered out
 * of subsequent assistant turns.
 */
export function wrapFallback(body: string): string {
  return `${FALLBACK_SENTINEL}${body}`;
}

/**
 * Returns true if `text` is one of our fallback messages -- either the
 * current sentinel-marked form, or a legacy unmarked form emitted by a
 * previous extension version.
 *
 * Used by the message converter to skip these parts when replaying the
 * assistant history back to Bedrock, breaking the self-reinforcing loop.
 */
export function isFallback(text: string): boolean {
  if (text.startsWith(FALLBACK_SENTINEL)) {
    return true;
  }
  // Catch any sentinel anywhere in the leading whitespace, to be tolerant
  // of accidental prefixing by the chat UI.
  if (text.trimStart().startsWith(FALLBACK_SENTINEL)) {
    return true;
  }
  // Recover from already-poisoned conversations created by earlier versions.
  return LEGACY_FALLBACK_SET.has(text.trim());
}
