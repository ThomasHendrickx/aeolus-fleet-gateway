import type { MeetingView } from '../services/meeting';

/** How a participant's crew and place in the meeting read (M13, M14): presence is shown, never checked. */
const STATUS_WORDS = { crewed: 'crewed', awaitingCrew: 'awaiting crew', retired: 'retired' } as const;
const STATE_WORDS = { present: 'in the meeting', left: 'left', revoked: 'revoked' } as const;

/** Who takes part, each with whether it is crewed now and whether it is in the meeting. */
export function Participants({ participants }: { participants: MeetingView['participants'] }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-section font-semibold">Participants · {participants.length}</h2>
      <ul data-testid="meeting-participants" className="grid gap-1">
        {participants.map((participant) => (
          <li key={participant.shipId} className="flex flex-wrap justify-between gap-2">
            <span>{participant.name}</span>
            <span className="text-caption text-muted-foreground">
              {STATUS_WORDS[participant.status]} · {STATE_WORDS[participant.state]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
