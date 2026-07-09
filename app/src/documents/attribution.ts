/**
 * Authorship metadata stamped into every generated document's HIDDEN properties
 * (Word/Excel "Author" & "Company", PDF "Author"/"Creator"). This is provenance,
 * NOT visible content: it never appears on the page — so it does not deface the
 * official UIL forms or change what a contest manager sees — but it records who
 * and what produced the file. See IP_AND_MONETIZATION.md.
 *
 * These are static strings so document output stays deterministic (the golden
 * tests compare .docx/.xlsx metadata parts and hash the merged PDF).
 */

/** The author (the "Author" property). */
export const DOCUMENT_AUTHOR = 'Allen Otto';

/** The generating application (Word/Excel "Application", PDF "Creator"). */
export const DOCUMENT_APP = 'OAP Contest Manager';

/** Combined author+app used where a single creator string is wanted. */
export const DOCUMENT_AUTHOR_FULL = 'Allen Otto — OAP Contest Manager';
