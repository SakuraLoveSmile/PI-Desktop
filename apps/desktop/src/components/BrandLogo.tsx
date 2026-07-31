import { useEffect, useState } from "react";
import brandLogoUrlLight from "../../build/icon_1024.png";
import brandLogoUrlDark from "../../build/logo_dark.png";

export function BrandLogo({ size = 16 }: { size?: number }) {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme !== "light");

  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => {
      setDark(el.dataset.theme !== "light");
    });
    observer.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <img
      className="brand-logo"
      src={dark ? brandLogoUrlDark : brandLogoUrlLight}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
    />
  );
}
