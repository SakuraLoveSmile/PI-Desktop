/** Detect an attempted textual tool call only at the visible, unfenced reply tail. */
export function endsWithPseudoToolCall(response: string): boolean {
  let fence: { marker: string; length: number } | undefined;
  const visible = response.split("\n").map(line => {
    const delimiter = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (delimiter && delimiter[1][0] === fence.marker &&
          delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = undefined;
      return "\0";
    }
    if (delimiter) {
      fence = { marker: delimiter[1][0], length: delimiter[1].length };
      return "\0";
    }
    return line;
  }).join("\n").trimEnd();
  // Fence markers remain trailing content even when their bodies are hidden.
  if (!response.trimEnd().endsWith("}")) return false;
  for (const match of visible.matchAll(/\bcall:[\w.-]+:[\w.-]+\s*\{/g)) {
    let depth = 1;
    let quote: string | undefined;
    let escaped = false;
    for (let index = match.index + match[0].length; index < visible.length; index += 1) {
      const char = visible[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = undefined;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === "{") depth += 1;
      else if (char === "}" && --depth === 0) {
        if (index === visible.length - 1) return true;
        break;
      }
    }
  }
  return false;
}

export const PSEUDO_TOOL_CALL_NUDGE = [
  "<pseudo_tool_call_recovery>",
  "Your previous reply ended with call:... text but did not invoke a tool.",
  "Use the tool-calling interface to invoke that tool, or give a normal final answer.",
  "</pseudo_tool_call_recovery>",
].join("\n");
