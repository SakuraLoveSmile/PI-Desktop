import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [app, chatSurface, transcript, minimap, styles] = await Promise.all([
  read("../src/App.tsx"),
  read("../src/components/ChatSurface.tsx"),
  read("../src/components/ChatTranscript.tsx"),
  read("../src/components/ConversationMinimap.tsx"),
  read("../src/styles/globals.css"),
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
  assert.match(transcript, /const \{ entries, visible \} = useMemo/);
  assert.match(transcript, /buildTranscriptEntries\(messages\)/);
  assert.match(transcript, /activityGroupPropsEqual/);
  assert.match(transcript, /assistantTurnPropsEqual/);
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
  assert.match(styles, /\.composer-shell:focus-within/);
  assert.doesNotMatch(styles, /backdrop-filter:\s*blur/);
  assert.match(styles, /\.chat-error-notice > span[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.route-surface,[\s\S]*?animation-duration:\s*0\.01ms !important/,
  );
});
