import { type CSSProperties, useEffect, useState } from "react";
import mascotGroupsUrl from "../assets/home-mascot-groups.png";

const FRAME_WIDTH = 100;
const FRAME_DURATION_MS = 160;
const GROUP_PAUSE_MIN_MS = 3200;
const GROUP_PAUSE_MAX_MS = 5600;
const STATIC_GROUP_PAUSE_MIN_MS = 5200;
const STATIC_GROUP_PAUSE_MAX_MS = 8000;

const MASCOT_GROUPS = [
  { startFrame: 0, frameCount: 1 },
  { startFrame: 1, frameCount: 6 },
  { startFrame: 7, frameCount: 4 },
  { startFrame: 11, frameCount: 8 },
  { startFrame: 19, frameCount: 5 },
  { startFrame: 24, frameCount: 8 },
  { startFrame: 32, frameCount: 6 },
  { startFrame: 38, frameCount: 6 },
  { startFrame: 44, frameCount: 6 },
] as const;

function chooseMascotGroupIndex(previousIndex = -1) {
  const candidates = MASCOT_GROUPS.map((_, index) => index).filter(
    (index) => index !== previousIndex,
  );
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index] ?? 0;
}

function randomDuration(minMs: number, maxMs: number) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}

export function HomeMascotLogo() {
  const [groupIndex, setGroupIndex] = useState(() => chooseMascotGroupIndex());
  const [frameIndex, setFrameIndex] = useState(0);
  const prefersReducedMotion = usePrefersReducedMotion();
  const group = MASCOT_GROUPS[groupIndex] ?? MASCOT_GROUPS[0];

  useEffect(() => {
    if (prefersReducedMotion) {
      setFrameIndex(0);
      return;
    }

    const isLastFrame = frameIndex + 1 >= group.frameCount;
    const duration = isLastFrame
      ? group.frameCount <= 1
        ? randomDuration(STATIC_GROUP_PAUSE_MIN_MS, STATIC_GROUP_PAUSE_MAX_MS)
        : randomDuration(GROUP_PAUSE_MIN_MS, GROUP_PAUSE_MAX_MS)
      : FRAME_DURATION_MS;
    const timer = window.setTimeout(() => {
      if (!isLastFrame) {
        setFrameIndex((current) => current + 1);
        return;
      }

      setGroupIndex((current) => chooseMascotGroupIndex(current));
      setFrameIndex(0);
    }, duration);

    return () => window.clearTimeout(timer);
  }, [frameIndex, group.frameCount, groupIndex, prefersReducedMotion]);

  const frame = (group.startFrame + frameIndex) * FRAME_WIDTH;
  const style = {
    backgroundImage: `url(${mascotGroupsUrl})`,
    backgroundPosition: `-${frame}px 0`,
  } as CSSProperties;

  return (
    <div
      className="home-mascot-logo"
      data-testid="home-mascot-logo"
      aria-hidden="true"
      style={style}
    />
  );
}
