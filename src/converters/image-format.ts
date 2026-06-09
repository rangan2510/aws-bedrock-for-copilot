/**
 * Image format detection from magic-byte signatures.
 *
 * Background:
 * VS Code's chat surface gives extensions an `ImageDataPart`-like shape with
 * a `mimeType` field and a `data` (Uint8Array) field. The `mimeType` field
 * comes from whatever produced the part -- the chat UI, the clipboard, a
 * paste handler, or another extension. It is not always accurate. In
 * particular, when users paste a screenshot on Windows, the OS clipboard
 * frequently routes the bytes as PNG even when the source file was JPEG (or
 * vice versa), so the declared MIME and the actual bytes disagree.
 *
 * Bedrock's Converse API rejects this mismatch with:
 *   ValidationException: messages.<i>.content.<j>.image.source.base64:
 *   The image was specified using the image/jpeg media type, but the image
 *   appears to be a image/png image
 *
 * This module sniffs the actual format from the well-known magic-byte
 * signatures so we can normalise the part before sending it.
 */

/** Bedrock-accepted image format identifiers. */
export type BedrockImageFormat = "png" | "jpeg" | "gif" | "webp";

/**
 * Detect the actual image format by inspecting the leading bytes of `data`.
 * Returns `undefined` if the bytes don't match any known signature.
 *
 * Magic numbers (RFC 2046 / IANA registrations):
 * - PNG : 89 50 4E 47 0D 0A 1A 0A
 * - JPEG: FF D8 FF
 * - GIF : 47 49 46 38 (GIF8 -- both 87a and 89a sub-versions)
 * - WebP: 52 49 46 46 (RIFF) at 0, then 57 45 42 50 (WEBP) at offset 8
 */
export function detectImageFormat(data: Uint8Array): BedrockImageFormat | undefined {
  if (data.length < 4) {
    return undefined;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return "png";
  }

  // JPEG: FF D8 FF
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "jpeg";
  }

  // GIF: 47 49 46 38 (GIF8)
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
    return "gif";
  }

  // WebP: RIFF........WEBP
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return "webp";
  }

  return undefined;
}

/**
 * Map a declared image MIME type subtype (lowercase) to a Bedrock format.
 * Returns `undefined` for anything Bedrock doesn't accept.
 */
export function declaredFormatToBedrock(subtype: string): BedrockImageFormat | undefined {
  const s = subtype.toLowerCase();
  if (s === "png") return "png";
  if (s === "jpeg" || s === "jpg") return "jpeg";
  if (s === "gif") return "gif";
  if (s === "webp") return "webp";
  return undefined;
}
