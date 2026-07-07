/**
 * Adjudicator Packets — the official UIL ballot PDF filler (pdf-lib).
 *
 * PURE MODULE aside from pdf-lib: contest record + the three ballot template
 * byte arrays in → merged PDF bytes out. No DOM, no fetch — the three templates
 * are supplied by the caller (documents/pdfAssets.ts loads them per environment),
 * so this stays testable in Node with fs-loaded bytes and identical in the
 * browser bundle.
 *
 * Behavior spec: v12 genAdjudicatorPackets (_Templates/OAP Contest Setup.html,
 * ~3488–3581). Per judge (numJudges), schools in performance order:
 *   • Evaluation ballot, one filled copy PER SCHOOL — header/admin fields only,
 *     leaving every judge-scored field blank; flattened.
 *   • Ranking ballot, one PER JUDGE — Panelist A/B/C, Conference, Level/Zone
 *     dropdowns and per-school Play/School text; flattened.
 *   • Acting Awards ballot, JUDGE 1 ONLY, completely blank.
 * Every field write is guarded; failures accumulate into `fieldErrors` (v12) and
 * surface as a non-fatal warning through the generate pipeline — they never abort
 * the merge. Filled values are read back BEFORE flatten by the tests, so intent
 * survives a golden regeneration.
 *
 * DETERMINISM: pdf-lib stamps Producer/Creator/CreationDate/ModificationDate; all
 * four are pinned so the merged bytes are byte-stable (the golden is a hash).
 */

import { PDFDocument, type PDFForm } from 'pdf-lib';
import { MAX_SCHOOLS, type Contest } from '../model/contest';
import { docSchools, type DocSchool } from './docVars';
import { fmtDateShort } from './format';

/** The three official UIL ballot templates, as raw PDF bytes. */
export interface AdjudicatorPdfTemplates {
  /** UIL Play Evaluation form (multi-page). */
  evaluation: Uint8Array;
  /** UIL Ranking Ballot (single page). */
  ranking: Uint8Array;
  /** UIL Acting Awards ballot. */
  awards: Uint8Array;
}

export interface AdjPacketResult {
  /** Merged, flattened PDF bytes. */
  bytes: Uint8Array;
  /** Labels of fields that could not be filled (v12 fieldErrors). Empty ⇒ clean. */
  fieldErrors: string[];
  /** Page count of the merged PDF. */
  pageCount: number;
}

/** Contest-level values every ballot shares — derived once per build. */
export interface AdjPacketContext {
  classification: string;
  contestLevel: string;
  hostVenueName: string;
  /** fmtDateShort(contestDate), e.g. "March 21, 2026"; '' when unset. */
  contestDateShort: string;
}

/** Level checkbox map: contest_level → field name on the Evaluation form (v12). */
const LEVEL_CHECK_MAP: Record<string, string> = {
  Zone: 'Check Box6',
  District: 'Check Box7',
  BiDistrict: 'Check Box8',
  Area: 'Check Box9',
  Region: 'Check Box10',
  State: 'Check Box11',
};

/** Level dropdown map: contest_level → option text on the Ranking Ballot (v12). */
const LEVEL_DROP_MAP: Record<string, string> = {
  Zone: 'Zone',
  District: 'District',
  BiDistrict: 'Bi District',
  Area: 'Area',
  Region: 'Region',
  State: 'State',
};

const PANELIST_LETTERS = ['A', 'B', 'C'];

/** Em-dash used in the Evaluation "Title" field ("School — Play"), as in v12. */
const EM_DASH = '—';

/** Derives the shared contest-level values the ballots print (v12 vars.*). */
export function adjPacketContext(contest: Contest): AdjPacketContext {
  return {
    classification: contest.identity.classification,
    contestLevel: contest.identity.contestLevel,
    hostVenueName: contest.identity.hostVenueName,
    contestDateShort: fmtDateShort(contest.details.contestDate),
  };
}

/** Values for one Evaluation ballot (one school × one judge). Header/admin only. */
export interface EvaluationValues {
  /** Field name → text, in v12 fill order (drives fieldErrors order). */
  text: Record<string, string>;
  /** Level checkbox field to check, or null when the level has no mapping. */
  levelCheckbox: string | null;
}

/** Values for one Ranking ballot (one judge). */
export interface RankingValues {
  /** Dropdown field name → selected option (Panelist / Conference / Level-Zone). */
  dropdowns: Record<string, string>;
  /** Play N + School/School_N field name → text, interleaved as v12 fills them. */
  text: Record<string, string>;
}

/** Evaluation field values for a school+judge — header/admin fields only (v12). */
export function evaluationValues(
  judgeName: string,
  school: DocSchool,
  ctx: AdjPacketContext,
): EvaluationValues {
  return {
    // Insertion order mirrors v12's setText sequence, so fieldErrors read the same.
    text: {
      Title: (school.name ? school.name + ' ' + EM_DASH + ' ' : '') + (school.play || ''),
      Date: ctx.contestDateShort || '',
      'Performance Order': String(school.order),
      Conference: ctx.classification || '',
      'Contest Site': ctx.hostVenueName || '',
      Judge: judgeName,
    },
    levelCheckbox: LEVEL_CHECK_MAP[ctx.contestLevel] ?? null,
  };
}

