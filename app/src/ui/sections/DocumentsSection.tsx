import { setAllDocuments, setDocumentSelected, type Contest, type DocumentId } from '../../model/contest';
import {
  DOCUMENT_GROUPS,
  DOCUMENT_REGISTRY,
  isDocumentAvailable,
  isDocumentSelected,
  type DocumentDefinition,
} from '../../documents/registry';

/**
 * Document checklist — the "which documents to generate" picker. Rendered bare
 * (no Section wrapper) inside GenerateSection: the pick-then-generate steps live
 * in one "Generate Documents" section (Slice 16, #29). Documents are shown in
 * season-order groups (DOCUMENT_GROUPS), each with its own count and
 * select-all/clear toggle.
 */
export function DocumentsChecklist({
  contest,
  onChange,
}: {
  contest: Contest;
  onChange: (next: Contest) => void;
}) {
  const byId = new Map(DOCUMENT_REGISTRY.map((doc) => [doc.id, doc]));
  const selectedCount = DOCUMENT_REGISTRY.filter((doc) => isDocumentSelected(doc, contest)).length;

  function setGroup(ids: readonly DocumentId[], selected: boolean) {
    let next = contest;
    for (const id of ids) next = setDocumentSelected(next, id, selected);
    onChange(next);
  }

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
      <div className="doc-groups">
        {DOCUMENT_GROUPS.map((group) => {
          const docs = group.documents.map((id) => byId.get(id)!);
          const available = docs.filter((doc) => isDocumentAvailable(doc, contest));
          const checked = docs.filter((doc) => isDocumentSelected(doc, contest)).length;
          const allOn = available.length > 0 && checked === available.length;
          const headingId = `doc-group-${group.id}`;
          return (
            <section key={group.id} className="doc-group" aria-labelledby={headingId}>
              <div className="doc-group-head">
                <h4 id={headingId} className="doc-group-title">
                  {group.label}
                </h4>
                <span className="doc-group-count">
                  {checked}/{docs.length}
                </span>
                <button
                  type="button"
                  className="doc-group-toggle"
                  disabled={available.length === 0}
                  onClick={() => setGroup(available.map((d) => d.id), !allOn)}
                >
                  {allOn ? 'Clear' : 'Select all'}
                </button>
              </div>
              <div className="doc-check-list">
                {docs.map((doc) => (
                  <DocumentCheck key={doc.id} doc={doc} contest={contest} onChange={onChange} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function DocumentCheck({
  doc,
  contest,
  onChange,
}: {
  doc: DocumentDefinition;
  contest: Contest;
  onChange: (next: Contest) => void;
}) {
  // An unavailable document (e.g. Panel Tabulation before every rank is
  // in) shows unchecked and disabled, with the reason beside it.
  const available = isDocumentAvailable(doc, contest);
  const checked = isDocumentSelected(doc, contest);
  const className = ['doc-check-item', checked && 'checked', !available && 'unavailable'].filter(Boolean).join(' ');
  return (
    <label className={className}>
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
}
