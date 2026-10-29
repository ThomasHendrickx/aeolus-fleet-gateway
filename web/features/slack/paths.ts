/** The Slack pages (gateway scopes 9.6). */
export const SLACK_PATH = '/slack';

export const DISCONNECT_SLACK_PATH = `${SLACK_PATH}/disconnect`;

export const EXPOSE_SHIP_PATH = `${SLACK_PATH}/expose`;

/** The confirm before a ship's bot is removed. */
export function removeBotPath(appId: string): string {
  return `${SLACK_PATH}/remove?${new URLSearchParams({ app: appId }).toString()}`;
}
