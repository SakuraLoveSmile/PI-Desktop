/**
 * Selection → Markdown recovery for message quotes (ADR 0223 / D398).
 *
 * A selection inside a rendered answer is DOM, not source text: KaTeX paints
 * two parallel trees per formula, the highlighter splits one fence into a span
 * per token, and a table renders as cells. Handing that DOM to the composer
 * duplicates every formula, flattens every table, and turns code into
 * decorations, so a clone of the range is reduced back to Markdown — `$…$` TeX,
 * fenced code, one line per table row — before it becomes draft text.
 *
 * The floating affordance and the per-message action row both quote through
 * {@link serializeSelectionMarkdown}: one recovery path, not two spellings of
 * the same mistake.
 */

/** Gap between the selection and the floating quote affordance. */
export const SELECTION_QUOTE_GAP = 6;
/** Smallest distance the affordance keeps from the viewport edges. */
export const SELECTION_QUOTE_MARGIN = 8;
/** Markdown fences start at three backticks and grow past the longest run. */
export const SELECTION_QUOTE_MIN_FENCE = 3;

/** The transcript row attribute the quote affordances anchor to (D398). */
export const QUOTABLE_ROW_ATTRIBUTE = "data-minimap-id";

const KATEX_TEX_SELECTOR = 'annotation[encoding="application/x-tex"]';

/** Viewport rectangle, structurally typed so placement is testable. */
export type SelectionQuoteRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/** The geometry half of a `Range` the affordance needs, structurally typed. */
export type SelectionQuoteGeometry = {
  getClientRects(): ArrayLike<SelectionQuoteRect>;
  getBoundingClientRect(): SelectionQuoteRect;
};

/* ---------- pure helpers ---------- */

