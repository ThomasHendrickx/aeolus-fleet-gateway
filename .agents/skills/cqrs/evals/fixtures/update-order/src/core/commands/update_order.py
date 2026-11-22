from src.core.orders import Address, OrderError, OrderLine


def update_order(uow, order_id: str, dto: dict) -> int:
    """Staff edit screen: saves the whole order. Applies whatever differs from the stored order."""
    with uow:
        order = uow.orders.get(order_id)
        if dto.get("note", order.note) != order.note:
            order.note = dto["note"]
        address = Address(dto.get("street", order.shipping_address.street), dto.get("city", order.shipping_address.city),
                          dto.get("postcode", order.shipping_address.postcode))
        if address != order.shipping_address:
            order.shipping_address = address
        if "lines" in dto:
            lines = [OrderLine(**line) for line in dto["lines"]]
            if lines != order.lines:
                if order.status != "placed":
                    raise OrderError("lines of a shipped or cancelled order cannot change")
                order.lines = lines
        uow.orders.save(order)
    return order.version
