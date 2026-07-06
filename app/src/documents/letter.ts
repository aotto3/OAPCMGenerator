/**
 * Director Information Letter (.docx) — the first real document through the
 * engine.
 *
 * Ported from v12 genDirectorLetter (_Templates/OAP Contest Setup.html, lines
 * ~1832–1938). The letter body is FIXED 2026 language; the only changes are
 * variable substitution. v12 read a flat `vars` bag assembled from the DOM
 * (FormState._buildVars); here we read the pure Contest record directly, mapping
 * each vars.* onto the model field/helper it came from and reproducing v12's
 * exact fallback strings (e.g. an empty host school prints "[Host School]", an
 * empty venue prints "[Venue TBD]") so a real contest yields output identical to
 * v12's, down to the placeholder text.
 *
 * DETERMINISM: v12 stamped the letter with `new Date().toLocaleDateString()` —
 * nondeterministic, which breaks golden comparison. The date is injectable here
 * via options.now (mirroring the model's `now?` pattern) and defaults to the
 * build time for production, where the stamp should be "today".
 *
 * Pure except makeDocx (JSZip), which packs the body XML into the .docx.
 */

import {
  schoolsInPerformanceOrder,
  type Contest,
} from '../model/contest';
import { fmtDate, fmtDateNumeric, fmtDateShort, formatLongDate } from './format';
import { makeDocx, ooP, ooPBullet, ooPEmpty, ooPHead, ooPLine, ooTable2Col } from './ooxml';

export interface LetterOptions {
  /**
   * Date printed at the top of the letter. v12 used `new Date()` (the clock);
   * injectable here so the golden file is stable. Defaults to the build time.
   */
  now?: Date;
}

/**
 * Builds the Director Information Letter for a contest. Async because a .docx is
 * a ZIP (makeDocx). The registry's `letter` entry delegates to this.
 */
