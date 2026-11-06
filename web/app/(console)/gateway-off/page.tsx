import { GatewayOff } from '../../../features/gateway-off/ui/gateway-off';
import { NoSignIn } from '../../../features/sign-in/ui/no-sign-in';
import { gatewayOffPage } from '../../../lib/gateway-api/page-api';

export default async function GatewayOffPage() {
  const page = await gatewayOffPage();
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  return <GatewayOff fleetName={page.fleetName} accountUrl={page.accountUrl} />;
}
