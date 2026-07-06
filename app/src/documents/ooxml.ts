/**
 * Shared OOXML + theme utilities for .docx generation.
 *
 * Ported VERBATIM from the v12 single-file app (_Templates/OAP Contest Setup.html):
 * the THEME constants (~line 617), the RAW OOXML paragraph/table helpers
 * (~lines 1746–1799), the xe() escaper (~line 1434), and makeDocx (~lines
 * 1800–1827). These emit the raw WordprocessingML that every .docx generator
 * shares (this slice's Director Information Letter, and the document ports in
 * slices 7–9). Do NOT fork or "improve" the markup, fonts, sizes, or spacing —
 * the golden files lock this exact output in, byte-for-byte at the XML level.
 *
 * Pure except makeDocx, which packs the body XML into a .docx (itself a ZIP)
 * with JSZip and is therefore async, matching the rest of the generate pipeline.
 * No DOM anywhere.
 */

import JSZip from 'jszip';

/** Named styling constants for OOXML docs and XLSX sheets (v12 THEME). */
export const THEME = {
  doc: {
    font: 'Calibri',
    color: '222222',
    headColor: '1F4E79',
    lineColor: 'CCCCCC',
    signColor: '444444',
    bodySize: 20,
    headSize: 22,
    indent: 360,
    spaceAfter: 120,
    headSb: 200,
    headSa: 80,
    bulletSa: 60,
  },
  xlsx: {
    font: 'Calibri',
    titleSz: 13,
    headerSz: 11,
    footnoteSz: 10,
    black: '000000',
    grey: 'DADADA',
  },
} as const;

/**
 * XML-escapes a value for safe insertion into OOXML text/attributes. Escapes
 * &, <, >, and " — always call this on any user-supplied string before
 * concatenating it into markup. Ported from v12 xe().
 */
