export type TaskNotificationVisibility = {
  finishingSessionId: string;
  viewingSessionId: string | null;
  windowVisible: boolean;
  windowFocused: boolean;
};

/**
 * Durable task notifications are only suppressed for the exact chat result
 * currently visible in a focused window. Every unknown or background state
 * fails safe to notification.
 */
export function shouldCreateTaskNotification({
  finishingSessionId,
  viewingSessionId,
  windowVisible,
  windowFocused,
}: TaskNotificationVisibility): boolean {
  const resultIsVisible =
    windowVisible &&
    windowFocused &&
    viewingSessionId !== null &&
    viewingSessionId === finishingSessionId;
  return !resultIsVisible;
}
