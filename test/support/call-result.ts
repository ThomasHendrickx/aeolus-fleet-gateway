import { setTimeout as wait } from 'node:timers/promises';

/** One reading of aeolus_result: the text it answered. */
type Read = () => Promise<string>;

/** The states of a call whose answer did not come yet. */
const STATES = ['submitted', 'working'];

/** Reads a call's result until it is no longer the call's state (submitted, or working once the ship took it), that is until the answer came. */
export async function readUntilAnswered(read: Read, polling: { attempts: number; pollMs: number }): Promise<string> {
  let text = await read();
  for (let attempt = 0; attempt < polling.attempts && STATES.some((state) => text.includes(`"state":"${state}"`)); attempt += 1) {
    await wait(polling.pollMs);
    text = await read();
  }
  return text;
}
