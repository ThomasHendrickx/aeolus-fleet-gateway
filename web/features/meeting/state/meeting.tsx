import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';
import { Notice } from '../../overview/ui/notice';
import { NoSignIn } from '../../sign-in/ui/no-sign-in';
import { readMeeting } from '../hooks/read-meeting';
import { MEETINGS_PATH, meetingPathOf } from '../paths';
import { micLineOf, standingOf } from '../services/meeting';
import { Contributions } from '../ui/contributions';
import { Participants } from '../ui/participants';
import { MeetingControls } from './meeting-controls';

/**
 * A meeting the person takes part in (decision 0061, M19), phone first:
 * where they stand on the mic and what they may do now at the top, then the
 * contributions, newest first, and who takes part. Reading it confirms no
 * delivery: each contribution still waits in their inbox.
 */
export async function Meeting({ meetingId, searchParams }: { meetingId: string; searchParams: SearchParams }) {
  const page = await signedInPage({ path: `${MEETINGS_PATH}/${encodeURIComponent(meetingId)}`, searchParams });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  const { cursor } = searchParams;
  const read = await readMeeting(page.api, { meetingId, cursor: typeof cursor === 'string' ? cursor : undefined });
  const overview = `/overview?fleet=${encodeURIComponent(page.fleetId)}`;
  if (!read.isOk) {
    return (
      <div className="grid gap-4">
        <Notice message={read.refusal} isFailure />
        <a href={overview} className="text-muted-foreground hover:underline">
          ← Overview
        </a>
      </div>
    );
  }
  const meeting = read.value;
  const standing = standingOf(meeting);
  const here = meetingPathOf({ fleetId: page.fleetId, meetingId });
  return (
    <div data-testid="meeting" className="grid gap-6">
      <a href={overview} className="text-muted-foreground hover:underline">
        ← Overview
      </a>
      <header className="grid gap-1">
        <h1 className="text-heading font-semibold">{meeting.title ?? 'Meeting'}</h1>
        <span className="text-caption text-muted-foreground">
          Moderated by {meeting.moderator.name} · owned by {meeting.owner.name}
        </span>
      </header>
      <section className="grid gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm">
        <p data-testid="meeting-standing">{standing.said}</p>
        <p data-testid="meeting-mic" className="text-caption text-muted-foreground">
          {micLineOf(meeting)}
          {meeting.mic.requests.length === 0 ? null : ` In line: ${meeting.mic.requests.map(({ ship }) => ship.name).join(', ')}.`}
        </p>
        <MeetingControls fleetId={page.fleetId} meetingId={meeting.meetingId} controls={standing.controls} />
      </section>
      <Contributions items={meeting.contributions.items} />
      <div className="flex flex-wrap gap-4">
        <a href={here} className="text-muted-foreground hover:underline">
          Read again
        </a>
        {meeting.contributions.nextCursor === null ? null : (
          <a data-testid="meeting-older" href={meetingPathOf({ fleetId: page.fleetId, meetingId, cursor: meeting.contributions.nextCursor })} className="text-muted-foreground hover:underline">
            Older contributions
          </a>
        )}
      </div>
      <Participants participants={meeting.participants} />
    </div>
  );
}
