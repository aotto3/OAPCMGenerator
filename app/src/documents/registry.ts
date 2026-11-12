/**
 * Document engine — registry of document definitions.
 *
 * The registry is the single source of truth for "which documents exist and how
 * to build them". Both the document-selection checkboxes and the ZIP builder are
 * loops over DOCUMENT_REGISTRY, so adding a document is one entry here plus its
 * id/label/default in the contest model's DOCUMENT_TYPES — no UI or packaging
 * edits.
 *
 * A definition is pure: contest record in → file bytes out (the one exception is
 * the adjudicator PDF builder, which loads bundled ballot templates via a browser
 * fetch / Node fs loader — see pdfAssets.ts). All 15 documents now have real
 * builders; id, label, and filename stay put as builders evolve.
 */

import { DOCUMENT_TYPES, type Contest, type DocumentId } from '../model/contest';
import { buildDirectorLetter } from './letter';
import { buildFallAgenda } from './fallAgenda';
import { buildHostChecklist } from './hostChecklist';
import { buildDirectorsMeeting } from './directorsMeeting';
import { buildAwardsScript } from './awardsScript';
import { buildAdvancingLetter } from './advancingLetter';
import { buildTimerDoc } from './timer';
import { buildPreRehearsalMeeting } from './preRehearsalMeeting';
import { buildContestSchedule } from './contestSchedule';
import { buildRehearsalSchedule } from './rehearsalSchedule';
import { buildContactList } from './contactList';
import { buildAdjudicatorInfo } from './adjudicatorInfo';
import { buildChecklist } from './checklist';
import { buildProgram } from './program';
import { buildAdjudicatorPacketsPdf } from './adjPackets';
import { loadAdjudicatorTemplates } from './pdfAssets';
import { buildPanelTabulationPdf } from './panelTabulation';
import { tabulationReport } from '../model/tabulationReport';

/**
 * Per-build context threaded from the generate pipeline. Optional so a plain
 * `build(contest)` call still works (placeholders and tests ignore it).
 */
export interface DocumentBuildContext {
  /**
   * Date to stamp on documents that print a "letter date" (v12 used the clock,
   * `new Date()`). Injectable so golden-file output is deterministic; defaults
   * to the build time in production, where the stamp should read "today".
   */
  now?: Date;
}

/**
 * A builder's output. Most builders just emit bytes; a builder that fills a
 * fixed external template (the adjudicator PDFs) may also report NON-FATAL
 * warnings — e.g. a form field that could not be filled — which the generate
 * pipeline surfaces to the user without aborting the ZIP.
 */
export interface DocumentResult {
  bytes: Uint8Array;
  /** Human-readable, non-fatal warnings from building this document. */
  warnings?: string[];
}

/**
 * contest record in → file bytes out (optionally with warnings). Pure aside from
 * JSZip packing. May be sync (placeholders) or async — a .docx/.xlsx is itself a
 * ZIP and the PDF filler loads templates, so real builders return a Promise.
 * buildContestArchive awaits and normalizes either shape.
 */
export type DocumentBuilder = (
  contest: Contest,
  ctx?: DocumentBuildContext,
) => Uint8Array | DocumentResult | Promise<Uint8Array | DocumentResult>;

export interface DocumentDefinition {
  id: DocumentId;
  /** UI label (from the contest model's DOCUMENT_TYPES). */
  label: string;
  /** Output filename inside the ZIP folder, e.g. "Awards Script.docx" (v12). */
  filename: string;
  /** Whether the checkbox is ticked by default (from DOCUMENT_TYPES). */
  defaultSelected: boolean;
  /**
   * Whether the document can be built from this contest right now. Absent means
   * always. An unavailable document is shown unchecked and disabled with
   * `unavailableHint`, and is never put in the ZIP, whatever its stored checkbox.
   */
  available?: (contest: Contest) => boolean;
  /** Short reason shown next to an unavailable document, e.g. "enter all ranks first". */
  unavailableHint?: string;
  build: DocumentBuilder;
}

/**
 * Adjudicator Packets builder: loads the official UIL ballot templates for the
 * current environment, then runs the pure PDF filler. Field-fill failures come
 * back as non-fatal warnings (v12 fieldErrors) rather than aborting.
 */
const buildAdjPackets: DocumentBuilder = async (contest) => {
  const templates = await loadAdjudicatorTemplates();
  const { bytes, fieldErrors } = await buildAdjudicatorPacketsPdf(contest, templates);
  return { bytes, warnings: fieldErrors };
};

