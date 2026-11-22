

class AccountRepository(Protocol):
    def get(self, customer_id: str): ...

    def save(self, account) -> None: ...


class Mailer(Protocol):
    def send(self, to_address: str, subject: str, body: str) -> None: ...
