# OAP_CTX v9 | 2026-03-17

## PROJECT
UIL One-Act Play Contest Manager. Single HTML generator (`OAP Contest Setup.html`) collects contest data → outputs ZIP of pre-filled docs. Browser-only, no server. Owner: Allen Otto (CM).

Status: v9. All doc generators built. Full UX suite complete. Adjudicator packet PDF generation added. Pre-Rehearsal Company Meeting form added (DOC 14). File is now ~1.31 MB (base64 PDFs embedded). ~2760+ lines JS.

---

## DECISIONS [do not revisit]
- **Stack**: SheetJS 0.18.5 + JSZip 3.10.1 (cdnjs) + pdf-lib 1.17.1 (unpkg). No npm, no server.
- **docx** = raw OOXML via JSZip. **xlsx** = SheetJS `cellStyles:true`.
- **Checklist DV removed**: JSZip 3.x bug #403 corrupts non-ASCII XML on round-trip. Done? col blank — users fill manually.
- **No Word SDT checkboxes** — don't render in Google Drive.
- **Schedule timing**: School 1 = 50 min (setup7+perf40+buffer3). Schools 2+ = 40 min (perf only). after_each transitions = 25 min. after_all transitions = 14 min. Critique block (after_all) = ceil(N/judges)×15 min.
- **No phone fields** for directors. Email only.
- **Snapshot scope** = stable year-over-year data only: Tier 1 fields + num_schools + schools/directors + directors_meeting_time + first_show_time. Excludes: dates, judges, play titles, deadlines, doc checkboxes, critique format.
- **Adjudicator packets**: official UIL PDFs embedded as base64; filled with pdf-lib; form.flatten() before page-copy merge. Only admin/header fields pre-filled; all rating/comment fields left blank for judges to complete on paper.
- **Adjudicator packet output**: single merged PDF (all judges in order: J1 evals+ranking+awards, J2 evals+ranking, J3 evals+ranking). Filename: `Adjudicator Packets.pdf` in ZIP subfolder.
- **Panelist field on Ranking Ballot**: dropdown only accepts A/B/C. J1=A, J2=B, J3=C.
- **Title field on Evaluation Ballot**: `School Name — Play Title` (e.g. "Westlake HS — Our Town"). Uses em-dash \u2014.
- **Conference field on Evaluation Ballot**: classification only (`vars.classification`, e.g. "5A"). NOT the full contest description.
- **Adj packets checkbox**: default UNCHECKED (slow PDF generation; only when judges are contracted and contest is near).
- **Full regeneration model**: user always regenerates full set.
- **Entry deadline default** = contest_date − 10 days. **Light cue time default** = 5:00 PM.
- **Director letter** = exact 2026 Allen real letter language, var substitution only.
- **ZIP folder name** = `{year} — {cls} {level} {num} OAP` (em-dash \u2014).

---

## STATE

### Primary file
`C:\Users\Allen\Desktop\Claude CoWork\OAP Documents\_Templates\OAP Contest Setup.html`
- Size: ~1.30 MB
- CDNs (in `<head>`): xlsx/0.18.5, jszip/3.10.1, **pdf-lib/1.17.1** (unpkg)

