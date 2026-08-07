import mascotFramesUrl from "../assets/home-mascot-frames.png";

export function HomeMascotLogo() {
  return (
    <div
      className="home-mascot-logo"
      data-testid="home-mascot-logo"
      aria-hidden="true"
      style={{ backgroundImage: `url(${mascotFramesUrl})` }}
    />
  );
}
