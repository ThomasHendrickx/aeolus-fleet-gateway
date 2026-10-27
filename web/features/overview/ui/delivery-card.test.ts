import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DeliveryCard } from './delivery-card';

describe('a meeting notice on the Overview', () => {
  it('says who added the person to the named meeting instead of its JSON payload', () => {
    const markup = renderToStaticMarkup(
      createElement(DeliveryCard, {
        delivery: {
          deliveryId: 'dlv_01',
          from: 'chief-of-staff',
          title: 'You were added to a meeting',
          sentAt: '2026-10-27T10:00:00.000Z',
          contentType: 'application/vnd.aeolus.meeting.added+json',
          payload: '{"meetingId":"mtg_01m5qa5j85mgd4z61d9c2k4mtg","title":"Weekly heads","owner":{"id":"shp_01m5qa5j85mgd4z61d9c2k0001","name":"chief-of-staff"},"moderator":{"id":"shp_01m5qa5j85mgd4z61d9c2k0001","name":"chief-of-staff"},"participants":[]}',
          question: undefined,
          meetingId: 'mtg_01',
        },
        meetingHref: '/meetings/mtg_01',
        note: '',
        working: undefined,
        failure: undefined,
        onNoteChange: () => undefined,
        onAnswer: () => undefined,
        onDone: () => undefined,
        onBack: () => undefined,
      }),
    );

    expect(markup).toContain('chief-of-staff added you to the meeting “Weekly heads”.');
    expect(markup).toContain('Go to the meeting');
    expect(markup).not.toContain('{&quot;meetingId&quot;');
  });
});
