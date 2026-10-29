'use client';

import { useState } from 'react';

import { Switch } from '../../forms/ui/switch';
import { ToolRow } from '../../outside-parties/ui/tool-row';
import type { CheckedTool } from '../actions';
import { TOOL_ON_FIELD, TOOL_SHOWN_FIELD } from '../tool-choice';

/**
 * The tools the check answered, one row each. An approver switches each on
 * or off, all on to start; the fleet may call only those on (aeolus-fleet#1151).
 * Without gateway:approve they show without switches, and every tool starts on.
 */
export function ToolsSection({ tools, canSwitch }: { tools: CheckedTool[]; canSwitch: boolean }) {
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const onCount = tools.length - off.size;
  const flip = (name: string) => {
    setOff((current) => {
      const next = new Set(current);
      if (!next.delete(name)) {
        next.add(name);
      }
      return next;
    });
  };
  return (
    <section className="grid gap-2" data-testid="add-server-tools">
      <h2 className="flex flex-wrap justify-between gap-2 text-section font-semibold">
        <span>
          The server answers: {tools.length} {tools.length === 1 ? 'tool' : 'tools'}
        </span>
        {canSwitch ? (
          <span role="status" className="font-normal text-muted-foreground" data-testid="add-server-tools-on">
            {onCount} of {tools.length} on
          </span>
        ) : null}
      </h2>
      <p className="text-muted-foreground">{canSwitch ? 'The fleet may call only the tools switched on. A tool the server adds later starts off.' : 'Switching tools needs gateway:approve: every tool starts on, and an approver switches them on its page.'}</p>
      <ul className="grid">
        {tools.map((tool) => {
          const isOn = !off.has(tool.name);
          return (
            <ToolRow
              key={tool.name}
              tool={tool}
              testId="add-server-tool"
              control={
                canSwitch ? (
                  <>
                    <input type="hidden" name={TOOL_SHOWN_FIELD} value={tool.name} />
                    {isOn ? <input type="hidden" name={TOOL_ON_FIELD} value={tool.name} /> : null}
                    <Switch isOn={isOn} label={tool.name} onClick={() => { flip(tool.name); }} />
                  </>
                ) : null
              }
            />
          );
        })}
      </ul>
    </section>
  );
}
