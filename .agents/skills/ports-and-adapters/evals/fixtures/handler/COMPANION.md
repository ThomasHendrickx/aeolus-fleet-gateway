# Repo companion (fixture)

paths.domain: src/core
paths.ports: src/core/ports
paths.adapters: src/adapters
paths.compositionRoot: src/main.py
checks.dependencyDirection: python3 check_direction.py
infraModules: sqlite3
scenario tests: python3 -m unittest discover -s tests -t .
