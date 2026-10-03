import i18n from "i18next";
import type {
  AskToolResolution,
  PlanResolveRequest,
  PlanRevisionIntentInput,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import {
  headAsk,
  removeAsk,
} from "../../lib/pending-asks";
import {
  headPermission,
  removePermission,
} from "../../lib/pending-permissions";
import type { AppState } from "../app-state";
import type { InteractionRuntime } from "../runtime/interaction-runtime";
import type { SessionRuntime } from "../runtime/session-runtime";
import type { StoreAccess } from "./types";

const PLAN_APPROVAL_TIMEOUT = "PLAN_APPROVAL_TIMEOUT";
const TOAST_DURATION_MS = 4000;
const TOAST_ERROR_DURATION_MS = 8000;
const TOAST_STACK_LIMIT = 4;

export type InteractionSliceDependencies = StoreAccess & {
  runtime: SessionRuntime;
  interactionRuntime: InteractionRuntime;
};

export function createInteractionSlice({
  get,
  set,
  runtime,
  interactionRuntime,
}: InteractionSliceDependencies): Pick<
  AppState,
  | "setPage"
  | "setSettingsTab"
  | "setSettingsAnchor"
  | "canNavBack"
  | "canNavForward"
  | "navBack"
  | "navForward"
  | "resolvePermission"
  | "resolveAsk"
  | "resolvePlan"
  | "revisePlan"
  | "convertPlanToGoal"
  | "retryPlanRevision"
  | "cancelPlanConversion"
  | "runMissedPlan"
  | "cancelScheduledPlan"
  | "showToast"
  | "dismissToast"
  | "dismissAssistantErrorMessage"
> {
  const resolutionSignatures = new Map<string, string>();
  const planWorkflows = new Set<string>();
  const cancelledConversions = new Set<string>();
  const runPlanWorkflow = async (proposalId: string, task: () => Promise<boolean>) => {
    if (planWorkflows.has(proposalId)) {
      throw new Error(i18n.t("errors.planApprovalUnavailable"));
    }
    planWorkflows.add(proposalId);
    try {
      return await task();
    } finally {
      planWorkflows.delete(proposalId);
      cancelledConversions.delete(proposalId);
    }
  };
  const finishCancelledConversion = async (proposalId: string, sessionId: string) => {
    await api.markRevisionFailed(proposalId, sessionId, "PLAN_GOAL_CONVERSION_CANCELLED");
    const session = get().sessions.find((item) => item.id === sessionId);
    if (session) {
      const configured = await api.configureSession(sessionId, {
        mode: "plan",
        providerId: session.providerId,
        modelId: session.modelId,
        thinkingLevel: session.thinkingLevel,
      });
      set((state) => ({
        sessions: state.sessions.map((item) => item.id === sessionId ? configured.session : item),
      }));
    }
    await get().restorePendingPlan(sessionId);
  };
  const abortConversionTurn = async (proposalId: string, sessionId: string) => {
    const result = await api.pendingPlans(sessionId);
    const intent = result.history?.find((proposal) => proposal.id === proposalId)?.revisionIntent;
    if (intent?.state !== "started" || !intent.turnId) return false;
    const aborted = await api.abort(sessionId, intent.turnId);
    return aborted.aborted !== false;
  };
  const startRevision = async (proposalId: string, sessionId: string, intent: PlanRevisionIntentInput) => {
    try {
      if (intent.targetKind === "goal" && cancelledConversions.has(proposalId)) {
        await finishCancelledConversion(proposalId, sessionId);
        return false;
      }
      const configured = await api.configureSession(sessionId, {
        mode: intent.targetKind,
        providerId: intent.providerId,
        modelId: intent.modelId,
        thinkingLevel: intent.thinkingLevel,
      });
      set((state) => ({
        sessions: state.sessions.map((item) => item.id === sessionId ? configured.session : item),
      }));
      if (intent.targetKind === "goal" && cancelledConversions.has(proposalId)) {
        await finishCancelledConversion(proposalId, sessionId);
        return false;
      }
      const accepted = await get().sendPrompt(intent.content, intent.draft, sessionId, undefined, {
        revisionProposalId: proposalId,
      });
      if (accepted && intent.targetKind === "goal" && cancelledConversions.has(proposalId)) {
        if (await abortConversionTurn(proposalId, sessionId)) {
          await finishCancelledConversion(proposalId, sessionId);
        } else {
          await get().restorePendingPlan(sessionId);
        }
        return false;
      }
      if (!accepted) {
        await api.markRevisionFailed(proposalId, sessionId);
      }
      await get().restorePendingPlan(sessionId);
      return accepted;
    } catch (error) {
      try {
        await api.markRevisionFailed(proposalId, sessionId);
      } catch (markError) {
        get().showToast(markError instanceof Error ? markError.message : String(markError), { variant: "error" });
      }
      await get().restorePendingPlan(sessionId);
      throw error;
    }
  };
  return {
    dismissAssistantErrorMessage: (messageId) => {
      if (!messageId) return;
      set((state) => ({
        dismissedAssistantErrorMessages: {
          ...state.dismissedAssistantErrorMessages,
          [messageId]: true,
        },
      }));
    },

    setPage: (page, opts) => {
      runtime.beginNavigationIntent();
      const record = opts?.record !== false;
      set((state) => {
        if (!record) return { page };
        const entry = {
          page,
          sessionId: page === "chat" ? state.activeSessionId : undefined,
        };
        const stack = state.navStack.slice(0, state.navIndex + 1);
        const last = stack[stack.length - 1];
        const same =
          last?.page === entry.page && last?.sessionId === entry.sessionId;
        const nextStack = same ? stack : [...stack, entry].slice(-50);
        return {
          page,
          navStack: nextStack,
          navIndex: nextStack.length - 1,
        };
      });
    },

    setSettingsTab: (settingsTab) => {
      get().setPage("settings");
      set((state) => ({
        settingsTab,
        settingsTabNonce: state.settingsTabNonce + 1,
      }));
    },
    setSettingsAnchor: (settingsAnchor) => set({ settingsAnchor }),
    canNavBack: () => get().navIndex > 0,
    canNavForward: () => get().navIndex < get().navStack.length - 1,

    navBack: () => {
      const intent = runtime.beginNavigationIntent();
      const state = get();
      if (state.navIndex <= 0) return;
      const index = state.navIndex - 1;
      const entry = state.navStack[index];
      set({ navIndex: index, page: entry.page });
      if (entry.page === "chat" && entry.sessionId) {
        void get().selectSession(entry.sessionId, {
          record: false,
          navigationIntent: intent,
        });
        set({ navIndex: index });
      }
    },

    navForward: () => {
      const intent = runtime.beginNavigationIntent();
      const state = get();
      if (state.navIndex >= state.navStack.length - 1) return;
      const index = state.navIndex + 1;
      const entry = state.navStack[index];
      set({ navIndex: index, page: entry.page });
      if (entry.page === "chat" && entry.sessionId) {
        void get().selectSession(entry.sessionId, {
          record: false,
          navigationIntent: intent,
        });
        set({ navIndex: index });
      }
    },

    resolvePermission: async (sessionId, requestId, decision) => {
      const permission = headPermission(get().pendingPermissions, sessionId);
      if (!permission || permission.requestId !== requestId) return;
      try {
        await api.resolvePermission({ requestId, decision });
      } finally {
        set((state) => ({
          pendingPermissions: removePermission(
            state.pendingPermissions,
            sessionId,
            requestId,
          ),
        }));
      }
    },

    resolveAsk: async (sessionId, resolution: AskToolResolution) => {
      const ask = headAsk(get().pendingAsks, sessionId);
      if (!ask || ask.requestId !== resolution.requestId) return;
      await api.resolveAskTool(resolution);
      set((state) => ({
        pendingAsks: removeAsk(state.pendingAsks, sessionId, resolution.requestId),
      }));
    },

    resolvePlan: async (resolution: PlanResolveRequest) => {
      if (planWorkflows.has(resolution.proposalId) && resolution.action !== "request_changes") {
        throw new Error(i18n.t("errors.planApprovalUnavailable"));
      }
      const signature = JSON.stringify(resolution);
      const activeRequest = interactionRuntime.planResolutionRequests.get(
        resolution.proposalId,
      );
      if (activeRequest) {
        if (resolutionSignatures.get(resolution.proposalId) !== signature) {
          throw new Error(i18n.t("errors.planApprovalUnavailable"));
        }
        return activeRequest;
      }
      const pending = get().pendingPlans[resolution.sessionId];
      if (
        !pending ||
        pending.status !== "pending" ||
        pending.id !== resolution.proposalId
      ) {
        throw new Error(i18n.t("errors.planApprovalUnavailable"));
      }
      const request = (async () => {
        try {
          const result = await api.resolvePlan(resolution);
          get().handlePlansChanged({
            sessionId: resolution.sessionId,
            state: result.state,
            proposal: result.proposal,
            proposalId: result.proposal.id,
            action: result.action,
            targetPermissionMode: result.targetPermissionMode,
          });
          return result;
        } catch (error) {
          if (
            resolution.action === "request_changes" ||
            resolution.action === "schedule" ||
            (error as { code?: unknown })?.code === PLAN_APPROVAL_TIMEOUT
          ) {
            await get().restorePendingPlan(resolution.sessionId);
          }
          throw error;
        }
      })();
      interactionRuntime.planResolutionRequests.set(
        resolution.proposalId,
        request,
      );
      resolutionSignatures.set(resolution.proposalId, signature);
      try {
        return await request;
      } finally {
        if (
          interactionRuntime.planResolutionRequests.get(resolution.proposalId) ===
          request
        ) {
          interactionRuntime.planResolutionRequests.delete(resolution.proposalId);
          resolutionSignatures.delete(resolution.proposalId);
        }
      }
    },

    revisePlan: (input) => runPlanWorkflow(input.proposal.id, async () => {
      const { proposal, content, providerId, modelId, thinkingLevel } = input;
      if (!content.trim() || get().activeSessionId !== proposal.sessionId) return false;
      if (!providerId || !modelId) throw new Error(i18n.t("errors.MODEL_NOT_CONFIGURED"));
      const intent: PlanRevisionIntentInput = {
        content, providerId, modelId, thinkingLevel, targetKind: proposal.kind,
        draft: input.draft,
      };
      await get().resolvePlan({
        proposalId: proposal.id,
        sessionId: proposal.sessionId,
        turnId: proposal.turnId,
        toolCallId: proposal.toolCallId,
        version: proposal.version,
        action: "request_changes",
        revisionIntent: intent,
      });
      return startRevision(proposal.id, proposal.sessionId, intent);
    }),

    convertPlanToGoal: (proposal) => runPlanWorkflow(proposal.id, async () => {
      if (proposal.kind !== "plan" || get().activeSessionId !== proposal.sessionId) return false;
      const session = get().sessions.find((item) => item.id === proposal.sessionId);
      if (!session?.providerId || !session.modelId) throw new Error(i18n.t("errors.MODEL_NOT_CONFIGURED"));
      const intent: PlanRevisionIntentInput = {
        content: [
          "Convert the following Plan proposal into a Goal contract for separate approval.",
          "Treat this Plan as source material, not authorization to execute it.",
          "Submit one complete Goal contract with acceptance criteria and boundaries.",
          "<source-plan>", proposal.markdown, "</source-plan>",
        ].join("\n"),
        providerId: session.providerId,
        modelId: session.modelId,
        thinkingLevel: session.thinkingLevel,
        targetKind: "goal",
      };
      await get().resolvePlan({
        proposalId: proposal.id,
        sessionId: proposal.sessionId,
        turnId: proposal.turnId,
        toolCallId: proposal.toolCallId,
        version: proposal.version,
        action: "request_changes",
        revisionIntent: intent,
      });
      return startRevision(proposal.id, proposal.sessionId, intent);
    }),

    retryPlanRevision: (proposal) => runPlanWorkflow(proposal.id, async () => {
      const intent = proposal.revisionIntent;
      if (!intent || (intent.state !== "ready" && intent.state !== "failed")) return false;
      return startRevision(proposal.id, proposal.sessionId, intent);
    }),

    cancelPlanConversion: async (proposal) => {
      if (planWorkflows.has(proposal.id)) {
        cancelledConversions.add(proposal.id);
        return true;
      }
      return runPlanWorkflow(proposal.id, async () => {
        if (proposal.revisionIntent?.targetKind !== "goal" ||
            (proposal.revisionIntent.state !== "ready" && proposal.revisionIntent.state !== "started")) return false;
        if (get().pendingPlans[proposal.sessionId]?.status === "pending") return false;
        if (proposal.revisionIntent.state === "started" &&
            !(await abortConversionTurn(proposal.id, proposal.sessionId))) {
          await get().restorePendingPlan(proposal.sessionId);
          return false;
        }
        await finishCancelledConversion(proposal.id, proposal.sessionId);
        return true;
      });
    },

    runMissedPlan: async (proposal) => {
      if (proposal.scheduleState !== "missed") return false;
      await api.runMissedPlan(proposal.id, proposal.sessionId);
      await get().restorePendingPlan(proposal.sessionId);
      return true;
    },

    cancelScheduledPlan: async (proposal) => {
      if (proposal.scheduleState !== "scheduled" && proposal.scheduleState !== "missed") return false;
      const result = await api.cancelScheduledPlan(proposal.id, proposal.sessionId);
      await get().restorePendingPlan(proposal.sessionId);
      return result.cancelled;
    },

    showToast: (message, options) => {
      const variant = options?.variant ?? "info";
      const duration =
        options?.duration ??
        (variant === "error" ? TOAST_ERROR_DURATION_MS : TOAST_DURATION_MS);
      set((state) => {
        const kept = state.toasts.filter(
          (item) => item.message !== message || item.variant !== variant,
        );
        const next = [
          ...kept,
          {
            id: interactionRuntime.nextToastId(),
            message,
            variant,
            duration,
            sound: options?.sound !== false,
          },
        ];
        return { toasts: next.slice(-TOAST_STACK_LIMIT) };
      });
    },
    dismissToast: (id) =>
      set((state) => ({
        toasts: state.toasts.filter((item) => item.id !== id),
      })),
  };
}
