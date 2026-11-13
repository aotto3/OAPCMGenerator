import { allDirectorEmails, allJudgeEmails, type Contest } from '../model/contest';
import { CopyButton } from './sections/fields';

/** A read-only, comma-separated address list with a copy button. */
function AddressListBox({ title, emails, placeholder }: { title: string; emails: string[]; placeholder: string }) {
  const text = emails.join(', ');
  return (
    <section className="section email-list-box">
      <h2>{title}</h2>
      <textarea readOnly value={text} placeholder={placeholder} />
      <CopyButton getText={() => text} label="Copy to Clipboard" />
    </section>
  );
}

/** Always-visible copyable list of every director email (v12 email_list_box). */
export function EmailListBox({ contest }: { contest: Contest }) {
  return (
    <AddressListBox
      title="📧 All-Director Email List (copy & paste into your email)"
      emails={allDirectorEmails(contest)}
      placeholder="Director emails will appear here as you enter them above..."
    />
  );
}

/** Copyable list of the active judges' emails (PRD #227), under the director list. */
export function JudgeEmailListBox({ contest }: { contest: Contest }) {
  return (
    <AddressListBox
      title="⚖️ All-Judges Email List (copy & paste into your email)"
      emails={allJudgeEmails(contest)}
      placeholder="Judge emails will appear here once you enter them in the Judges section..."
    />
  );
}
