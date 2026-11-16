import { setTimeout as wait } from 'node:timers/promises';

/** One reading of aeolus_result: the text it answered. */
type Read = () => Promise<string>;

/** Reads a call's result until it is no longer the call's state, that is until the answer came. */
export async function readUntilAnswered(read: Read, polling: { attempts: number; pollMs: number }): Promise<string> {
  let text = await read();
  for (let attempt = 0; attempt < polling.attempts && text.includes('"state":"submitted"'); attempt += 1) {
    await wait(polling.pollMs);
    text = await read();
  }
  return text;
}
