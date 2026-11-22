from dataclasses import dataclass
from datetime import date


@dataclass
class Customer:
    id: str
    name: str
    email: str
    created_on: date
    suspended: bool = False

    def suspend(self):
        self.suspended = True

    def reinstate(self):
        self.suspended = False
