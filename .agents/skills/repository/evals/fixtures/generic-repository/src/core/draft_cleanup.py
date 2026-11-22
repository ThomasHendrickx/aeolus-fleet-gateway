def stale_draft_numbers(orders, before):
    """Numbers of drafts that were due before `before` and can be cleared out."""
    return [o.number for o in orders.find_by({"status": "draft", "due_before": before})]
