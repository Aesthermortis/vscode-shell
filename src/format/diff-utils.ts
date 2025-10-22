import type { StructuredPatch } from "diff";
import { parsePatch, structuredPatch } from "diff";
import { Position, Range, TextEdit, Uri, WorkspaceEdit, type TextEditorEdit } from "vscode";
import { getExecutableFileUnderPath } from "./path-util.js";

let diffToolAvailable: boolean | null = null;

/**
 * Checks whether the system `diff` tool is discoverable on the PATH.
 * @returns True when the external diff binary is available.
 */
export function isDiffToolAvailable(): boolean {
  if (diffToolAvailable === null) {
    diffToolAvailable = getExecutableFileUnderPath("diff") != null;
  }
  return diffToolAvailable;
}

export const enum EditType {
  Delete,
  Insert,
  Replace,
}

export class Edit {
  public end: Position;
  public text = "";

  constructor(
    public action: EditType,
    public readonly start: Position,
  ) {
    this.end = start;
  }

  apply(): TextEdit {
    switch (this.action) {
      case EditType.Insert: {
        return TextEdit.insert(this.start, this.text);
      }
      case EditType.Delete: {
        return TextEdit.delete(new Range(this.start, this.end));
      }
      case EditType.Replace: {
        return TextEdit.replace(new Range(this.start, this.end), this.text);
      }
      default: {
        const actionDescription = String(this.action);
        throw new Error(`Unsupported edit type: ${actionDescription}`);
      }
    }
  }

  applyUsingTextEditorEdit(editBuilder: TextEditorEdit): void {
    switch (this.action) {
      case EditType.Insert: {
        editBuilder.insert(this.start, this.text);
        break;
      }
      case EditType.Delete: {
        editBuilder.delete(new Range(this.start, this.end));
        break;
      }
      case EditType.Replace: {
        editBuilder.replace(new Range(this.start, this.end), this.text);
        break;
      }
    }
  }

  applyUsingWorkspaceEdit(workspaceEdit: WorkspaceEdit, fileUri: Uri): void {
    switch (this.action) {
      case EditType.Insert: {
        workspaceEdit.insert(fileUri, this.start, this.text);
        break;
      }
      case EditType.Delete: {
        workspaceEdit.delete(fileUri, new Range(this.start, this.end));
        break;
      }
      case EditType.Replace: {
        workspaceEdit.replace(fileUri, new Range(this.start, this.end), this.text);
        break;
      }
    }
  }
}

export interface FilePatch {
  readonly fileName: string;
  readonly edits: Edit[];
}

type StructuredPatchHunk = StructuredPatch["hunks"][number];

/**
 * Converts structured diff output into a list of in-memory edits per file.
 * @param diffOutput Structured diff results produced by `jsdiff`.
 * @returns Collection of file patches containing VS Code edits.
 */
function parseUniDiffs(diffOutput: readonly StructuredPatch[]): FilePatch[] {
  return diffOutput.map((uniDiff) => ({
    fileName: uniDiff.oldFileName,
    edits: collectEditsFromHunks(uniDiff.hunks),
  }));
}

/**
 * Produces edits from two in-memory versions of the same file.
 * @param fileName Absolute or virtual file path used for diff metadata.
 * @param before Original text contents.
 * @param after Updated text contents.
 * @returns Patch describing the edits needed to transform `before` into `after`.
 */
export function getEdits(fileName: string, before: string, after: string): FilePatch {
  if (process.platform === "win32") {
    before = before.replaceAll("\r\n", "\n");
    after = after.replaceAll("\r\n", "\n");
  }

  const unifiedDiff = structuredPatch(fileName, fileName, before, after, "", "");
  const [filePatch] = parseUniDiffs([unifiedDiff]);
  return filePatch;
}

/**
 * Converts a unified diff string into a set of virtual file edits.
 * @param diffStr Unified diff payload, typically produced by `diff` or `jsdiff`.
 * @returns Collection of file patches reconstructed from the diff string.
 */
export function getEditsFromUnifiedDiffStr(diffStr: string): FilePatch[] {
  // Workaround for https://github.com/kpdecker/jsdiff/issues/135
  const sanitized = diffStr.startsWith("---")
    ? diffStr.replaceAll(/^---/gm, "Index\n---")
    : diffStr;

  const unifiedDiffs = parsePatch(sanitized);
  return parseUniDiffs(unifiedDiffs);
}

/**
 * Builds the aggregated edits for every hunk in the diff.
 * @param hunks Collection of structured diff hunks.
 * @returns Flat list of edits extracted from the hunks.
 */
function collectEditsFromHunks(hunks: StructuredPatch["hunks"]): Edit[] {
  const edits: Edit[] = [];
  for (const hunk of hunks) {
    applyHunkLines(hunk, edits);
  }
  return edits;
}

/**
 * Translates a single hunk into edits and appends them to the accumulator.
 * @param hunk Structured patch hunk describing line-level changes.
 * @param edits Accumulator receiving the generated edits.
 */
function applyHunkLines(hunk: StructuredPatchHunk, edits: Edit[]): void {
  let edit: Edit | null = null;
  let startLine = hunk.oldStart;

  for (const rawLine of hunk.lines) {
    switch (rawLine.charAt(0)) {
      case "-": {
        edit = buildDeletionEdit(edit, startLine);
        edit.end = new Position(startLine, 0);
        startLine += 1;
        break;
      }
      case "+": {
        edit = buildInsertionEdit(edit, startLine);
        edit.text += `${rawLine.slice(1)}\n`;
        break;
      }
      case " ": {
        startLine += 1;
        edit = flushPendingEdit(edit, edits);
        break;
      }
      default: {
        // Lines such as "\ No newline at end of file" are ignored.
        break;
      }
    }
  }

  flushPendingEdit(edit, edits);
}

/**
 * Ensures the current edit describes a deletion operation.
 * @param current Existing edit being built, if any.
 * @param startLine Current 1-based line number within the hunk.
 * @returns Edit representing the ongoing deletion.
 */
function buildDeletionEdit(current: Edit | null, startLine: number): Edit {
  if (current != null) {
    return current;
  }
  return new Edit(EditType.Delete, new Position(startLine - 1, 0));
}

/**
 * Ensures the current edit captures an insertion or replace action.
 * @param current Existing edit being built, if any.
 * @param startLine Current 1-based line number within the hunk.
 * @returns Edit prepared for appending inserted text.
 */
function buildInsertionEdit(current: Edit | null, startLine: number): Edit {
  if (current == null) {
    return new Edit(EditType.Insert, new Position(startLine - 1, 0));
  }

  if (current.action === EditType.Delete) {
    current.action = EditType.Replace;
  }

  return current;
}

/**
 * Pushes the pending edit into the accumulator when present.
 * @param current Existing edit being built, if any.
 * @param edits Accumulator receiving the edit.
 * @returns Resets the current edit so a new one can be started.
 */
function flushPendingEdit(current: Edit | null, edits: Edit[]): Edit | null {
  if (current != null) {
    edits.push(current);
  }
  return null;
}
