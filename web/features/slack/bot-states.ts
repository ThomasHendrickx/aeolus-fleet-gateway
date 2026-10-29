/** How a bot's state shows on the Slack page (gateway scopes 9.2). */
export const BOT_STATES = {
  made: { tone: 'waiting', label: 'Made' },
  waitingForInstall: { tone: 'waiting', label: 'Waiting for install' },
  inSlack: { tone: 'ok', label: 'In Slack' },
  removedInSlack: { tone: 'attention', label: 'Removed in Slack' },
} as const;
