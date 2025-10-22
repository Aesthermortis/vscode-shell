import { minimatch } from "minimatch";

export interface FileSettings {
  readonly [pattern: string]: boolean;
}

export class FileMatcher {
  private excludePatterns: string[] = [];
  private readonly excludeCache = new Map<string, boolean>();

  private pickTrueKeys(settings?: FileSettings): string[] {
    if (!settings) {
      return [];
    }

    return Object.entries(settings)
      .filter(([, value]) => value === true)
      .map(([key]) => key);
  }

  public configure(exclude?: FileSettings): void {
    this.excludeCache.clear();
    this.excludePatterns = this.pickTrueKeys(exclude);
  }

  public clear(): void {
    this.excludeCache.clear();
  }

  private relativeTo(fsPath: string, folder?: string): string {
    if (folder && fsPath.startsWith(folder)) {
      let cuttingPoint = folder.length;
      if (cuttingPoint < fsPath.length && fsPath.charAt(cuttingPoint) === "/") {
        cuttingPoint += 1;
      }
      return fsPath.slice(cuttingPoint);
    }
    return fsPath;
  }

  private match(excludePatterns: string[], filePath: string, root?: string): boolean {
    const relativePath = this.relativeTo(filePath, root);
    for (const pattern of excludePatterns) {
      if (minimatch(relativePath, pattern, { dot: true })) {
        return true;
      }
    }
    return false;
  }

  public excludes(fsPath: string, root?: string): boolean {
    if (!fsPath) {
      return true;
    }

    const cached = this.excludeCache.get(fsPath);
    if (cached !== undefined) {
      return cached;
    }

    const shouldBeExcluded = this.match(this.excludePatterns, fsPath, root);
    this.excludeCache.set(fsPath, shouldBeExcluded);
    return shouldBeExcluded;
  }
}