### PDF template files (source, already embedded as base64)
`C:\Users\Allen\Desktop\Claude CoWork\OAP Documents\Adjudicator Packet Templates\`
- `Interactive_Play-Evaluation-20181.pdf` — Evaluation Ballot (multi-page per school)
- `Adjudicator_Ballot_-_Ranking_Plays_for_Panel_use_Only_-_Writable_Form.pdf` — Panel Ranking Ballot
- `Awards_Acting_Ballot_updated_05.18.2023.pdf` — Acting Awards Ballot (Judge 1 only, sent blank)

### Page structure (top → bottom)
```
Banner
Shortcut Bar (11 pill buttons, centered, jump+auto-open sections)
Quick Links (4 UIL/Speechwire links)
[sec-snapshots]  📂 Saved Snapshots
[sec-cm]         👤 CM Info
[sec-t1]         📋 Contest Identity
[sec-t2]         📅 Contest Details
[sec-t3]         ⚖️ Adjudicators
[sec-schools]    🏫 Schools & Directors
[sec-plays]      🎭 Play Titles & Performance Order
[sec-docs]       📦 Documents to Generate  ← Check All / Uncheck All buttons
[sec-generate]   Generate button + status
All-Director Email List (always visible box)
[sec-email-composer]  ✉️ Email Draft Composer  ← collapsible, sec-email class
[sec-schedule-preview] 📋 Contest Day Schedule Preview ← collapsible, sec-sched class
[sec-critique]   🎲 Critique Assignment Randomizer ← collapsible, sec-critique class
```

### Section header labels (no tier prefixes)
- `sec-t1`: 📋 Contest Identity
- `sec-t2`: 📅 Contest Details  ← subsection order: Dates & Times → Competition Format → Rehearsals → Fees & Deadlines
- `sec-t3`: ⚖️ Adjudicators

### Shortcut bar labels → target IDs
Snapshots→sec-snapshots, CM Info→sec-cm, Contest ID→sec-t1, Contest Details→sec-t2, Adjudicators→sec-t3, Schools→sec-schools, Plays→sec-plays, Docs→sec-docs, Generate→sec-generate, Email Draft→sec-email-composer, Critiques→sec-critique

### Documents to Generate — UI order (all checked by default except noted)
1. Year-Round Checklist
2. Fall District Meeting Agenda
3. Host School Checklist
4. Schedule - Reh. and Contest
5. Contest Day Schedule
6. Director Information Letter
7. **Pre-Rehearsal Company Meeting (.docx)** ← added v9
8. Directors Meeting Script
9. Awards Script
10. Advancing Schools Letter
11. School-Director Contact List
12. Adjudicator Info Sheet
13. Adjudicator Packets (.pdf) — **default UNCHECKED**
14. Timer Instructions + Form (.docx) — **default UNCHECKED**

### Key JS functions (in script block order)
**Base64 PDF constants** (at very top of script, 3 huge var lines):
`EVAL_PDF_B64`, `RANK_PDF_B64`, `AWARDS_PDF_B64`

**UI Helpers**: `toggle`, `toggleDocCheck`, `setAllDocs(checked)`, `updateBidcField`, `updateJudgeFields`, `toggleHotelNights`, `updateRehearsalDay2UI/Count`, `updateContestName`, `autoCalcDeadlines`, `updateEmailList`, `copyEmails`, `copyContestName`, `addDirectorRow`, `removeDirRow`, `updateSchoolNameInPlay`, `updateSchoolFields`

**Snapshots**: `OAP_SNAP_KEY/FIELDS/SELECTS`, `serializeState()`, `restoreState(data)`, `getSnapshots()`, `exportSnapshots()`, `importSnapshots(input)`, `getSnapshotSchools()`, `applySchoolSuggestion(idx,name)`, `attachSchoolAutocomplete(idx)`, `saveSnapshot()`, `loadSnapshot(name)`, `deleteSnapshot(name)`, `renderSnapshotList()`

**Email**: `EMAIL_TEMPLATES` (announcement/deadline/daybefore/judges), `loadEmailTemplate(key)`, `copyEmailSubject()`, `copyEmailBody()`

**Init line**: `updateJudgeFields(); updateSchoolFields(); updateContestName(); renderSnapshotList();`

**Utilities**: `gv(id)`, `parseTime(str)`, `fmtTime(mins)`, `fmtDate(ds)`, `fmtDateShort(ds)`, `fmtDateNumeric(ds)`, `xe(s)`

**Core**: `collectVars()`, `calculateSchedule(vars)`, `updateSchedulePreview()`

**OOXML helpers**: `ooP`, `ooPHead`, `ooPBullet`, `ooPEmpty`, `ooPLine`, `ooPSignLine`, `ooPPageBreak`, `ooTable2Col`, `makeDocx`

**Doc generators** (DOC 1–14): `genDirectorLetter`, `genContestSchedule`, `genRehearsalSchedule`, `genContactList`, `genAdjudicatorInfo`, `genChecklist`, `genAwardsScript`, `genDirectorsMeetingScript`, `genTimerDoc`, `genFallAgenda`, `genHostChecklist`, `genAdvancingLetter`, `genPreRehearsalMeeting`

**ZIP builder**: `generateAll()` — validation → wantXxx flags (incl. `wantAdjPackets`, `wantPreRehearsalMeeting`) → per-doc conditionals → adj packets block (gated on `wantAdjPackets && typeof PDFLib !== 'undefined'`) → count===0 check → ZIP packaging

**Section jump**: `jumpTo(id)` — scrollIntoView + auto-opens collapsed section

**Critique randomizer**: `_critiqueAssignments` (module var), `runCritiqueRandomizer()`, `generateCritiqueAssignments()`, `renderCritiqueAssignments()`

**PDF helpers**: `_b64ToBytes(b64)`, `genAdjudicatorPackets(vars)`

**Dark mode**: `toggleDarkMode()`, IIFE on load to restore from `localStorage('oap_dark')`. Filter applied to `.container`, not `body`, to avoid fixed-position stacking context bug.

### Critique Assignment Algorithm
- J1 gets `floor(N/J)` schools (fewer if not evenly divisible)
- Remainder distributed randomly among J2+ (some get baseOther, some baseOther+1)
- `after_each` constraint: last school (schools[N-1] in performance order) must be assigned to J2+. Pre-assigned to random eligible judge before shuffle.
- Output table: # | School | Play Title | Judge Assigned (colored by judge index). Summary row below.
- Confirm guard if `_critiqueAssignments` already set. Regenerates fully each click.

### PDF form field mapping
**Evaluation Ballot** fields filled:
- `Title` = `School Name — Play Title` (em-dash, e.g. "Westlake HS — Our Town")
- `Date` = contest_date_short
- `Performance Order` = school.order
- `Conference` = vars.classification only (e.g. "5A")
- `Contest Site` = host_venue_name
- `Judge` = judge name
- Level checkbox: Check Box6=Zone / 7=District / 8=BiDistrict / 9=Area / 10=Region / 11=State
- All rating/comment fields left blank.

**Ranking Ballot** fields filled: `Panelist` dropdown (A/B/C), `Conference` dropdown (classification e.g. "5A"), `Level/Zone` dropdown (Zone/District/Bi District/Area/Region/State), `Play 1`–`Play 8`=play titles, `School`/`School_2`–`School_8`=school names. Rank fields left blank.

**Awards Ballot**: nothing filled (sent completely blank, Judge 1 packet only).

### CSS additions
`.sec-critique .section-header { background:#F3E5F5 }` (purple)
`.sec-email .section-header { background:#E3F2FD }` (blue)
`.sec-sched .section-header { background:#E0F2F1 }` (teal)
`.shortcut-bar`, `.shortcut-bar-label`, `.shortcut-bar-btns`, `.sc-btn` (pill nav buttons)
`body.dark-mode .container { filter:invert(1) hue-rotate(180deg); }` (dark mode on container, not body)
`#darkModeBtn` — fixed position bottom-right, persists via localStorage

### Existing design details (unchanged)
**Schedule colors** (school idx 0–7): `['FEF2CB','B4C6E7','F4B083','C5E0B3','FFFF00','FFC000','E06666','CCA3FF']`. Header: `000000`. Admin/grey: `DADADA`.

**CM pre-fills**: name=Allen Otto, email=aotto3@gmail.com, phone=281-777-8672, addr=8010 Sharpcrest Street Houston TX 77036, website=www.allenotto.com

**Directors Meeting sections** (order): Introductions → Judges Address Group (per-judge email blank) → Critique Order → Evaluations → DISMISS JUDGES → Opening/Closing Cues + Outstanding Technician (combined, per school) → Backstage Timekeeper Timing → Dressing Rooms → Additional Items → ANY OTHER QUESTIONS?

**Timer Doc**: Page 1=Instructions (Pre-Contest Duties, Contest Duties incl. "DO NOT CLEAR WATCHES…", Timekeeper Script, Time Warnings). Page 2=Form table cols: SHOW|SCHOOL|PERFORMANCE|SETUP|STRIKE (no MUSIC col).

**Rehearsal Schedule**: 1-day/2-day/same-day formats. `rehearsal_length_minutes`+10 min transition. SCHOOL col = "Name — Play Title". Colors cycle by perf order.

**Pre-Rehearsal Company Meeting** (`genPreRehearsalMeeting`): one-page .docx used by CM during each company's rehearsal slot. Strictly replicates the template — only variable substitutions: contest name (title line), rehearsal length (intro paragraph), school name + em-dash + play title (table School column). Layout: two centered title lines (13pt bold / 11pt bold) → Introduction paragraph (soft break + bold label + 9pt body with rehDisplay) → Stage Manager (bold 11pt label + 10pt fill-in, indented timing line) → Lights/Sound (bold 11pt header, 10pt fill-in lines) → Curtains (soft break + bold 11pt header, 10pt fill-in lines + two indented notes) → 4-column table (light gray #E7E6E6 header row, 8pt bold; School Name — Play Title bold | Spike Tape blank | Upstage Curtain ☐CYC/☐Back Black | Strike Lead blank) → empty para → Show Start Procedure (soft break + bold 10pt header, 9pt arrow-chain line) → After Your Show (soft break + bold 11pt header, two indented 10pt lines) → Full Disclosure (bold 11pt, body lines) → "No tobacco…" / "No cell phones." → empty para → "What questions do you have for me?" bold 10pt. Uses local helpers `rp()` (run props) and `pp()` (para props with line=240/auto). No checkboxes on section headers, no colors, no decorative lines. Checkbox `doc_pre_rehearsal_meeting` defaults checked; positioned after Director Information Letter in UI.

**Email templates** (4): announcement (no entry fee), deadline (entry+light cue deadlines, no entry fee, name+phone sig), daybefore, judges (show list by perf order, critique format text, arrival=DM−20 min).

---

## TASKS [priority order]
1. *(none pending)*

---

## CONSTRAINTS
- **Official PDF forms MUST be used** — cannot create substitute layouts. Only fill admin/header fields. All judge-completing fields left blank.
- Output must work in **Google Sheets natively**. Data validation, cell colors must survive Drive import.
- **Letter language is fixed**: exact 2026 wording. Var substitution only.
- **Schedule must match reference xlsx**: cols START/END/WHAT/SCHOOL, same colors, same row types.
- All generation client-side. No fetch/server calls.
- Director's Meeting row in schedule: same color as School 1 (FEF2CB).
- CM arrival (multi-day) = DM − 120 min. CM arrival (same-day) = rehearsal_start − 60 min.
- Multiple directors per school: primary = directors[0]. All emails in list + contact sheet.
- `doc_adj_packets` defaults unchecked (slow; only use when judges contracted).

---

## TERMINOLOGY
- **CM** = Contest Manager (Allen Otto)
- **OAP** = UIL One-Act Play
- **UIL** = University Interscholastic League (Texas)
- **BIDC/BiDistrict** = next level above District
- **Tiers 1–3** = data phases (T1=upon appointment, T2=after planning mtg, T3=after adjudicator contracting). UI section labels now show descriptions only: "Contest Identity", "Contest Details", "Adjudicators" (no "Tier N —" prefix).
- **after_each / after_all** = critique format radio options
- **FIRST_SLOT=50, PERF_ONLY=40** = school slot durations in minutes
- **DV** = data validation — removed (bug)
- **OOXML** = raw XML for .docx/.xlsx
- **cellStyles:true** = SheetJS CE write option for fill/font styles
- **pdf-lib** = PDFLib global (from unpkg CDN); used for adjudicator packet PDF filling/merging
- **AP stream / flatten** = pdf-lib: flatten() embeds filled field values into page content for print-safe merged PDF

---

## AMBIGUITIES / PENDING
*(none)*
