"use client";

/**
 * Acute Lens's evidence surfaces (plan §3.3, §5.2, Phase 1B): the inspector's Evidence list (the node action, D16)
 * and the L5 source card. Both only display what `lensEvidence` derived from the canvas; the links out (VS Code,
 * the web repo) appear only when the user has said where the code lives (AC8). Acute never reads the files.
 */
import { useState } from "react";
import type { SourceRole } from "@/domain/canvas/diagram";
import { EVIDENCE_ORIGIN_LABELS, evidenceByRole, type LensEvidence } from "@/domain/lens/evidence";
import { vscodeUrl, webUrl, type RepoLinks } from "@/domain/lens/repoLinks";
import { setRepoLinks, useRepoLinks } from "@/state/lensRepoLinks";

const ROLE_LABELS: Record<SourceRole, string> = { implementation: "Implementation", test: "Tests", config: "Config", doc: "Docs" };

function linesText(lines?: [number, number]): string | null {
  if (!lines) return null;
  return lines[0] === lines[1] ? `line ${lines[0]}` : `lines ${lines[0]}–${lines[1]}`;
}

function CodeLinks({ links, item }: { links: RepoLinks; item: LensEvidence }) {
  const editor = item.path ? vscodeUrl(links, item.path, item.lines?.[0]) : undefined;
  const web = item.path ? webUrl(links, item.path, item.lines, item.commit) : undefined;
  if (!editor && !web) return null;
  return (
    <span className="acute-lens-evidence__links">
      {editor && <a href={editor}>Open in VS Code</a>}
      {web && (
        <a href={web} target="_blank" rel="noreferrer noopener">
          Open on GitHub
        </a>
      )}
    </span>
  );
}

function CodeItem({ item, links }: { item: LensEvidence; links: RepoLinks }) {
  const where = [linesText(item.lines), item.commit ? `@ ${item.commit.slice(0, 7)}` : null].filter(Boolean).join(" ");
  return (
    <li className="acute-lens-evidence__item">
      <code className="acute-lens-evidence__path">{item.path}</code>
      <span className="acute-lens-evidence__meta">
        {where && <span>{where}</span>}
        <span>from {EVIDENCE_ORIGIN_LABELS[item.origin]}</span>
      </span>
      <CodeLinks links={links} item={item} />
    </li>
  );
}

/** "Where does this code live?": the device-local targets for the links, edited in place. */
function RepoLinksForm({ workspaceId, links }: { workspaceId: string; links: RepoLinks }) {
  const [root, setRoot] = useState(links.root ?? "");
  const [web, setWeb] = useState(links.web ?? "");
  const known = !!(links.root || links.web);
  return (
    <details className="acute-lens-evidence__repo">
      <summary>{known ? "Code links" : "Add code links…"}</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setRepoLinks(workspaceId, { root, web });
        }}
      >
        <label className="acute-diagram-field">
          <span>Local folder (for VS Code)</span>
          <input className="acute-diagram-field__input" aria-label="Local repo folder" placeholder="C:/src/shop" value={root} onChange={(e) => setRoot(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <label className="acute-diagram-field">
          <span>Repository URL</span>
          <input className="acute-diagram-field__input" aria-label="Repository URL" placeholder="https://github.com/org/repo" value={web} onChange={(e) => setWeb(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <button type="submit" className="acute-lens-panel__zoom-in">
          Save links
        </button>
        <p className="acute-lens-evidence__note">Kept on this device only. Acute never reads your files.</p>
      </form>
    </details>
  );
}

/** The inspector's Evidence section: code by role, other sources, and the canvas object itself. */
export function EvidenceList({ evidence, workspaceId, onShowOnCanvas }: { evidence: readonly LensEvidence[]; workspaceId: string; onShowOnCanvas: (ref: NonNullable<LensEvidence["ref"]>) => void }) {
  const links = useRepoLinks(workspaceId);
  const groups = evidenceByRole(evidence);
  const documents = evidence.filter((e) => e.source === "document");
  const canvas = evidence.find((e) => e.source === "canvas");
  return (
    <section className="acute-lens-evidence" aria-label="Evidence">
      <span className="acute-diagram-card__group-title">Evidence</span>
      {groups.map((g) => (
        <div key={g.role} className="acute-lens-evidence__group" aria-label={ROLE_LABELS[g.role]} role="group">
          <span className="acute-lens-evidence__role">{ROLE_LABELS[g.role]}</span>
          <ul>
            {g.items.map((item, i) => (
              <CodeItem key={i} item={item} links={links} />
            ))}
          </ul>
        </div>
      ))}
      {documents.length > 0 && (
        <ul>
          {documents.map((d, i) => (
            <li key={i} className="acute-lens-evidence__item">
              {d.url ? (
                <a href={d.url} target="_blank" rel="noreferrer noopener">
                  {d.label}
                </a>
              ) : (
                <span>{d.label}</span>
              )}
              <span className="acute-lens-evidence__meta">from {EVIDENCE_ORIGIN_LABELS[d.origin]}</span>
            </li>
          ))}
        </ul>
      )}
      {!groups.length && !documents.length && <p className="acute-lens-evidence__note">No code linked yet. Add a Source to this node in the canvas properties panel.</p>}
      {canvas?.ref && (
        <button type="button" className="acute-lens-evidence__show" onClick={() => onShowOnCanvas(canvas.ref!)}>
          Show on canvas · {canvas.label}
        </button>
      )}
      {groups.length > 0 && <RepoLinksForm key={`${links.root ?? ""}|${links.web ?? ""}`} workspaceId={workspaceId} links={links} />}
    </section>
  );
}

/** L5 Source (plan §5.2, AC8): the node's code locations instead of a diagram. */
export function SourceCard({
  nodeLabel,
  parent,
  evidence,
  workspaceId,
  code,
}: {
  nodeLabel: string;
  /** "L4 Operation · Verify Operation": the level and frame the node sits in. */
  parent: string;
  evidence: readonly LensEvidence[];
  workspaceId: string;
  /** The code a Repo Map `code` card holds for this source (Phase 2), when the map has one. */
  code?: { source: string; language?: string; path: string };
}) {
  const links = useRepoLinks(workspaceId);
  const groups = evidenceByRole(evidence);
  return (
    <article className="acute-lens-source" aria-label={`Source of ${nodeLabel}`}>
      <header>
        <span className="acute-lens-source__parent">{parent}</span>
        <strong className="acute-lens-source__title">{nodeLabel}</strong>
      </header>
      {groups.map((g) => (
        <section key={g.role} aria-label={ROLE_LABELS[g.role]}>
          <span className="acute-lens-evidence__role">{ROLE_LABELS[g.role]}</span>
          <ul>
            {g.items.map((item, i) => (
              <CodeItem key={i} item={item} links={links} />
            ))}
          </ul>
        </section>
      ))}
      {code && (
        <section aria-label="Code">
          <span className="acute-lens-evidence__role">Code from the map · {code.path}</span>
          <pre className="acute-lens-source__code" data-language={code.language}>
            <code>{code.source}</code>
          </pre>
        </section>
      )}
      <p className="acute-lens-evidence__note">
        {code ? "The code above is a card your IDE agent put on the map; Acute doesn't read files." : "Acute shows where the code is; it doesn't read it."} Open it in your editor, or ask your IDE agent about it.
      </p>
      <RepoLinksForm key={`${links.root ?? ""}|${links.web ?? ""}`} workspaceId={workspaceId} links={links} />
    </article>
  );
}
