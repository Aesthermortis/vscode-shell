import * as vscode from "vscode";
import { getWikiUrlForRule } from "./utils/link.js";

export class LinkifyProvider implements vscode.DocumentLinkProvider {
  public provideDocumentLinks(
    document: vscode.TextDocument,
  ): vscode.ProviderResult<vscode.DocumentLink[]> {
    const text = document.getText();
    const directivePattern = /^[ \t]*#[ \t]*shellcheck[ \t]+disable=.+$/gm;
    const result: vscode.DocumentLink[] = [];

    for (const match of text.matchAll(directivePattern)) {
      const matchIndex = typeof match.index === "number" ? match.index : -1;
      if (matchIndex < 0) {
        continue;
      }
      const startPosition = document.positionAt(matchIndex);
      collectMatchesOnLine(startPosition, match[0], result);
    }

    return result;
  }
}

/**
 * Collects shellcheck rule references in a single directive line and linkifies them.
 * @param startPosition Position where the directive begins.
 * @param line Line content containing the directive.
 * @param result Accumulator for the generated document links.
 */
function collectMatchesOnLine(
  startPosition: vscode.Position,
  line: string,
  result: vscode.DocumentLink[],
): void {
  const pattern = /\b(?:SC)?\d{4}\b/g;
  for (const match of line.matchAll(pattern)) {
    const matchIndex = typeof match.index === "number" ? match.index : -1;
    if (matchIndex < 0) {
      continue;
    }
    const ruleId = match[0];
    const url = getWikiUrlForRule(ruleId);
    const position = startPosition.translate(0, matchIndex);
    const range = new vscode.Range(position, position.translate(0, ruleId.length));
    result.push(new vscode.DocumentLink(range, vscode.Uri.parse(url)));
  }
}
