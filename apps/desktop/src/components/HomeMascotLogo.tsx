import { type CSSProperties, useEffect, useState } from "react";
import mascotGroupsUrl from "../assets/home-mascot-groups.png";

const FRAME_WIDTH = 100;
const FRAME_DURATION_MS = 140;
const STATIC_GROUP_DURATION_MS = 900;

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

    const duration = group.frameCount <= 1 ? STATIC_GROUP_DURATION_MS : FRAME_DURATION_MS;
    const timer = window.setTimeout(() => {
      if (frameIndex + 1 < group.frameCount) {
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
