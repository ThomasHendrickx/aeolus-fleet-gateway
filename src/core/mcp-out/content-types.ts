/**
 * The content types that carry an outside tool's call and its result over
 * the fleet (orchestrator-1 on aeolus-fleet#876, Q7): the input type names
 * the tool, and its payload is the tool's arguments as a JSON object; the
 * result type names the tool too, and its payload is the tool's result.
 */

const TOOL_INPUT = 'application/vnd.aeolus.mcp-tool+json';
const TOOL_RESULT = 'application/vnd.aeolus.mcp-result+json';

export function toolInputType(tool: string): string {
  return `${TOOL_INPUT}; name=${tool}`;
}

export function toolResultType(tool: string): string {
  return `${TOOL_RESULT}; name=${tool}`;
}

/** The tool a message of this content type calls; none for another type, or the input type without a name. */
export function toolCalledBy(contentType: string): string | undefined {
  const [type, ...parameters] = contentType.split(';').map((part) => part.trim());
  if (type?.toLowerCase() !== TOOL_INPUT) {
    return undefined;
  }
  const name = parameters.find((parameter) => parameter.toLowerCase().startsWith('name='))?.slice('name='.length);
  return name === undefined || name === '' ? undefined : name;
}
