import { type CSSProperties, useState } from "react";
import mascotGroupsUrl from "../assets/home-mascot-groups.png";

const FRAME_WIDTH = 100;

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

export function HomeMascotLogo() {
  const [group] = useState(chooseMascotGroup);
  const firstFrame = group.startFrame * FRAME_WIDTH;
  const lastFrame = (group.startFrame + group.frameCount - 1) * FRAME_WIDTH;
  const style = {
    backgroundImage: `url(${mascotGroupsUrl})`,
    "--home-mascot-start": `-${firstFrame}px`,
    "--home-mascot-end": `-${lastFrame}px`,
    "--home-mascot-frame-count": group.frameCount,
    "--home-mascot-duration": `${group.frameCount * 100}ms`,
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
