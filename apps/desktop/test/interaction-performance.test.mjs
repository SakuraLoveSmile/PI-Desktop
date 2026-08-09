import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [app, chatSurface, transcript, minimap, styles, store] = await Promise.all([
  read("../src/App.tsx"),
  read("../src/components/ChatSurface.tsx"),
  read("../src/components/ChatTranscript.tsx"),
  read("../src/components/ConversationMinimap.tsx"),
  loadStyles(),
  read("../src/stores/app-store.ts"),
]);

test("streaming state stays inside the chat render boundary", () => {
  assert.match(app, /<ChatSurface \/>/);
  assert.doesNotMatch(app, /useAppStore\(\(s\) => s\.messages\)/);
  assert.doesNotMatch(app, /<ChatTranscript/);
  assert.match(chatSurface, /export const ChatSurface = memo/);
  assert.match(chatSurface, /const messages = useAppStore/);
  assert.match(chatSurface, /const StableComposer = memo\(Composer\)/);
});

test("chat configuration errors still navigate to agent settings", () => {
  assert.match(chatSurface, /store\.setSettingsTab\("agent"\)/);
  assert.match(chatSurface, /store\.setPage\("settings"\)/);
});

test("secondary destinations stay outside the initial shell bundle", () => {
  assert.match(app, /const SettingsPage = lazy/);
  assert.match(app, /import\("\.\/pages\/SettingsPage"\)/);
  assert.match(app, /import\("\.\/pages\/PluginsPage"\)/);
  assert.match(app, /<Suspense fallback=\{<RoutePending \/>\}>/);
});

test("stream rendering avoids duplicate frame state and coalesces following", () => {
  assert.match(transcript, /const displayed = message\.content \|\| "";/);
  assert.doesNotMatch(transcript, /useTypewriter/);
  assert.doesNotMatch(transcript, /setVisibleLen/);
  assert.match(transcript, /const scheduleFollowScroll = useCallback/);
  assert.match(transcript, /followFrameRef\.current !== 0/);
  assert.match(transcript, /const renderedMessages = useDeferredValue\(messages\)/);
  assert.match(transcript, /const \{ entries, visible \} = useMemo/);
  assert.match(
    transcript,
    /buildTranscriptEntries\(renderedMessages, renderedCompactions\)/,
  );
  assert.match(transcript, /const TranscriptHistory = memo/);
  assert.match(transcript, /const TranscriptTail = memo/);
  assert.match(transcript, /function transcriptEntryEqual/);
  assert.match(transcript, /const historyEntries = entries\.slice\(0, -1\)/);
  assert.match(transcript, /<TranscriptHistory entries=\{historyEntries\}/);
  assert.match(transcript, /<TranscriptTail[\s\S]*?entry=\{tailEntry\}/);
  assert.match(transcript, /activityGroupPropsEqual/);
  assert.match(transcript, /assistantTurnPropsEqual/);
});

test("stream event bursts are coalesced until a paint or terminal event", () => {
  assert.match(store, /createFrameBatcher<AgentEventEnvelope>/);
  assert.match(store, /streamUpdates\.enqueue\(/);
  assert.match(store, /streamUpdates\.flushNow\(\)/);
  assert.match(store, /event\.type === "message_update"/);
  assert.match(store, /event\.type === "tool_update"/);
});

test("tool errors stay local to their rows instead of failing the activity group", () => {
  assert.doesNotMatch(transcript, /const hasFailure = items\.some/);
  assert.doesNotMatch(transcript, /processingFailedAfter/);
  assert.doesNotMatch(transcript, /tool-activity-group[\s\S]*?failed/);
  assert.match(transcript, /const \[open, setOpen\] = useState\(status === "error"\)/);
  assert.match(transcript, /if \(status === "error"\) setOpen\(true\)/);
  assert.match(transcript, /status === "error"\s*\? t\("chat\.toolFailed"\)/);
});

test("manual upward scrolling cancels pending transcript follow work", () => {
  assert.match(transcript, /reduceTranscriptScroll/);
  assert.match(
    transcript,
    /if \(transition\.releasedFollow\) cancelFollowScroll\(\)/,
  );
  assert.match(transcript, /pinnedRef\.current = transition\.pinned/);
  assert.match(transcript, /setShowJump\(transition\.showJump\)/);
});

test("send re-pins before paint instead of flashing the old transcript position", () => {
  const turnStartEffect = transcript.match(
    /\/\/ Send \/ retry \/ regenerate[\s\S]*?useLayoutEffect\(\(\) => \{([\s\S]*?)\n  \}, \[[\s\S]*?\]\);/,
  )?.[1] ?? "";
  assert.match(turnStartEffect, /const turnStarted = isRunning && !wasRunningRef\.current/);
  assert.match(turnStartEffect, /cancelFollowScroll\(\)/);
  assert.match(turnStartEffect, /pinnedRef\.current = true/);
  assert.match(turnStartEffect, /scrollToBottom\(\)/);
  assert.match(transcript, /const targetTop = Math\.max\(0, el\.scrollHeight - el\.clientHeight\)/);
});

test("session activation pins the latest record before the first paint", () => {
  assert.match(
    chatSurface,
    /const activeSessionId = useAppStore\(\(state\) => state\.activeSessionId\);/,
  );
  assert.match(
    chatSurface,
    /<ChatTranscript[\s\S]*?sessionId=\{transcriptView\.sessionId\}/,
  );
  assert.match(chatSurface, /useDeferredValue\(activeSessionId\)/);

  const activationEffect = transcript.match(
    /useLayoutEffect\(\(\) => \{([\s\S]*?)\n  \}, \[cancelFollowScroll, sessionId, scrollToBottom\]\);/,
  )?.[1];
  assert.ok(activationEffect);
  assert.match(activationEffect, /cancelFollowScroll\(\)/);
  assert.match(activationEffect, /pinnedRef\.current = true/);
  assert.match(activationEffect, /setShowJump\(false\)/);
  assert.match(activationEffect, /scrollToBottom\(\)/);
  assert.doesNotMatch(activationEffect, /smooth/);
});

test("minimap separates resize checks from message-position measurement", () => {
  assert.match(minimap, /buildConversationMinimapMarkers\(messages\)/);
  assert.match(minimap, /const markerIdentity = useMemo/);
  assert.match(minimap, /new ResizeObserver\(scheduleResize\)/);
  assert.match(minimap, /resizeRaf = requestAnimationFrame\(updateOverflow\)/);
  assert.match(minimap, /addEventListener\("scroll", scheduleScroll/);
  assert.match(minimap, /behavior: reduceMotion \? "auto" : "smooth"/);
});

test("motion feedback is composited, bounded, and accessible", () => {
  assert.match(styles, /@keyframes route-surface-in/);
  assert.match(styles, /@keyframes work-panel-in/);
  assert.match(styles, /@keyframes work-panel-out/);
  assert.match(styles, /@keyframes work-panel-out-windows/);
  assert.match(
    styles,
    /:root\[data-platform="win32"\] \.work-panel\.is-exiting \{[^}]*animation-name:\s*work-panel-out-windows;/s,
  );
  assert.match(styles, /translateX\(8px\)/);
  assert.match(styles, /\.composer-shell:focus-within/);
  assert.doesNotMatch(styles, /backdrop-filter:\s*blur/);
  assert.match(styles, /\.chat-error-notice > span[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.route-surface,[\s\S]*?animation-duration:\s*0\.01ms !important/,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.work-panel\.is-exiting[\s\S]*?animation-duration:\s*0\.01ms !important/,
  );
});
