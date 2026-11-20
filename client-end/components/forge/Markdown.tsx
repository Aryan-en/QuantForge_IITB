import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe markdown for assistant text: paragraphs, `inline code`, **bold**, fenced code,
 * bullet/numbered lists. Renders React nodes only — never HTML strings — because model output
 * is untrusted (architecture §F.5). Incomplete fences while streaming render as code.
 */
export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="flex flex-col gap-2 break-words text-body leading-[1.55] text-fg">
      {blocks.map((b, i) => {
        if (b.kind === "code")
          return (
            <pre key={i} className="forge-scroll overflow-x-auto rounded border border-border bg-bg px-3 py-2 font-mono text-secondary leading-[1.5]" tabIndex={0}>
              <code>{b.text}</code>
            </pre>
          );
        if (b.kind === "ul")
          return (
            <ul key={i} className="flex list-disc flex-col gap-0.5 pl-5 marker:text-faint">
              {b.items.map((it, j) => (
                <li key={j}>{inline(it)}</li>
              ))}
            </ul>
          );
        if (b.kind === "ol")
          return (
            <ol key={i} className="flex list-decimal flex-col gap-0.5 pl-5 marker:text-faint">
              {b.items.map((it, j) => (
                <li key={j}>{inline(it)}</li>
              ))}
            </ol>
          );
        return <p key={i}>{inline(b.text)}</p>;
      })}
    </div>
  );
}

type Block = { kind: "p"; text: string } | { kind: "code"; text: string } | { kind: "ul"; items: string[] } | { kind: "ol"; items: string[] };

function parseBlocks(src: string): Block[] {
  const lines = src.split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    if (/^\s*[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*] /, ""));
        i += 1;
      }
      out.push({ kind: "ul", items });
      continue;
    }
    if (/^\s*\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\. /, ""));
        i += 1;
      }
      out.push({ kind: "ol", items });
      continue;
    }
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].trimStart().startsWith("```") && !/^\s*([-*]|\d+\.) /.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    out.push({ kind: "p", text: para.join(" ") });
  }
  return out;
}

function inline(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`") && p.length > 1)
      return (
        <code key={i} className="rounded-sm bg-raised px-1 py-px font-mono text-[0.92em] text-fg">
          {p.slice(1, -1)}
        </code>
      );
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4)
      return (
        <strong key={i} className="font-semibold">
          {p.slice(2, -2)}
        </strong>
      );
    return <Fragment key={i}>{p}</Fragment>;
  });
}