export function xe(s: unknown): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Paragraph options for ooP (v12's opts bag). */
export interface OoPOpts {
  align?: string;
  /** Space-before, in twentieths of a point. */
  sb?: number;
  /** Space-after, in twentieths of a point. */
  sa?: number;
  /** Left indent, in twips. */
  indent?: number;
  /** Half-points (v12 sizes are already doubled, e.g. 20 = 10pt). */
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  font?: string;
  ul?: boolean;
}

/** A single styled paragraph. Ported from v12 ooP(). */
export function ooP(text: string, opts: OoPOpts = {}): string {
  const o = opts;
  const align = o.align || '';
  const sb = o.sb != null ? o.sb : 0;
  const sa = o.sa != null ? o.sa : THEME.doc.spaceAfter;
  const indent = o.indent || 0;
  const size = o.size || THEME.doc.bodySize;
  const color = o.color || THEME.doc.color;
  const bold = o.bold || false;
  const italic = o.italic || false;
  const font = o.font || THEME.doc.font;
  const ul = o.ul || false;
  const ppr =
    '<w:pPr>' +
    (align ? '<w:jc w:val="' + align + '"/>' : '') +
    '<w:spacing w:before="' + sb + '" w:after="' + sa + '"/>' +
    (indent ? '<w:ind w:left="' + indent + '"/>' : '') +
    (ul ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '') +
    '</w:pPr>';
  const rpr =
    '<w:rPr><w:rFonts w:ascii="' + font + '" w:hAnsi="' + font + '"/>' +
    (bold ? '<w:b/><w:bCs/>' : '') +
    (italic ? '<w:i/><w:iCs/>' : '') +
    '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/><w:color w:val="' + color + '"/></w:rPr>';
  return '<w:p>' + ppr + '<w:r>' + rpr + '<w:t xml:space="preserve">' + xe(text) + '</w:t></w:r></w:p>';
}

/** An empty spacer paragraph. Ported from v12 ooPEmpty(). */
export function ooPEmpty(sa?: number): string {
  return (
    '<w:p><w:pPr><w:spacing w:before="0" w:after="' +
    (sa != null ? sa : THEME.doc.spaceAfter) +
    '"/></w:pPr></w:p>'
  );
}

/** A thin horizontal rule. Ported from v12 ooPLine(). */
export function ooPLine(color?: string): string {
  const c = color || THEME.doc.lineColor;
  return (
    '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="' +
    c +
    '"/></w:pBdr><w:spacing w:before="60" w:after="60"/></w:pPr></w:p>'
  );
}

/** A section heading. Ported from v12 ooPHead(). */
export function ooPHead(text: string, color?: string): string {
  return ooP(text, {
    bold: true,
    size: THEME.doc.headSize,
    color: color || THEME.doc.headColor,
    sb: THEME.doc.headSb,
    sa: THEME.doc.headSa,
  });
}

/** An indented bullet-ish body paragraph. Ported from v12 ooPBullet(). */
export function ooPBullet(text: string): string {
  return ooP(text, { size: THEME.doc.bodySize, indent: THEME.doc.indent, sa: THEME.doc.bulletSa });
}

/** A blank signature line (bottom border). Ported from v12 ooPSignLine(). */
export function ooPSignLine(indent?: number, sa?: number): string {
  const i = indent || 0;
  const s = sa != null ? sa : THEME.doc.spaceAfter;
  return (
    '<w:p><w:pPr><w:spacing w:before="60" w:after="' + s + '"/>' +
    '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="' + THEME.doc.signColor + '"/></w:pBdr>' +
    (i ? '<w:ind w:left="' + i + '"/>' : '') +
    '</w:pPr></w:p>'
  );
}

/** A hard page break. Ported from v12 ooPPageBreak(). */
export function ooPPageBreak(): string {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

/** A bordered two-column table. Ported from v12 ooTable2Col(). */
export function ooTable2Col(rowsData: Array<[string, string] | string[]>): string {
  const W1 = 2400,
    W2 = 6800;
  const rows = rowsData
    .map((r) => {
      const c1 = r[0] || '',
        c2 = r[1] || '';
      return (
        '<w:tr>' +
        '<w:tc><w:tcPr><w:tcW w:w="' + W1 + '" w:type="dxa"/><w:tcMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>' +
        '<w:p><w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr>' +
        '<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:bCs/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>' +
        '<w:t xml:space="preserve">' + xe(c1) + '</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:tcPr><w:tcW w:w="' + W2 + '" w:type="dxa"/><w:tcMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>' +
        '<w:p><w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr>' +
        '<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="222222"/></w:rPr>' +
        '<w:t xml:space="preserve">' + xe(c2) + '</w:t></w:r></w:p></w:tc>' +
        '</w:tr>'
      );
    })
    .join('\n');
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="' + (W1 + W2) + '" w:type="dxa"/>' +
    '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>' +
    '<w:left w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>' +
    '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>' +
    '<w:right w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>' +
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="EEEEEE"/>' +
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="EEEEEE"/>' +
    '</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="' + W1 + '"/><w:gridCol w:w="' + W2 + '"/></w:tblGrid>' +
    rows +
    '</w:tbl>'
  );
}

/**
 * Wraps body XML into a complete .docx (a ZIP: [Content_Types].xml, _rels/.rels,
 * word/document.xml + its rels, and the sectPr page setup). Ported from v12
 * makeDocx(). Async because a .docx is itself a ZIP built by JSZip.
 */
export async function makeDocx(bodyXml: string): Promise<Uint8Array> {
  const CT =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';
  const RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';
  const DOC =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14">' +
    '<w:body>' + bodyXml +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1080" w:right="1296" w:bottom="1080" w:left="1296" w:header="720" w:footer="720" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CT);
  zip.folder('_rels')!.file('.rels', RELS);
  zip.folder('word')!.file('document.xml', DOC);
  zip
    .folder('word/_rels')!
    .file(
      'document.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
    );
  return await zip.generateAsync({ type: 'uint8array' });
}
