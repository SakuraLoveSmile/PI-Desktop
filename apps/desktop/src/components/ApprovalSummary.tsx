import { useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "./Markdown";
import { Button } from "./ui";

/** Presentation of the model's approval overview, never a substitute for the contract. */
export function ApprovalSummary({ text }: { text: string }) {
  const { t } = useTranslation();
  const id = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    setExpanded(false);
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(content).lineHeight);
      setOverflow(content.scrollHeight > lineHeight * 3 + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [text]);

  return (
    <>
      <div id={id} ref={contentRef}
        className={`approval-summary-text${expanded ? " expanded" : ""}`}>
        <Markdown source={text} renderDiagrams={false} />
      </div>
      {overflow ? (
        <Button type="button" variant="ghost" size="sm" className="approval-summary-toggle"
          aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((value) => !value)}>
          {t(expanded ? "chat.collapseApprovalSummary" : "chat.expandApprovalSummary")}
        </Button>
      ) : null}
    </>
  );
}