/**
 * Per-id filename + builder. Typed as a total map over DocumentId, so adding a
 * document to the model's DOCUMENT_TYPES fails to compile until it is registered
 * here. Filenames match v12's generateAll() output names exactly.
 */
const DOC_BUILDERS: Record<
  DocumentId,
  Pick<DocumentDefinition, 'filename' | 'build' | 'available' | 'unavailableHint'>
> = {
  checklist: { filename: 'Year-Round Checklist.xlsx', build: buildChecklist },
  fall_agenda: { filename: 'Fall District Meeting Agenda.docx', build: buildFallAgenda },
  host_checklist: { filename: 'Host School Checklist.docx', build: buildHostChecklist },
  rehearsal: { filename: 'Schedule - Reh. and Contest.xlsx', build: buildRehearsalSchedule },
  schedule: { filename: 'Contest Day Schedule.xlsx', build: buildContestSchedule },
  letter: { filename: 'Director Information Letter.docx', build: buildDirectorLetter },
  pre_rehearsal_meeting: {
    filename: 'Pre-Rehearsal Company Meeting.docx',
    build: buildPreRehearsalMeeting,
  },
  directors_meeting: {
    filename: 'Contest Day Directors Meeting Agenda.docx',
    build: buildDirectorsMeeting,
  },
  awards: { filename: 'Awards Script.docx', build: buildAwardsScript },
  advancing_letter: { filename: 'Advancing Schools Letter.docx', build: buildAdvancingLetter },
  contacts: { filename: 'School-Director Contact List.xlsx', build: buildContactList },
  adjudicator: { filename: 'Adjudicator Info Sheet.xlsx', build: buildAdjudicatorInfo },
  adj_packets: { filename: 'Adjudicator Packets.pdf', build: buildAdjPackets },
  timer: { filename: 'Timer Instructions and Form.docx', build: buildTimerDoc },
  program: { filename: 'Audience Program.docx', build: buildProgram },
  panel_tabulation: {
    filename: 'Panel Tabulation.pdf',
    build: buildPanelTabulationPdf,
    available: (contest) => tabulationReport(contest) !== null,
    unavailableHint: 'enter all ranks first',
  },
};

/**
 * The document registry, in the model's DOCUMENT_TYPES (v12 UI) order. Derived
 * from DOCUMENT_TYPES so id/label/defaultSelected have exactly one definition.
 */
export const DOCUMENT_REGISTRY: DocumentDefinition[] = DOCUMENT_TYPES.map((doc) => ({
  id: doc.id,
  label: doc.label,
  defaultSelected: doc.defaultSelected,
  ...DOC_BUILDERS[doc.id],
}));

/** Whether a document can be built from this contest now (see DocumentDefinition.available). */
export function isDocumentAvailable(doc: DocumentDefinition, contest: Contest): boolean {
  return doc.available ? doc.available(contest) : true;
}

/**
 * Whether a document goes in the ZIP: available, and checked. A contest saved
 * before the document existed has no stored checkbox, so it falls back to the
 * document's default.
 */
export function isDocumentSelected(doc: DocumentDefinition, contest: Contest): boolean {
  return isDocumentAvailable(doc, contest) && (contest.documents[doc.id] ?? doc.defaultSelected);
}

/**
 * How the Generate Documents checklist groups the registry, in season order
 * (matching the Readiness phases). Display only: the ZIP keeps registry order.
 * Every document appears in exactly one group (locked by a test).
 */
export const DOCUMENT_GROUPS: readonly { id: string; label: string; documents: readonly DocumentId[] }[] = [
  { id: 'planning', label: 'Planning & Setup', documents: ['checklist', 'fall_agenda', 'host_checklist'] },
  { id: 'directors', label: 'Directors & Schools', documents: ['letter', 'contacts', 'pre_rehearsal_meeting'] },
  { id: 'schedules', label: 'Schedules', documents: ['rehearsal', 'schedule'] },
  { id: 'judges', label: 'Judges', documents: ['adjudicator', 'adj_packets'] },
  { id: 'contest_day', label: 'Contest Day', documents: ['directors_meeting', 'timer', 'program', 'awards'] },
  { id: 'results', label: 'Results', documents: ['panel_tabulation', 'advancing_letter'] },
];
