import { useState } from 'react';
import { contestDisplayName, generationWarnings, type Contest } from '../../model/contest';
import { DOCUMENT_REGISTRY } from '../../documents/registry';
import {
  buildContestArchive,
  triggerZipDownload,
  type DocumentWarning,
} from '../../documents/generate';
import { reportDocumentsGenerated } from '../../telemetry/telemetryClient';
import { Section } from './Section';
import { Divider } from './fields';
import { DocumentsChecklist } from './DocumentsSection';

type StatusKind = 'info' | 'success' | 'error';
interface Status {
  kind: StatusKind;
  text: string;
}

/**
 * Generate section — the v12 "Generate Contest Documents" flow: pre-flight
 * validation warnings (warn but let the user proceed), then build the ZIP and
 * download it, with a per-document status line and a final summary. All work is
 * client-side; the document engine does the building, this component only drives
 * it and reports progress.
 */
export function GenerateSection({
  contest,
  onChange,
}: {
  contest: Contest;
  onChange: (next: Contest) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [warnings, setWarnings] = useState<DocumentWarning[]>([]);
  const [busy, setBusy] = useState(false);

  const selectedCount = DOCUMENT_REGISTRY.filter((doc) => contest.documents[doc.id]).length;

  async function handleGenerate() {
    // v12 blocks a download with no documents (the contest file alone isn't a
    // "generate documents" action — export lives on the dashboard later).
    if (selectedCount === 0) {
      setStatus({ kind: 'error', text: 'No documents selected.' });
      return;
    }

    // Advisory warnings — identical wording and proceed-anyway flow as v12.
    const warnings = generationWarnings(contest);
    if (warnings.length > 0) {
      const proceed = window.confirm(
        '⚠️ Warning — some fields are missing:\n\n• ' + warnings.join('\n• ') + '\n\nGenerate anyway?',
      );
      if (!proceed) {
        setStatus(null);
        return;
      }
    }

    setBusy(true);
    setWarnings([]);
    try {
      const archive = await buildContestArchive(contest, {
        onProgress: ({ label, current, total }) =>
          setStatus({ kind: 'info', text: `📄 Building ${label}… (${current}/${total})` }),
      });
      triggerZipDownload(archive);
      // Best-effort, fire-and-forget: record the fact of generation (no document
      // selections or contents) — never awaited, so it can't delay the download.
      reportDocumentsGenerated(contest.id, contestDisplayName(contest.identity));
      const n = archive.documentCount;
      setStatus({
        kind: 'success',
        text: `✅ Done! Downloaded ${archive.folderName}.zip (${n} document${n !== 1 ? 's' : ''} + contest file).`,
      });
      // Non-fatal: the ZIP is complete, but some fields could not be pre-filled.
      setWarnings(archive.warnings);
    } catch (err) {
      setStatus({ kind: 'error', text: `❌ Error: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="⬇️ Generate Documents" badge="Download ZIP">
      <DocumentsChecklist contest={contest} onChange={onChange} />
      <Divider>Download</Divider>
      <p className="muted">
        Builds a ZIP of the selected documents plus a portable contest file (a backup you can
        re-import on any machine). {selectedCount} document{selectedCount !== 1 ? 's' : ''} selected.
      </p>
      <div className="generate-row">
        <button type="button" className="btn-primary" onClick={handleGenerate} disabled={busy}>
          {busy ? 'Generating…' : '⬇️ Generate Contest Documents'}
        </button>
      </div>
      {status && (
        <p className={`status status-${status.kind}`} role="status" aria-live="polite">
          {status.text}
        </p>
      )}
      {warnings.length > 0 && (
        <div className="status status-warning" role="status" aria-live="polite">
          {warnings.map((w) => (
            <p key={w.document}>
              ⚠️ {w.document}: {w.messages.length} field{w.messages.length !== 1 ? 's' : ''} could
              not be pre-filled ({w.messages.join(', ')}).
            </p>
          ))}
        </div>
      )}
    </Section>
  );
}
