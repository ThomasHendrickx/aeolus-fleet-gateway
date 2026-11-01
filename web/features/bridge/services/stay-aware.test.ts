import { ALERT_CONTENT_TYPE } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { alertOf, clearsSaidOf, feedOf, healthHrefOf, unseenSaidOf } from './stay-aware';

// Stay aware (stay-aware.html, CC16): the alerts and notices not seen yet,
// then the ones seen, newest first; an opened alert names its ship, links its
// Health in the console and says what Aeolus does on clear.

const ALERT = {
  alertId: 'alr_01m6bx0dz59nqc0539gsxywrgd',
  headline: 'builder-gateway: no report change for 2 h',
  body: 'Its last report, 17:46: *Working: slice W9*.',
  ship: { id: 'shp_01m6bw3rg8n3xmqe91x19xm3y7', name: 'builder-gateway' },
  fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8sv',
  toldAs: 'owner',
  since: '2026-10-31T17:46:00.000Z',
  raisedAt: '2026-10-31T19:47:00.000Z',
  signal: 'report-unchanged',
  facts: { reportChangedAt: '2026-10-31T17:46:00.000Z', state: 'working', minutes: 45, setBy: 'shp_01m3tb1zhjs6kthtcs2zvksacv' },
};

function anItem(deliveryId: string, sentAt: string) {
  return { deliveryId, from: 'watch', title: `Item ${deliveryId}`, sentAt, job: 'stay-aware' as const };
}

describe('the stay-aware feed', () => {
  it('lists what is not seen yet and what was seen, newest first, marking the unseen new', () => {
    const unseen = [anItem('dlv_alert', '2026-10-31T19:47:00.000Z')];
    const seen = [anItem('dlv_release', '2026-10-31T15:00:00.000Z'), anItem('dlv_pr', '2026-10-31T19:41:00.000Z')];

    expect(feedOf({ unseen, record: seen.map((item) => ({ ...item, state: 'done' as const })) }).map(({ item, isNew }) => [item.deliveryId, isNew])).toEqual([
      ['dlv_alert', true],
      ['dlv_pr', false],
      ['dlv_release', false],
    ]);
  });

  it('leaves out of the seen ones every item of another job', () => {
    const record = [{ ...anItem('dlv_question', '2026-10-31T19:41:00.000Z'), job: 'decide' as const, state: 'done' as const }];

    expect(feedOf({ unseen: [], record })).toEqual([]);
  });

  it('lists an item the record holds and the person has not seen once, as unseen', () => {
    const unseen = [anItem('dlv_alert', '2026-10-31T19:47:00.000Z')];

    expect(feedOf({ unseen, record: [{ ...anItem('dlv_alert', '2026-10-31T19:47:00.000Z'), state: 'new' }] }).map(({ isNew }) => isNew)).toEqual([true]);
  });

  it('says how many are not seen yet', () => {
    expect(unseenSaidOf(1)).toBe('1 unseen');
  });
});

describe('an opened alert', () => {
  it('names the ship it is about', () => {
    expect(alertOf({ contentType: ALERT_CONTENT_TYPE, payload: JSON.stringify(ALERT) })).toEqual({ ship: { id: 'shp_01m6bw3rg8n3xmqe91x19xm3y7', name: 'builder-gateway' }, signal: 'report-unchanged' });
  });

  it('is no alert when it is a notice', () => {
    expect(alertOf({ contentType: 'application/vnd.aeolus.notice+json', payload: JSON.stringify({ headline: 'core 0.42.0 is out', body: 'Re-read a delivery.' }) })).toBeUndefined();
  });

  it('is no alert when its payload does not read as one', () => {
    expect(alertOf({ contentType: ALERT_CONTENT_TYPE, payload: '{"headline":' })).toBeUndefined();
  });

  it("links the ship's Health: its page in the fleet's console", () => {
    expect(healthHrefOf({ consoleUrl: 'https://fleet.aeolus-fleet.dev/', shipId: 'shp_01m6bw3rg8n3xmqe91x19xm3y7' })).toBe('https://fleet.aeolus-fleet.dev/ships/shp_01m6bw3rg8n3xmqe91x19xm3y7');
  });

  it('says it clears when the ship reports again, for a report that did not change', () => {
    expect(clearsSaidOf({ ship: ALERT.ship, signal: 'report-unchanged' })).toBe('Aeolus only tells you. The alert clears when builder-gateway reports again; nothing is sent on clear, so this stays here as it was.');
  });

  it('says it clears when what it tells of moves, for any other signal', () => {
    expect(clearsSaidOf({ ship: ALERT.ship, signal: 'delivery-unacknowledged' })).toBe('Aeolus only tells you. The alert clears by itself once what it tells of moves; nothing is sent on clear, so this stays here as it was.');
  });
});
