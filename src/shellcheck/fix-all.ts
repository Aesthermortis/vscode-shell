import * as vscode from "vscode";

/**
 * Executes the built-in code action provider command for the given range.
 * @param uri Document URI where the command should run.
 * @param range Range to pass to the provider.
 * @returns List of code actions provided at the range.
 */
async function executeCodeActionProvider(
  uri: vscode.Uri,
  range: vscode.Range,
): Promise<readonly vscode.CodeAction[]> {
  const result = await vscode.commands.executeCommand<readonly vscode.CodeAction[] | undefined>(
    "vscode.executeCodeActionProvider",
    uri,
    range,
  );
  return result ?? [];
}

/**
 * Returns every ShellCheck code action (isPreferred with edit) for diagnostics.
 * @param document Target document.
 * @returns ShellCheck code actions grouped by diagnostic range.
 */
async function collectShellCheckActions(
  document: vscode.TextDocument,
): Promise<readonly vscode.CodeAction[]> {
  const diagnostics = vscode.languages
    .getDiagnostics(document.uri)
    .filter((diagnostic) => diagnostic.source === "shellcheck");

  const actions: vscode.CodeAction[] = [];
  for (const diagnostic of diagnostics) {
    const providedActions = await executeCodeActionProvider(document.uri, diagnostic.range);
    const filtered = providedActions.filter((action) => {
      return (
        action.title.startsWith("ShellCheck: ") &&
        action.isPreferred === true &&
        action.edit instanceof vscode.WorkspaceEdit
      );
    });
    actions.push(...filtered);
  }

  return actions;
}

/**
 * Merges workspace edits by ignoring overlapping edits that would conflict.
 * @param target Edit accumulating all fixes.
 * @param source Edit to merge into the target.
 */
function mergeEdits(target: vscode.WorkspaceEdit, source: vscode.WorkspaceEdit): void {
  for (const [uri, edits] of source.entries()) {
    const existing = target.get(uri) ?? [];
    const merged = [...existing];
    for (const edit of edits) {
      if (!existing.some((existingEdit) => existingEdit.range.contains(edit.range))) {
        merged.push(edit);
      }
    }
    target.set(uri, merged);
  }
}

/**
 * Builds the combined fix-all code action from the individual ShellCheck fixes.
 * @param document Document requesting the action.
 * @returns Aggregated fix-all code action, or undefined when no fixes exist.
 */
async function buildFixAllAction(
  document: vscode.TextDocument,
): Promise<vscode.CodeAction | undefined> {
  const actions = await collectShellCheckActions(document);
  if (actions.length === 0) {
    return undefined;
  }

  const fixAll = new vscode.CodeAction(
    "ShellCheck: Fix all auto-fixable issues",
    FixAllProvider.fixAllCodeActionKind,
  );

  const aggregatedEdit = new vscode.WorkspaceEdit();
  const aggregatedDiagnostics: vscode.Diagnostic[] = [];

  for (const action of actions) {
    if (action.diagnostics) {
      aggregatedDiagnostics.push(...action.diagnostics);
    }
    mergeEdits(aggregatedEdit, action.edit!);
  }

  if (aggregatedDiagnostics.length > 0) {
    fixAll.diagnostics = aggregatedDiagnostics;
  }
  fixAll.edit = aggregatedEdit;

  return fixAll;
}

export class FixAllProvider implements vscode.CodeActionProvider {
  public static readonly fixAllCodeActionKind =
    vscode.CodeActionKind.SourceFixAll.append("shellcheck");

  public static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [FixAllProvider.fixAllCodeActionKind],
  };

  public async provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): Promise<vscode.CodeAction[]> {
    if (!context.only) {
      return [];
    }

    if (
      !context.only.contains(FixAllProvider.fixAllCodeActionKind) &&
      !FixAllProvider.fixAllCodeActionKind.contains(context.only)
    ) {
      return [];
    }

    const fixAllAction = await buildFixAllAction(document);
    return fixAllAction ? [fixAllAction] : [];
  }
}
