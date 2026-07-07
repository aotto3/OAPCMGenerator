/**
 * Document engine — registry of document definitions.
 *
 * The registry is the single source of truth for "which documents exist and how
 * to build them". Both the document-selection checkboxes and the ZIP builder are
 * loops over DOCUMENT_REGISTRY, so adding a document is one entry here plus its
 * id/label/default in the contest model's DOCUMENT_TYPES — no UI or packaging
 * edits.
 *
 * A definition is pure: contest record in → file bytes out. No React, no DOM,
 * no fetch. The real builders (OOXML / spreadsheet / PDF) arrive in later slices;
 * for now every builder returns a placeholder so the whole pipeline — selection,
 * validation, packaging, download — is exercisable end to end. When a real
 * builder lands, only its `build` changes; id, label, and filename stay put.
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
 * contest record in → file bytes out. Pure aside from JSZip packing. May be
 * sync (placeholders) or async — a .docx/.xlsx is itself a ZIP, so its real
 * builder returns a Promise. buildContestArchive awaits either.
 */
export type DocumentBuilder = (
  contest: Contest,
  ctx?: DocumentBuildContext,
) => Uint8Array | Promise<Uint8Array>;

export interface DocumentDefinition {
  id: DocumentId;
  /** UI label (from the contest model's DOCUMENT_TYPES). */
  label: string;
  /** Output filename inside the ZIP folder, e.g. "Awards Script.docx" (v12). */
  filename: string;
  /** Whether the checkbox is ticked by default (from DOCUMENT_TYPES). */
  defaultSelected: boolean;
  build: DocumentBuilder;
}

/**
 * Placeholder builder used until a document's real generator lands. Emits a
 * short UTF-8 note so the file is non-empty and self-explanatory in the ZIP.
 */
function placeholder(label: string): DocumentBuilder {
  return () =>
    new TextEncoder().encode(
      `Placeholder for "${label}".\n\n` +
        'This document generator is not implemented yet — it arrives in a later ' +
        'slice of the OAP Contest Manager 2.0 rebuild. The generation pipeline ' +
        '(selection, validation, packaging, download) is complete; only the real ' +
        'document contents are pending.\n',
    );
}

/**
 * Per-id filename + builder. Typed as a total map over DocumentId, so adding a
 * document to the model's DOCUMENT_TYPES fails to compile until it is registered
 * here. Filenames match v12's generateAll() output names exactly.
 */
const DOC_BUILDERS: Record<DocumentId, { filename: string; build: DocumentBuilder }> = {
  checklist: { filename: 'Year-Round Checklist.xlsx', build: placeholder('Year-Round Checklist') },
  fall_agenda: { filename: 'Fall District Meeting Agenda.docx', build: buildFallAgenda },
  host_checklist: { filename: 'Host School Checklist.docx', build: buildHostChecklist },
  rehearsal: { filename: 'Schedule - Reh. and Contest.xlsx', build: placeholder('Schedule - Reh. and Contest') },
  schedule: { filename: 'Contest Day Schedule.xlsx', build: placeholder('Contest Day Schedule') },
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
  contacts: { filename: 'School-Director Contact List.xlsx', build: placeholder('School-Director Contact List') },
  adjudicator: { filename: 'Adjudicator Info Sheet.xlsx', build: placeholder('Adjudicator Info Sheet') },
  adj_packets: { filename: 'Adjudicator Packets.pdf', build: placeholder('Adjudicator Packets') },
  timer: { filename: 'Timer Instructions and Form.docx', build: buildTimerDoc },
};

/**
 * The document registry, in the model's DOCUMENT_TYPES (v12 UI) order. Derived
 * from DOCUMENT_TYPES so id/label/defaultSelected have exactly one definition.
 */
export const DOCUMENT_REGISTRY: DocumentDefinition[] = DOCUMENT_TYPES.map((doc) => ({
  id: doc.id,
  label: doc.label,
  defaultSelected: doc.defaultSelected,
  filename: DOC_BUILDERS[doc.id].filename,
  build: DOC_BUILDERS[doc.id].build,
}));
