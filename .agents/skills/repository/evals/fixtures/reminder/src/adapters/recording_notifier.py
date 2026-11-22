class RecordingNotifier:
    def __init__(self):
        self.sent = []

    def send(self, customer_id, subject, body):
        self.sent.append((customer_id, subject, body))
