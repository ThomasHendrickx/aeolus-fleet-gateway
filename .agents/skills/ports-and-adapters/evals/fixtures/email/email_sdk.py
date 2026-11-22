"""Stub of a vendor email SDK."""


class Client:
    def __init__(self, api_key):
        self.api_key = api_key

    def send(self, to, subject, body):
        raise RuntimeError("network call")
