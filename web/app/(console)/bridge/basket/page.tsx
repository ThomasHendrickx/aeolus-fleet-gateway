import type { Metadata } from 'next';

import { BridgeBasketPage } from '../../../../features/bridge/state/bridge-basket';
import type { SearchParams } from '../../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Basket' };

export default async function BasketPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <BridgeBasketPage searchParams={await searchParams} />;
}
