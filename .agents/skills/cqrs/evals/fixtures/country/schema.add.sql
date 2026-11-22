CREATE TABLE countries (
    code text PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
    name text NOT NULL
);