/** Ranking field values for a judge — dropdowns plus per-school Play/School (v12). */
export function rankingValues(
  judgeIndex: number,
  schools: DocSchool[],
  ctx: AdjPacketContext,
): RankingValues {
  const text: Record<string, string> = {};
  for (let ri = 0; ri < schools.length && ri < MAX_SCHOOLS; ri++) {
    const rs = schools[ri];
    text['Play ' + (ri + 1)] = rs.play || '';
    text[ri === 0 ? 'School' : 'School_' + (ri + 1)] = rs.name || '';
  }
  return {
    dropdowns: {
      Panelist: PANELIST_LETTERS[judgeIndex] || 'A',
      Conference: ctx.classification || '5A',
      'Level/Zone': LEVEL_DROP_MAP[ctx.contestLevel] || 'District',
    },
    text,
  };
}

/** Sets each text field, recording `${prefix} ${name}` for any that is missing. */
function fillTextFields(
  form: PDFForm,
  text: Record<string, string>,
  prefix: string,
  errors: string[],
): void {
  for (const [name, value] of Object.entries(text)) {
    try {
      form.getTextField(name).setText(value);
    } catch {
      errors.push(prefix + ' ' + name);
    }
  }
}

/**
 * Fills one Evaluation form's header/admin fields; returns the labels of any that
 * could not be set. Exported so a test can fill a single form and read the values
 * back BEFORE flatten (proving field names + values, not just intent).
 */
export function fillEvaluationForm(form: PDFForm, values: EvaluationValues): string[] {
  const errors: string[] = [];
  fillTextFields(form, values.text, 'Eval', errors);
  if (values.levelCheckbox) {
    try {
      form.getCheckBox(values.levelCheckbox).check();
    } catch {
      errors.push('Eval level checkbox (' + values.levelCheckbox + ')');
    }
  }
  return errors;
}

/** Fills one Ranking form (dropdowns + play/school text); returns missing labels. */
export function fillRankingForm(form: PDFForm, values: RankingValues): string[] {
  const errors: string[] = [];
  for (const [name, value] of Object.entries(values.dropdowns)) {
    try {
      form.getDropdown(name).select(value);
    } catch {
      errors.push('Rank ' + name);
    }
  }
  fillTextFields(form, values.text, 'Rank', errors);
  return errors;
}

/** Pins date/producer metadata so the merged bytes are deterministic. */
function pinMetadata(doc: PDFDocument): void {
  const EPOCH = new Date(0);
  doc.setProducer('OAP Contest Manager');
  doc.setCreator('OAP Contest Manager');
  doc.setCreationDate(EPOCH);
  doc.setModificationDate(EPOCH);
}

/**
 * Builds the merged Adjudicator Packets PDF from a contest and the three ballot
 * templates. Pure aside from pdf-lib. Field-fill failures accumulate into
 * `fieldErrors` (non-fatal) rather than aborting the merge — v12 semantics.
 */
export async function buildAdjudicatorPacketsPdf(
  contest: Contest,
  templates: AdjudicatorPdfTemplates,
): Promise<AdjPacketResult> {
  const ctx = adjPacketContext(contest);
  const schools = docSchools(contest);
  const numJudges = contest.details.numJudges;
  const fieldErrors: string[] = [];
  const merged = await PDFDocument.create();

  for (let j = 0; j < numJudges; j++) {
    const judgeName = contest.adjudicators[j]?.name || 'Judge ' + (j + 1);

    // Evaluation ballots: one copy of the official form per school.
    for (const school of schools) {
      const evalDoc = await PDFDocument.load(templates.evaluation);
      const form = evalDoc.getForm();
      fieldErrors.push(...fillEvaluationForm(form, evaluationValues(judgeName, school, ctx)));
      form.flatten();
      (await merged.copyPages(evalDoc, evalDoc.getPageIndices())).forEach((p) => merged.addPage(p));
    }

    // Ranking ballot: one copy of the official form per judge.
    const rankDoc = await PDFDocument.load(templates.ranking);
    const rForm = rankDoc.getForm();
    fieldErrors.push(...fillRankingForm(rForm, rankingValues(j, schools, ctx)));
    rForm.flatten();
    (await merged.copyPages(rankDoc, rankDoc.getPageIndices())).forEach((p) => merged.addPage(p));

    // Acting Awards ballot: Judge 1 only, completely blank (judges fill it in).
    if (j === 0) {
      const awardsDoc = await PDFDocument.load(templates.awards);
      (await merged.copyPages(awardsDoc, awardsDoc.getPageIndices())).forEach((p) =>
        merged.addPage(p),
      );
    }
  }

  pinMetadata(merged);
  return { bytes: await merged.save(), fieldErrors, pageCount: merged.getPageCount() };
}
