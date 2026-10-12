import { expect, it } from "vitest";
import { endsWithPseudoToolCall } from "./pseudo-tool-call.js";

it.each([
  ["...!call:default_api:ProjectHistory{action:search,query:只要有 remote_file_id}", true],
  ["Searching\ncall:default_api:ProjectHistory{action:search}\n ", true],
  ['call:default_api:ProjectHistory{"query":"literal } brace", "nested":{"key":1}}', true],
  ["The work is complete.", false],
  ["call:default_api:ProjectHistory{action:search}\nThis is only a syntax example.", false],
  ["```text\ncall:default_api:ProjectHistory{action:search}\n```", false],
  ["```text\ncall:default_api:ProjectHistory{action:search}", false],
  ["~~~\ncall:default_api:ProjectHistory{action:search}", false],
  ["call:default_api:ProjectHistory{action:search}\n```\n{example}", false],
  ["~~~\ncall:default_api:ProjectHistory{action:search}\n~~~\nThe report is complete.", false],
  ["`call:default_api:ProjectHistory{action:search}`", false],
  ["call:default_api:ProjectHistory{action:search", false],
  ["call:default_api:ProjectHistory{action:search} explanation {more:info}", false],
  ["```\nAn example.\n```\ncall:default_api:ProjectHistory{action:search}", true],
  ["recall:default_api:ProjectHistory{action:search}", false],
])("detects only a complete pseudo call at the unfenced reply tail: %s", (text, expected) => {
  expect(endsWithPseudoToolCall(text)).toBe(expected);
});
