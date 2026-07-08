import { withCmInfo, type Contest, type SectionCompletion } from '../../model/contest';
import { Section } from './Section';
import { TextField } from './fields';

export function CmInfoSection({
  contest,
  completion,
  onChange,
  defaultOpen,
}: {
  contest: Contest;
  completion: SectionCompletion;
  onChange: (next: Contest) => void;
  defaultOpen?: boolean;
}) {
  const cm = contest.cmInfo;
  const edit = (patch: Partial<Contest['cmInfo']>) => onChange(withCmInfo(contest, patch));

  return (
    <Section title="👤 CM Info" completion={completion} defaultOpen={defaultOpen}>
      <div className="field-grid">
        <TextField label="Full Name" value={cm.name} onChange={(v) => edit({ name: v })} />
        <TextField label="Email Address" type="email" value={cm.email} onChange={(v) => edit({ email: v })} />
        <TextField label="Phone" type="tel" value={cm.phone} onChange={(v) => edit({ phone: v })} />
        <TextField
          label="Website (optional)"
          value={cm.website}
          onChange={(v) => edit({ website: v })}
        />
        <TextField
          label="Mailing Address (for letter closing)"
          wide
          value={cm.mailingAddress}
          onChange={(v) => edit({ mailingAddress: v })}
        />
        <TextField
          label="Lighting Tech Contact (host school)"
          wide
          placeholder="e.g. Brian Hamlin, Reece Dealmeida"
          value={cm.techContact}
          onChange={(v) => edit({ techContact: v })}
        />
      </div>
    </Section>
  );
}
