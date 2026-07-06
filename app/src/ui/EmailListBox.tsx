import { allDirectorEmails, type Contest } from '../model/contest';
import { CopyButton } from './sections/fields';

/** Always-visible copyable list of every director email (v12 email_list_box). */
export function EmailListBox({ contest }: { contest: Contest }) {
  const emails = allDirectorEmails(contest).join(', ');
  return (
    <section className="section email-list-box">
      <h2>📧 All-Director Email List (copy &amp; paste into Gmail)</h2>
      <textarea
        readOnly
        value={emails}
        placeholder="Director emails will appear here as you enter them above..."
      />
      <CopyButton getText={() => emails} label="Copy to Clipboard" />
    </section>
  );
}