function longestRun(text: string, character: string): number {
  let longest = 0;
  let current = 0;
  for (const value of text) {
    if (value === character) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

/**
 * A fence long enough to contain `text`, so quoting a snippet that itself
 * contains backticks cannot break out of the block.
 */
export function codeFenceFor(
  text: string,
  minimum = SELECTION_QUOTE_MIN_FENCE,
): string {
  return "`".repeat(Math.max(minimum, longestRun(text, "`") + 1));
}

/**
 * Collapse the whitespace the rendered DOM adds back to source-like text:
 * markup indentation, non-breaking spaces, soft hyphens, and the blank lines
 * that separating blocks introduce.
 */
export function normalizeSelectionMarkdown(value: string): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b\ufeff]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n[ \t]+\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Place the floating affordance against a selection: on the selection's start
 * edge, below its last line, flipped above when the pane runs out of room, and
 * clamped so it never leaves the viewport.
 */
export function placeSelectionQuote({
  anchor,
  size,
  viewport,
  margin = SELECTION_QUOTE_MARGIN,
  gap = SELECTION_QUOTE_GAP,
}: {
  anchor: SelectionQuoteRect;
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  margin?: number;
  gap?: number;
}): { top: number; left: number } {
  const maxLeft = Math.max(margin, viewport.width - size.width - margin);
  const left = Math.min(Math.max(margin, anchor.left), maxLeft);
  const maxTop = Math.max(margin, viewport.height - size.height - margin);
  const below = anchor.bottom + gap;
  const above = anchor.top - size.height - gap;
  const top =
    below <= maxTop ? below : above >= margin ? above : Math.min(below, maxTop);
  return { top, left };
}

/* ---------- DOM reduction ---------- */

function replaceWithText(node: Element, text: string, doc: Document): void {
  node.replaceWith(doc.createTextNode(text));
}

/**
 * A formula is one unit: KaTeX's MathML tree and its visual tree are two
 * renderings of the same source, and copying both duplicates the expression.
 * The TeX annotation is the source, so the whole formula is replaced by it —
 * `$…$` inline, `$$…$$` for a display block.
 */
function replaceKatex(wrapper: Element, doc: Document): void {
  for (const katex of Array.from(wrapper.querySelectorAll(".katex"))) {
    const tex = katex
      .querySelector(KATEX_TEX_SELECTOR)
      ?.textContent?.trim();
    const isDisplay = Boolean(katex.closest(".katex-display"));
    if (tex) {
      replaceWithText(katex, isDisplay ? `\n$$\n${tex}\n$$\n` : `$${tex}$`, doc);
      continue;
    }
    // Valid KaTeX always carries the annotation; keep one rendering if not.
    const fallback =
      katex.querySelector(".katex-html")?.textContent ?? katex.textContent ?? "";
    replaceWithText(katex, fallback, doc);
  }
}

function fencedBlock(code: string, language: string): string {
  const fence = codeFenceFor(code);
  return `\n${fence}${language}\n${code.replace(/\n$/, "")}\n${fence}\n`;
}

function replaceCodeBlocks(wrapper: Element, doc: Document): void {
  for (const block of Array.from(wrapper.querySelectorAll(".code-block"))) {
    const language = (block.querySelector(".code-block-lang")?.textContent ?? "")
      .trim()
      .replace(/[^A-Za-z0-9_+.-]/g, "");
    const code = block.querySelector("pre code")?.textContent ?? "";
    replaceWithText(block, fencedBlock(code, language), doc);
  }
  // A `pre` outside the app's code-block wrapper (or one reached on its own) is
  // still code, and quoting it line by line would read as prose.
  for (const pre of Array.from(wrapper.querySelectorAll("pre"))) {
    const code = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
    replaceWithText(pre, fencedBlock(code, ""), doc);
  }
}

function replaceInlineCode(wrapper: Element, doc: Document): void {
  for (const code of Array.from(wrapper.querySelectorAll("code"))) {
    if (code.closest("pre")) continue;
    const value = code.textContent ?? "";
    const fence = codeFenceFor(value, 1);
    replaceWithText(code, `${fence}${value}${fence}`, doc);
  }
}

function replaceTaskCheckboxes(wrapper: Element, doc: Document): void {
  for (const input of Array.from(wrapper.querySelectorAll('input[type="checkbox"]'))) {
    const checked = (input as HTMLInputElement).checked;
    replaceWithText(input, checked ? "[x] " : "[ ] ", doc);
  }
}

/**
 * Drop transcript chrome, and unwrap the rest of the controls: a file-reference
 * chip renders its code inside a button, so removing buttons outright would
 * delete the text the user selected.
 */
function removeChrome(wrapper: Element): void {
  for (const node of Array.from(
    wrapper.querySelectorAll(
      [
        ".message-actions",
        ".code-block-head",
        "script",
        "style",
        "noscript",
        "template",
        "[hidden]",
        '[aria-hidden="true"]',
        ".sr-only",
      ].join(","),
    ),
  )) {
    node.remove();
  }
  for (const button of Array.from(wrapper.querySelectorAll("button"))) {
    button.replaceWith(...Array.from(button.childNodes));
  }
}

/**
 * A row is the smallest unit that carries meaning across the visual column
 * split, so each row becomes one `a | b` line.
 */
function replaceTables(wrapper: Element, doc: Document): void {
  for (const row of Array.from(wrapper.querySelectorAll("tr"))) {
    const cells = Array.from(row.querySelectorAll(":scope > th, :scope > td"));
    if (cells.length === 0) continue;
    const value = cells
      .map((cell) => (cell.textContent ?? "").trim().replace(/\s*\n\s*/g, " "))
      .join(" | ");
    replaceWithText(row, `${value}\n`, doc);
  }
}

function replaceLists(wrapper: Element, doc: Document): void {
  // Innermost first: a nested item must become text before its parent reads it.
  for (const item of Array.from(wrapper.querySelectorAll("li")).reverse()) {
    const parent = item.parentElement;
    let prefix = "- ";
    if (parent?.tagName?.toLowerCase() === "ol") {
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName?.toLowerCase() === "li",
      );
      const start = Number.parseInt(parent.getAttribute("start") ?? "1", 10) || 1;
      prefix = `${start + Math.max(0, siblings.indexOf(item))}. `;
    }
    replaceWithText(item, `${prefix}${(item.textContent ?? "").trim()}\n`, doc);
  }
}

function replaceHeadings(wrapper: Element, doc: Document): void {
  for (let level = 1; level <= 6; level += 1) {
    for (const heading of Array.from(wrapper.querySelectorAll(`h${level}`))) {
      replaceWithText(
        heading,
        `\n${"#".repeat(level)} ${(heading.textContent ?? "").trim()}\n`,
        doc,
      );
    }
  }
}

