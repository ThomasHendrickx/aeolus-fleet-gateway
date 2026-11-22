# Repo companion (fixture)

paths.domain: src/core
paths.queries: src/queries
paths.compositionRoot: src/main.py
checks.dependencyDirection: python3 check_direction.py
infraModules: psycopg
checks.queryTests: python3 -m unittest discover -s tests -t .
measurement: none recorded
database: Postgres; its URL is in database.url. Tests reset the schema from schema.sql.
