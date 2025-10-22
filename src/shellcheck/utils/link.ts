/**
 * Builds the official ShellCheck wiki URL for the provided rule id.
 * @param ruleId Numeric or string rule identifier supplied by ShellCheck.
 * @returns Fully qualified wiki URL referencing the rule documentation.
 */
export function getWikiUrlForRule(ruleId: number | string): string {
  const asString = String(ruleId);
  const normalized = /^\s*SC\d+$/u.test(asString) ? asString : `SC${asString.replace(/^SC/u, "")}`;
  return `https://www.shellcheck.net/wiki/${normalized}`;
}
