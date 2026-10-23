import { useCallback, useEffect, useState } from "react";
import type { ProjectGroupRecord } from "@pi-desktop/shared";
import { api } from "../lib/api";

/** Load Host-verified display membership without changing active workspaces. */
export function useProjectMemoryGroups(scope: string) {
  const [groups, setGroups] = useState<ProjectGroupRecord[]>([]);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let current = true;
    void api.listProjectGroups().then(({ groups: next }) => {
      if (current) setGroups(next);
    }).catch(() => {
      if (!current) return;
      setGroups([]);
      console.warn("Project memory grouping is unavailable; retaining checkout rows");
    });
    return () => { current = false; };
  }, [scope, revision]);
  return { groups, refresh };
}
