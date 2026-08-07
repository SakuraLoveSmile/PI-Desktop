import { type CSSProperties, useEffect, useState } from "react";
import mascotGroupsUrl from "../assets/home-mascot-groups.png";

const FRAME_WIDTH = 100;
const FRAME_DURATION_MS = 140;

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

function chooseMascotGroup() {
  const index = Math.floor(Math.random() * MASCOT_GROUPS.length);
  return MASCOT_GROUPS[index] ?? MASCOT_GROUPS[0];
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
  const [group] = useState(chooseMascotGroup);
  const [frameIndex, setFrameIndex] = useState(0);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion || group.frameCount <= 1) {
      setFrameIndex(0);
      return;
    }

    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % group.frameCount);
    }, FRAME_DURATION_MS);

    return () => window.clearInterval(timer);
  }, [group.frameCount, prefersReducedMotion]);

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
