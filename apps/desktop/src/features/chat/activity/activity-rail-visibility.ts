/** What the rail has to show, as counts and flags; the notices are the ones that matter (a "still loading" hint is not one). */
export type ActivityRailContent = {
  goals: number; plans: number; agents: number; teamMembers: number; processes: number; outputs: number; sources: number;
  /** Running processes that announced a local address; the Servers section lists them apart from the processes. */
  servers: number;
  /** An unsupported host, a failed process list or an open process detail: shown in place of process rows. */
  processesNotice: boolean;
  teamNotice: boolean;
  /** The whole-session activity notice (failed or partial) for the sub-agents, and for the outputs and sources. */
  agentsNotice: boolean;
  resourcesNotice: boolean;
  /** Only part of the transcript is loaded, so the rail says so. */
  rangeNotice: boolean;
  suggestions: boolean;
  /** The skills section has references or suggestions to list; without them it only offers to propose some. */
  suggestionsHaveRows: boolean;
};

export type ActivityRailVisibility = {
  goals: boolean; plans: boolean; live: boolean; artifacts: boolean; skills: boolean;
  team: boolean; processes: boolean;
  /** Nothing to show anywhere: the live section stays, with one line saying what will appear in it. */
  emptyHint: boolean;
};

/** An empty group or section is left out; only a rail with nothing at all keeps one hint line. */
export function activityRailVisibility(content: ActivityRailContent): ActivityRailVisibility {
  const team = content.teamMembers > 0 || content.teamNotice;
  const processes = content.processes > 0 || content.processesNotice;
  const live = content.agents > 0 || team || processes || content.agentsNotice || content.rangeNotice;
  const artifacts = content.outputs > 0 || content.sources > 0 || content.resourcesNotice;
  const anything = content.goals > 0 || content.plans > 0 || content.servers > 0 || live || artifacts || (content.suggestions && content.suggestionsHaveRows);
  return {
    goals: content.goals > 0, plans: content.plans > 0, live: live || !anything, artifacts, skills: content.suggestions,
    team, processes, emptyHint: !anything,
  };
}
