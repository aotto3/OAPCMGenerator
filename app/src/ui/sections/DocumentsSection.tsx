import { setAllDocuments, setDocumentSelected, type Contest } from '../../model/contest';
import { DOCUMENT_REGISTRY } from '../../documents/registry';

/**
 * Document checklist — the "which documents to generate" picker. Rendered bare
 * (no Section wrapper) inside GenerateSection: the pick-then-generate steps live
 * in one "Generate Documents" section (Slice 16, #29).
 */
export function DocumentsChecklist({
  contest,
  onChange,
}: {
  contest: Contest;
  onChange: (next: Contest) => void;
}) {
  const selectedCount = DOCUMENT_REGISTRY.filter((doc) => contest.documents[doc.id]).length;

  return (
    <>
      <div className="doc-toolbar">
        <button type="button" className="btn-util" onClick={() => onChange(setAllDocuments(contest, true))}>
          ☑ Check All
        </button>
        <button type="button" className="btn-util" onClick={() => onChange(setAllDocuments(contest, false))}>
          ☐ Uncheck All
        </button>
        <span className="muted">
          {selectedCount} of {DOCUMENT_REGISTRY.length} selected
        </span>
      </div>
      <div className="doc-check-grid">
        {DOCUMENT_REGISTRY.map((doc) => (
          <label
            key={doc.id}
            className={contest.documents[doc.id] ? 'doc-check-item checked' : 'doc-check-item'}
          >
            <input
              type="checkbox"
              checked={contest.documents[doc.id]}
              onChange={(e) => onChange(setDocumentSelected(contest, doc.id, e.target.checked))}
            />
            {doc.label}
          </label>
        ))}
      </div>
    </>
  );
}
