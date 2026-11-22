Add a delete endpoint for notes: `DELETE /notes` calls `delete_note(note_id)`, which removes the row and returns whether a row was deleted.
Acceptance criteria:
- Given an existing note, when it is deleted, then it is gone and the call returns true.
- Given an unknown id, when it is deleted, then the call returns false.
