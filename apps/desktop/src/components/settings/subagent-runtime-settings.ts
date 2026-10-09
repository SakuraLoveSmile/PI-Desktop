import { isValidSubagentLimit, type AppSettings, type SubagentLimitField } from "@pi-desktop/shared";
import { api } from "../../lib/api";

/** Persist only the edited preference, then reload the Host-confirmed settings. */
export async function persistSubagentLimit(
  field: SubagentLimitField,
  draft: string,
): Promise<AppSettings | null> {
  if (!draft.trim()) return null;
  const value = Number(draft);
  if (!isValidSubagentLimit(field, value)) return null;
  await api.setSettings({ [field]: value });
  return api.getSettings();
}
