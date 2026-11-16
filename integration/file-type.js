// The type of an upload by its first bytes, never by the client's Content-Type or file name: PNG, JPEG, GIF, WebP
// or PDF, the formats SurveyJS Server's isSupportedDocument() accepts (it finds %PDF in the first 4 KB, as here).
// Used by store-files and extract-from-paper.

/** "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", or null for anything else. */
export function detectType(bytes) {
  const startsWith = (signature, offset = 0) =>
    bytes.subarray(offset, offset + signature.length).toString("latin1") === signature;
  if (startsWith("\x89PNG\r\n\x1a\n")) return "image/png";
  if (startsWith("\xFF\xD8\xFF")) return "image/jpeg";
  if (startsWith("GIF87a") || startsWith("GIF89a")) return "image/gif";
  if (startsWith("RIFF") && startsWith("WEBP", 8)) return "image/webp";
  if (bytes.subarray(0, 4096).includes("%PDF")) return "application/pdf";
  return null;
}
