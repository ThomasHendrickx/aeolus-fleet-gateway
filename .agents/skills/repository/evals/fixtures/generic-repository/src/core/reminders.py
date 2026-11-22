def send_reminders(orders, notifier, today):
    """One email per order that is past due."""
    for order in orders.find_by({"due_before": today}):
        notifier.send(order.customer_id, "Overdue orders", f"Order {order.number} is overdue.")
