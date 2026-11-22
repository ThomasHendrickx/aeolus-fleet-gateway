from dataclasses import dataclass
from datetime import date


@dataclass
class Customer:
    id: str
    name: str
    email: str
    created_on: date