export async function buildDirectorLetter(contest: Contest, options: LetterOptions = {}): Promise<Uint8Array> {
  const cm = contest.cmInfo;
  const id = contest.identity;
  const d = contest.details;

  // ── vars mapping (v12 FormState._buildVars fallbacks, then the letter's own) ──
  const cmName = cm.name || 'Allen Otto';
  const cmEmail = cm.email || 'aotto3@gmail.com';
  const cmPhone = cm.phone || '';
  const cmAddress = cm.mailingAddress || '';
  const cmWebsite = cm.website || '';
  const tech = cm.techContact || '[Host Technical Director]';

  const lv = id.contestLevel || 'District';
  const hs = id.hostSchoolName || '[Host School]';
  const hv = id.hostVenueName || '[Venue TBD]';
  const ha = id.hostAddress || '[Address TBD]';

  const today = formatLongDate(options.now ?? new Date());

  const cd = fmtDateShort(d.contestDate) || 'TBD';
  const r1 = fmtDate(d.rehearsalDate1) || 'TBD';
  const r2 = fmtDate(d.rehearsalDate2) || '';
  const rDates = r2 ? r1 + ' and ' + r2 : r1;
  const lcDate = fmtDateShort(d.lightCueDeadlineDate) || d.lightCueDeadlineDate || 'TBD';
  const lcTime = d.lightCueDeadlineTime || '5:00 PM';
  const esd = fmtDateShort(d.entrySystemDeadline) || d.entrySystemDeadline || 'TBD';
  const esdNum = fmtDateNumeric(d.entrySystemDeadline) || esd;
  const dm = d.directorsMeetingTime || 'TBD';
  const fs = d.firstShowTime || 'TBD';
  const af = d.admissionFee ? '$' + d.admissionFee : 'TBD';
  const rehearsalMinutes = d.rehearsalLengthMinutes || 90;

  const judgeAddrs: Array<{ name: string; addr: string }> = [];
  for (let i = 1; i <= d.numJudges; i++) {
    const j = contest.adjudicators[i - 1];
    const n = j ? j.name : '';
    const a = j ? j.mailingAddress : '';
    if (n) judgeAddrs.push({ name: n, addr: a || 'Address TBA' });
  }

  // v12 read schools in form order, defaulted a blank name to "School <formIndex>",
  // then sorted by performance order. schoolsInPerformanceOrder sorts; the blank
  // fallback needs the ORIGINAL form position, so compute it before sorting.
  const formIndex = new Map(contest.schools.map((s, i) => [s, i + 1] as const));
  const schools = schoolsInPerformanceOrder(contest).map((s) => ({
    order: s.performanceOrder,
    name: s.name || 'School ' + formIndex.get(s),
    play: s.playTitle || '',
  }));

  const parts = [
    // Letterhead
    ooP(cmName, { bold: true, size: 26, color: '1F4E79', sb: 0, sa: 40 }),
    ooP('UIL One-Act Play Contest Manager', { size: 18, color: '555555', sa: 20 }),
    cmEmail ? ooP(cmEmail, { size: 18, color: '2E75B6', sa: 20 }) : '',
    cmPhone ? ooP(cmPhone, { size: 18, color: '555555', sa: 20 }) : '',
    ooPLine('2E75B6'),
    ooPEmpty(160),
    ooP(today, { size: 20, sa: 200 }),
    // Salutation & opening
    ooP('Directors,', { size: 20, sa: 120 }),
    ooP('Congratulations on surviving through the rigors of preparing a OAP show.  I know that each one of your students and staff has worked hard for this moment, and please take a moment to enjoy it.  We are now nearing contest day, so take a moment to begin thinking about the upcoming ' + lv + ' contest at ' + hs + ' on ' + cd + '.  Please, read this letter thoroughly as it contains a lot of information.', { size: 20, sa: 200 }),
    // Time-Sensitive To-Dos
    ooPHead('Time-Sensitive To-Dos (Details Below)'),
    ooPBullet('Send your scripts to the judges (information below). Please ensure your scripts are documented in accordance with Pg. 34 of the UIL Handbook for One-Act Play.'),
    ooPBullet(esdNum + ' — Deadline for Contestant entry, play and set information, and additional directors to be entered via the UIL Spring Meet Entry System.'),
    ooPBullet('BY ' + lcDate + ' at ' + lcTime + ', provide a copy of your light cues, complete and send your light cue sheet to me and ' + tech + '.'),
    ooPEmpty(120),
    // First / contact
    ooP('First, please contact me as soon as possible if there are any changes to your contact information, so that I can keep it up to date with information as it develops.  You can contact me directly at ' + cmEmail + '.', { size: 20, sa: 160 }),
    // Scripts
    ooPHead('Scripts'),
    ooP('Second, please send your scripts to the judges as soon as possible.  When you send scripts, do not send them in a way which requires a signature.  Because our judges are very busy during this time, they may be traveling and may not be available to sign.  Additionally, please ensure all scripts conform to the requirements of the UIL OAP Handbook, including cuts and highlights.  The judge\'s addresses are as followed:', { size: 20, sa: 120 }),
    ...judgeAddrs.map((j) => ooP(j.name, { size: 20, bold: true, indent: 360, sa: 30 }) + ooP(j.addr, { size: 20, indent: 360, sa: 80 })),
    judgeAddrs.length === 0 ? ooP('Adjudicator addresses will be provided once contracting is complete.', { size: 20, color: '777777', sa: 80 }) : '',
    // Light Cue
    ooPHead('Light Cue Sheet'),
    ooP('Third, please fill in the light cue sheet and submit it to the host school prior to the deadline of ' + lcDate + '.  ' + hs + ' has a fully programmable light board that can be programmed for performances.  ' + hs + ' has generously offered to pre-program each of the shows into its board so that rehearsal time will not need to be used to do so.  Please submit a completely filled out lighting cue sheet prior to ' + lcDate + ' at ' + lcTime + ' in order to have it pre-programmed.', { size: 20, sa: 120 }),
    ooP('ALL SHOWS WILL BE PROGRAMMED, SO IF YOU DO NOT HAVE YOUR CUE SHEET FILLED OUT PRIOR TO THE DEADLINE, YOU WILL HAVE TO USE REHEARSAL TIME TO PROGRAM CUES OR LEARN THE LIGHTBOARD MANUALLY.', { size: 20, bold: true, sa: 120 }),
    ooP('During rehearsal time, there will be a technician available to assist with any changes that need to be made to the lighting cues.  The cue sheet is just so that the majority of the work can be done before everyone starts rehearsal and can be adjusted and edited during your official rehearsal time.  If your technicians decide during rehearsal that they would rather run the light board manually, that is fine — please just let the technician know.  Remember, the light board will be completely in your hands once the show starts.', { size: 20, sa: 120 }),
    ooP('If you do not wish to use the programmable light board, then you will be responsible for learning the board during your rehearsal time.  If you would like to utilize the host school\'s sound board, please ensure you can connect to a 3.5 (aux) input with your device.', { size: 20, sa: 120 }),
    ooP('Programs will be sent out the week of the contest.  Please be sure that your company\'s names and information are correct on the Spring Meet system and in your advancement form, as that is the information we will use for the program.', { size: 20, sa: 200 }),
    // Contest and Rehearsal
    ooPHead('Contest and Rehearsal'),
    ooP('I look forward to meeting each of you personally and seeing the wonderful performances you have worked long hours to display.  As you know, the ' + lv + ' contest will be held on ' + cd + '.  Rehearsals will be held on ' + rDates + '.  I have attached a full schedule to this email for you to review.  If there are any conflicts, please email me as soon as possible so that we can help arrange an alternative solution.  If anything changes, I will update the schedule and send it out as soon as practicable.', { size: 20, sa: 120 }),
    ooP('The Director\'s Meeting will be held at ' + dm + ' on the day of the contest.  First show will begin at ' + fs + '.', { size: 20, sa: 200 }),
    // Paperwork
    ooPHead('Rehearsal Paperwork Verification'),
    ooP('To attempt to expedite the contest verification process before rehearsals and to reduce contact, I am happy to review all necessary documentation prior to rehearsals via email.  In order to do so, you may, through email, send me your evidence of royalty payment (or let me know your play is in public domain), publishers\' approval to produce and/or scenes for long plays, written evidence of UIL OAP approval if not on the approved list, a signed community standards and copyright compliance form, a signed and dated copy of the music log (optional), and any further permission from UIL for any specific alterations or exceptions.  You will still need to bring your integrity script to the rehearsal.', { size: 20, sa: 120 }),
    ooP('Otherwise, please be sure to bring all necessary paperwork to your rehearsal time.  I will verify that you have all of your paperwork prior to your rehearsal time beginning.  If you do not have all necessary paperwork AND your entry fee (if applicable), you will not be allowed to rehearse.', { size: 20, sa: 200 }),
    // Rehearsal procedures
    ooPHead('Rehearsal'),
    ooP('Rehearsals are ' + rehearsalMinutes + ' minutes in length, with 10 minutes of that allotted for load in and load out of the stage.  **You must arrive at least 20 minutes prior to your scheduled rehearsal time to unload, verify paperwork, and have a pre-rehearsal meeting with myself.  When you arrive, you may locate me in the ' + hv + ' stage area.  You will arrive at the loading dock and may unload anything you need into the covered area of the loading dock.  Please do not block any loading bay doors.  At or before your rehearsal time, I will instruct you to load onto the stage.  At that time, you may load all of your items into the stage wings or onto the stage — do not attempt to set up during this period.', { size: 20, sa: 120 }),
    ooP('After all items are in the stage area, we will quickly talk about rehearsal and then get started.  Once your vehicle has been unloaded, please park it in the back parking lot.  Please do not block the loading dock entrance or any doors.  Any additional vehicles may park in the back lot until the conclusion of your rehearsal time or until the end of the day.', { size: 20, sa: 120 }),
    ooP('Alternates listed on the Online Enrollment may assist with spiking the set and assist from the audience.  Alternates may not be backstage during the official rehearsal.  Any extra students not on the Eligibility Notice must remain on the bus until the performances start and supervised by an employee of your District.', { size: 20, sa: 120 }),
    ooP('Be prepared for Full Technical Disclosure.  This means you must show all technical aspects of the show at the rehearsal.  Place all set items, properties and set dressings on the stage.  We must see everything to approve.  No new items should be placed on stage during your performance.  Show all questionable blocking and stage combat.  Glow-tape is allowed as long as it is placed on stage during the 7 minute set up, and completely struck during the 7 minute strike time.', { size: 20, sa: 120 }),
    ooP('Plan on leaving your materials with us.  You will not have access to the loading dock after the rehearsal.  If you need to take any of your materials, please let me know prior to the end of rehearsal.  There will be a load in schedule for contest day, prepared by ' + hs + '.', { size: 20, sa: 200 }),
    // Setup and Performance
    ooPHead('Setting Up and Beginning Performance'),
    ooP('Each company will be given a warning when the show prior to them has begun.  Approximately 15 minutes before your performance time, prior to your official set up, the cast and crew will be asked to move their set materials to a staging area immediately outside of the auditorium stage door.  This must be done quietly.  Once moved, please be prepared to wait until the prior school is completely clear of the stage, generally around 5 minutes.  You have 7 minutes to move your set from your \'box\' and construct your set/tech.  Also during this time, set all props that will be needed for the opening of the show.  Careful not to drag or push anything.  The Contest Stage Manager will give the company audible warnings at one-minute intervals beginning at five minutes through 1 minute remaining.', { size: 20, sa: 120 }),
    ooP('Your time will start/stop after the agreed upon signal is given to the Contest Stage Manager.  You have a choice to set up in front of or behind the curtain.  The grand drape will be open during all set ups, unless requested prior or during your rehearsal time.  After set-up, there will be a recorded announcement that plays.  The performance time shall begin no more than 60 seconds after the end of the recorded announcement, unless the Contest Manager calls a "time-hold."  The Contest Manager will meet the cast backstage, send the Directors to the front of the house, and will confirm that the Adjudicator(s) is in place.', { size: 20, sa: 200 }),
    // Performance and Strike
    ooPHead('Performance and Strike'),
    ooP('The Contest Stage Manager will give a single verbal warning by way of the intercom headset to the student Stage Manager, or their agreed upon proxy, that 15 minutes and 35 minutes have elapsed.  It is then the responsibility for the performing company to end their show on time, and not go under the 18 minutes or over the 40 minute limits.  These procedures to be followed shall be reviewed with each cast at the official rehearsal and reviewed with directors at the Director Meeting.', { size: 20, sa: 120 }),
    ooP('The strike will follow immediately after the performance.  In your strike, you have 7 minutes to accomplish the following tasks: Unit Set to its storage area; your set pieces to the loading dock (outside the building); and the stage cleared.  Do not drag or push.  The Contest Stage Manager will give the company audible warnings at one-minute intervals beginning at five minutes through 1 minute remaining.', { size: 20, sa: 200 }),
    // Additional Items
    ooPHead('Additional Items'),
    ooP('UNIT SET: The complete unit set will be available for use, including one door (flat door, not screen), one window unit, and one set of French doors.  Contact the contest manager if you need any additional doors or windows and you may be asked to provide your own.  Everyone must use the basic set provided, including the in-house intercom system.  We will provide a 8\' step ladder and stage weights if needed.', { size: 20, sa: 120 }),
    ooP('DRESSING ROOMS: Each company will be provided with an on-site classroom for pre-show preparation and to stay in during the day.  Food and drink are allowed in the rooms during the contest day.  IF YOU NEED MIRRORS, YOU MUST BRING THEM as they are not guaranteed on site.  All dressing rooms must be left in the order they were found, including any desks, chairs, or other décor.  As a reminder, only directors, companies, crew, and alternates are allowed in the rooms throughout the day.', { size: 20, sa: 120 }),
    d.critiqueFormat === 'after_each'
      ? ooP('AWARDS AND CRITIQUES: Awards will be held after the judges have made their final decisions.  Each critique will be held immediately after each show has finished.  All critiques will be 20 minutes.  All must attend.  Contest Manager must be notified before the day of the contest if a participant will miss the critique.  They may only miss due to health or a conflicting UIL event.', { size: 20, sa: 120 })
      : ooP('AWARDS AND CRITIQUES: Awards will be held after the judges have made their final decisions.  Each critique will be held after all shows have finished.  Each judge will receive randomly assigned shows for critiques.  All critiques will be 15 minutes.  All must attend.  Contest Manager must be notified before the day of the contest if a participant will miss the critique.  They may only miss due to health or a conflicting UIL event.  We will allow a moment for each school to quietly leave after their critique.', { size: 20, sa: 120 }),
    ooP('LOAD OUT: After your show and strike period are completed, you will be asked to load directly out.  Please make arrangements for any vans, trucks, or buses to be staged at the loading dock ready for the end of your show.  Please discuss this with your contest manager before or after your rehearsal period if you have any questions regarding this.  ALL shows must be completely out of the stage and backstage area by the start of the awards ceremony.', { size: 20, sa: 120 }),
    ooP('AUDIENCE: An all-day admission charge of ' + af + ' will be collected from anyone not listed on the official online enrollment as cast, crew, alternates, or directors.  This charge applies to all high school administrators as well.  Audience members will be permitted to attend all shows during the contest day for one admission.', { size: 20, sa: 200 }),
    // Performance order table
    ooPHead('Performance Order'),
    ooTable2Col(schools.map((s) => [s.order + '.', s.name + (s.play ? '  —  ' + s.play : '')])),
    ooPEmpty(200),
    // Closing
    ooP('Please do not hesitate to contact me with any questions you may have regarding the competition.  Thank you for your time, and I hope to make everything go as smoothly as possible!', { size: 20, sa: 200 }),
    ooP('Play with Love,', { size: 20, sa: 360 }),
    ooP(cmName + ', J.D.', { bold: true, size: 20, sa: 40 }),
    ooP('UIL One-Act Play Contest Manager', { size: 18, color: '555555', sa: 20 }),
    cmPhone ? ooP(cmPhone, { size: 18, color: '555555', sa: 20 }) : '',
    cmEmail ? ooP(cmEmail, { size: 18, color: '2E75B6', sa: 20 }) : '',
    cmAddress ? ooP(cmAddress, { size: 18, color: '555555', sa: 20 }) : '',
    cmWebsite ? ooP(cmWebsite, { size: 18, color: '2E75B6', sa: 20 }) : '',
    ooPEmpty(120),
    ooP('Contest Site: ' + hs, { size: 18, color: '555555', sa: 20 }),
    ooP(hv + (ha ? ',  ' + ha : ''), { size: 18, color: '555555', sa: 0 }),
  ];
  return await makeDocx(parts.filter(Boolean).join('\n'));
}
