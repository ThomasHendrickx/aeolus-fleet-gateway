import { BUTTONS, CARD } from '../../forms/ui/look';

/**
 * The gateway is off for the account's fleet (Thomas, 25 Oct: "Say it is
 * off, and who turns it on"): the hosting service switches it on per fleet
 * (decision 0021), so the page names who that is and the way back to the
 * account.
 */
export function GatewayOff({ fleetName, accountUrl }: { fleetName: string; accountUrl: string }) {
  return (
    <section className={CARD} data-testid="gateway-off">
      <h2 className="text-heading font-semibold">The gateway is off for {fleetName}</h2>
      <p className="mt-2 text-muted-foreground">Nobody in {fleetName} can use the gateway until it is turned on for this fleet.</p>
      <p className="mt-2 text-muted-foreground">The administrator of the Aeolus service you sign in to turns it on for a fleet.</p>
      <div className="mt-4">
        <a href={accountUrl} data-testid="gateway-off-account" className={BUTTONS.primary}>
          Back to your account
        </a>
      </div>
    </section>
  );
}
