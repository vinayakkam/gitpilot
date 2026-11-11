/** GitHub's suggested-change syntax: a fenced block GitHub offers to commit in place of the line. */
export function suggestionBlock(text: string): string {
  return "```suggestion\n" + text + "\n```";
}

/** Labels suggested-change blocks so they read as suggestions, not plain code. */
export function showSuggestions(body: string): string {
  return body.replace(/^```suggestion[ \t]*$/gm, "**Suggested change:**\n\n```");
}
