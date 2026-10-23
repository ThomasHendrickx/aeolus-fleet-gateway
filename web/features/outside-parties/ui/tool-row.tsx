import type { ReactNode } from 'react';

import { firstLineOf } from '../../add-server/tool-choice';
import { StatusBadge, Tag } from './status-badge';

/** A tool of an outside MCP server, as its row shows it. */
export interface ShownTool {
  name: string;
  description?: string | undefined;
  isReadOnly: boolean;
  isNew?: boolean;
}

/**
 * One tool in a list an approver scans (aeolus-fleet#1151): its switch, its
 * name, whether the server says it reads only, whether it is new, and its
 * description's first line, the whole description folded open on a click.
 */
export function ToolRow({ tool, control, testId }: { tool: ShownTool; control: ReactNode; testId?: string }) {
  const { name, description, isReadOnly, isNew = false } = tool;
  const firstLine = description === undefined ? '' : firstLineOf(description);
  const isFolded = description !== undefined && description.trim() !== firstLine;
  return (
    <li className="grid gap-1 border-b border-border py-2 last:border-b-0" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        {control}
        <span className="font-mono">{name}</span>
        {isReadOnly ? <Tag>reads only</Tag> : null}
        {isNew ? <StatusBadge tone="attention" label="New" /> : null}
      </div>
      {firstLine === '' ? null : isFolded ? (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer">{firstLine}</summary>
          <p className="mt-1 whitespace-pre-line">{description}</p>
        </details>
      ) : (
        <p className="text-muted-foreground">{firstLine}</p>
      )}
    </li>
  );
}
