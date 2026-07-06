import { setAllDocuments, setDocumentSelected, type Contest } from '../../model/contest';
import { DOCUMENT_REGISTRY } from '../../documents/registry';
import { Section } from './Section';

export function DocumentsSection({
  contest,
  onChange,
}: {
  contest: Contest;
  onChange: (next: Contest) => void;
}) {
  const selectedCount = DOCUMENT_REGISTRY.filter((doc) => contest.documents[doc.id]).length;

  return (
    <Section title="📦 Documents to Generate" badge="Select All That Apply">
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
    </Section>
  );
}
