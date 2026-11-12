import uilTableCss from '../documents/assets/uil/theater-tab-yui.css?raw';
import uilResponsiveCss from '../documents/assets/uil/theater-tab-yui-responsive.css?raw';
import { tabulationPrintHtml, type TabulationReport } from '../model/tabulationReport';

/**
 * Opens UIL's tabulation results page in a new window, the way UIL's tool does
 * (window.open + document.write), with UIL's two stylesheets inlined from the
 * app bundle so it prints offline. The CM prints from that window.
 *
 * Returns false when the browser blocked the window.
 */
export function openTabulationPrintPage(report: TabulationReport): boolean {
  const w = window.open('about:blank', '_blank');
  if (!w) return false;
  w.document.write(tabulationPrintHtml(report, [uilTableCss, uilResponsiveCss]));
  w.document.close();
  return true;
}
