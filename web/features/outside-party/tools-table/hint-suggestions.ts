/**
 * Suggest from hints (gateway scopes 4.3): the tools with no scope of their
 * own, split by what the server says of them. Hints are the server's claim,
 * never trusted on their own, so nothing applies until the approver confirms.
 */

interface HintedTool {
  name: string;
  isReadOnly?: boolean | undefined;
  isDestructive?: boolean | undefined;
  scopes: readonly string[];
}

/** The tools each picker would change, by name, and the ones without hints, left untouched. */
export interface HintSuggestions {
  readOnly: string[];
  other: string[];
  withoutHints: string[];
}

export function hintSuggestionsOf(tools: readonly HintedTool[]): HintSuggestions {
  const suggestions: HintSuggestions = { readOnly: [], other: [], withoutHints: [] };
  for (const tool of tools.filter(({ scopes }) => scopes.length === 0)) {
    if (tool.isDestructive === true || tool.isReadOnly === false) {
      suggestions.other.push(tool.name);
    } else if (tool.isReadOnly === true) {
      suggestions.readOnly.push(tool.name);
    } else {
      suggestions.withoutHints.push(tool.name);
    }
  }
  return suggestions;
}

/** The change the suggestions make with the scopes picked: a group whose picker is empty changes nothing. */
export function suggestedScopesOf(suggestions: HintSuggestions, picked: { readOnly: readonly string[]; other: readonly string[] }): { tool: string; scopes: string[] }[] {
  const group = (tools: readonly string[], scopes: readonly string[]) => (scopes.length === 0 ? [] : tools.map((tool) => ({ tool, scopes: [...scopes] })));
  return [...group(suggestions.readOnly, picked.readOnly), ...group(suggestions.other, picked.other)];
}
