import leadPortrait from "../../../assets/team-avatars/lead.svg";
import alexPortrait from "../../../assets/team-avatars/alex.svg";
import samPortrait from "../../../assets/team-avatars/sam.svg";
import tinaPortrait from "../../../assets/team-avatars/tina.svg";
import noahPortrait from "../../../assets/team-avatars/noah.svg";
import mayaPortrait from "../../../assets/team-avatars/maya.svg";
import leoPortrait from "../../../assets/team-avatars/leo.svg";
import irisPortrait from "../../../assets/team-avatars/iris.svg";
import kaiPortrait from "../../../assets/team-avatars/kai.svg";

const portraits = [
  alexPortrait,
  samPortrait,
  tinaPortrait,
  noahPortrait,
  mayaPortrait,
  leoPortrait,
  irisPortrait,
  kaiPortrait,
];

function avatarIndex(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  return hash % portraits.length;
}

export function PixelAvatar({
  seed,
  lead = false,
  size = 20,
}: {
  seed: string;
  lead?: boolean;
  size?: 20 | 24 | 32 | 48;
}) {
  return (
    <img
      className="team-pixel-avatar"
      src={lead ? leadPortrait : portraits[avatarIndex(seed)]}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
    />
  );
}