function addBlockBoundaries(wrapper: Element, doc: Document): void {
  for (const br of Array.from(wrapper.querySelectorAll("br"))) {
    replaceWithText(br, "\n", doc);
  }
  for (const rule of Array.from(wrapper.querySelectorAll("hr"))) {
    replaceWithText(rule, "\n---\n", doc);
  }
  for (const block of Array.from(
    wrapper.querySelectorAll("p, pre, blockquote, section, article, div"),
  )) {
    block.before(doc.createTextNode("\n"));
    block.after(doc.createTextNode("\n"));
  }
}

/**
 * Expand a range that starts or ends inside a formula to the whole formula:
 * half of a TeX expression is not a quote, and KaTeX's two trees make a partial
 * cut ambiguous anyway. Both boundaries only ever move within the row the
 * selection already covers, so no extra containment check is needed.
 */
export function expandRangeToWholeKatex(range: Range): Range {
  const expanded = range.cloneRange();
  const boundaryFor = (node: Node | null): Element | null => {
    const element =
      node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
    const katex = element?.closest?.(".katex") ?? null;
    return katex?.closest?.(".katex-display") ?? katex;
  };
  const start = boundaryFor(expanded.startContainer);
  const end = boundaryFor(expanded.endContainer);
  if (start) expanded.setStartBefore(start);
  if (end) expanded.setEndAfter(end);
  return expanded;
}

/**
 * The Markdown a rendered selection stands for. Returns an empty string when
 * there is nothing quotable, which every caller treats as "keep the affordance
 * hidden".
 */
export function serializeSelectionMarkdown(range: Range | null): string {
  if (!range) return "";
  const ownerDocument =
    range.commonAncestorContainer?.ownerDocument ??
    (range.commonAncestorContainer?.nodeType === 9
      ? (range.commonAncestorContainer as unknown as Document)
      : null) ??
    (typeof document === "undefined" ? null : document);
  if (!ownerDocument) return "";

  const wrapper = ownerDocument.createElement("div");
  wrapper.append(expandRangeToWholeKatex(range).cloneContents());

  // Order matters: formulas and code are reduced before chrome is dropped and
  // before generic block boundaries are inserted, or their own markup would be
  // flattened into the text the reduction is looking for.
  replaceKatex(wrapper, ownerDocument);
  replaceCodeBlocks(wrapper, ownerDocument);
  replaceInlineCode(wrapper, ownerDocument);
  replaceTaskCheckboxes(wrapper, ownerDocument);
  removeChrome(wrapper);
  replaceTables(wrapper, ownerDocument);
  replaceLists(wrapper, ownerDocument);
  replaceHeadings(wrapper, ownerDocument);
  addBlockBoundaries(wrapper, ownerDocument);

  return normalizeSelectionMarkdown(wrapper.textContent ?? "");
}

/* ---------- live selection ---------- */

/** The transcript row a node sits in, or null when the selection is elsewhere. */
export function quotableRowFor(node: Node | null | undefined): Element | null {
  const element =
    node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
  return element?.closest?.(`[${QUOTABLE_ROW_ATTRIBUTE}]`) ?? null;
}

/** The document selection, when it is a non-empty text range. */
export function activeSelectionRange(): Range | null {
  if (typeof window === "undefined") return null;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  return range.toString().trim() ? range : null;
}

/**
 * The last line of the selection, which is where the affordance anchors: the
 * end of the selection is where the pointer and the eye already are.
 */
export function selectionAnchorRect(
  geometry: SelectionQuoteGeometry | null | undefined,
): SelectionQuoteRect | null {
  const rects = Array.from(geometry?.getClientRects?.() ?? []).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  if (rects.length > 0) return rects[rects.length - 1];
  const rect = geometry?.getBoundingClientRect?.();
  if (!rect) return null;
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

/**
 * The Markdown of the current selection when it is inside `rowAnchorId`, and an
 * empty string otherwise — a selection in another row must not be attributed to
 * the message whose action row was clicked.
 */
export function selectionMarkdownWithinRow(
  rowAnchorId: string,
  container: Element | Document | null = null,
): string {
  const range = activeSelectionRange();
  if (!range) return "";
  const row = quotableRowFor(range.startContainer);
  if (!row || row.getAttribute(QUOTABLE_ROW_ATTRIBUTE) !== rowAnchorId) return "";
  if (container && !(container as Element).contains?.(row)) return "";
  return serializeSelectionMarkdown(range);
}
