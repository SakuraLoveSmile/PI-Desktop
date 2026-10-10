import type { SessionSkillSuggestion } from "./session-skill-suggestions";

export const SKILL_SUGGESTION_PREFERENCES_KEY = "pi-desktop:skill-suggestion-preferences:v1";
export const MAX_IGNORED_SKILL_SUGGESTIONS = 200;

export type IgnoredSkillSuggestion = {
  sessionId: string;
  messageId: string;
  name: string;
  fingerprint: string;
};
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

/** A stable UI identity; it is never used as a security or content-integrity check. */
export function skillSuggestionIdentity(sessionId: string, messageId: string, suggestion: SessionSkillSuggestion): IgnoredSkillSuggestion {
  const text = JSON.stringify([suggestion.name, suggestion.description, suggestion.body]);
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second, 33) ^ code;
  }
  return { sessionId, messageId, name: suggestion.name, fingerprint: `${text.length}:${first >>> 0}:${second >>> 0}` };
}

function validEntry(value: unknown): value is IgnoredSkillSuggestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return Object.keys(entry).length === 4 && ["sessionId", "messageId", "name", "fingerprint"].every((key) =>
    typeof entry[key] === "string" && entry[key].length > 0 && entry[key].length <= 2048) &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name as string) &&
    /^\d+:\d+:\d+$/.test(entry.fingerprint as string);
}

export function readIgnoredSkillSuggestions(storage: PreferenceStorage): IgnoredSkillSuggestion[] {
  const raw = storage.getItem(SKILL_SUGGESTION_PREFERENCES_KEY);
  if (raw === null) return [];
  if (raw.length > 1024 * 1024) throw new Error("Invalid skill suggestion preferences");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid skill suggestion preferences");
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.ignored) || record.ignored.length > MAX_IGNORED_SKILL_SUGGESTIONS ||
    !record.ignored.every(validEntry)) throw new Error("Invalid skill suggestion preferences");
  return record.ignored;
}

export function isSkillSuggestionIgnored(entries: IgnoredSkillSuggestion[], identity: IgnoredSkillSuggestion): boolean {
  return entries.some((entry) => entry.sessionId === identity.sessionId && entry.messageId === identity.messageId &&
    entry.name === identity.name && entry.fingerprint === identity.fingerprint);
}

/** Persist before removing the row so a failed write cannot appear successful. */
export function ignoreSkillSuggestion(storage: PreferenceStorage, identity: IgnoredSkillSuggestion): IgnoredSkillSuggestion[] {
  if (!validEntry(identity)) throw new Error("Invalid skill suggestion identity");
  const entries = readIgnoredSkillSuggestions(storage).filter((entry) => !isSkillSuggestionIgnored([entry], identity));
  const ignored = [...entries, identity].slice(-MAX_IGNORED_SKILL_SUGGESTIONS);
  storage.setItem(SKILL_SUGGESTION_PREFERENCES_KEY, JSON.stringify({ version: 1, ignored }));
  return ignored;
}
