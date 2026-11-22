"""Nightly job: settle refund requests by calling the same handler the REST route uses."""
from src.adapters import rest_refunds


def settle(requests, today):
    return [rest_refunds.post_refund(request, today) for request in requests]
