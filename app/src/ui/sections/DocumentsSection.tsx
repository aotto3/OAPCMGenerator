import { setAllDocuments, setDocumentSelected, type Contest } from '../../model/contest';
import { DOCUMENT_REGISTRY, isDocumentAvailable, isDocumentSelected } from '../../documents/registry';

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
  const selectedCount = DOCUMENT_REGISTRY.filter((doc) => isDocumentSelected(doc, contest)).length;

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
        {DOCUMENT_REGISTRY.map((doc) => {
          // An unavailable document (e.g. Panel Tabulation before every rank is
          // in) shows unchecked and disabled, with the reason beside it.
          const available = isDocumentAvailable(doc, contest);
          const checked = isDocumentSelected(doc, contest);
          const className = ['doc-check-item', checked && 'checked', !available && 'unavailable']
            .filter(Boolean)
            .join(' ');
          return (
            <label key={doc.id} className={className}>
              <input
                type="checkbox"
                checked={checked}
                disabled={!available}
                onChange={(e) => onChange(setDocumentSelected(contest, doc.id, e.target.checked))}
              />
              {doc.label}
              {!available && doc.unavailableHint && <span className="doc-check-hint">({doc.unavailableHint})</span>}
            </label>
          );
        })}
      </div>
    </>
  );
}
