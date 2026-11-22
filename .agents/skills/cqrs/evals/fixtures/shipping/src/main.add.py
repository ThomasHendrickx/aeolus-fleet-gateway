

def create_shipment(shipment_id, order_id):
    from src.shipping.adapters.pg import ShippingUnitOfWork
    from src.shipping.core.commands import create_shipment as _create
    return _create(ShippingUnitOfWork(), shipment_id, order_id)


def dispatch_shipment(shipment_id, carrier, on):
    from src.shipping.adapters.pg import ShippingUnitOfWork
    from src.shipping.core.commands import dispatch_shipment as _dispatch
    return _dispatch(ShippingUnitOfWork(), shipment_id, carrier, on)
