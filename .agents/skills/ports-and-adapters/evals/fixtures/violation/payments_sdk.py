"""Stub of a vendor SDK."""


class Gateway:
    def charge(self, cents):
        return {"ok": True, "cents": cents}
