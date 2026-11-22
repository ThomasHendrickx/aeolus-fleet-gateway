#!/usr/bin/env python3
"""Run the repo companion's check commands and report whether all exit 0.

Usage: run_check.py COMMAND [COMMAND ...]  (each COMMAND is one shell command string)
Prints {"passed": bool, "results": [{"command", "exit", "output"}]}; exits 0 either way.
The commands come from the repo companion (checks.dependencyDirection, the scenario tests).
"""
import json
import subprocess
import sys


def main():
    if len(sys.argv) < 2:
        raise SystemExit("provide companion check commands")
    results = []
    for command in sys.argv[1:]:
        done = subprocess.run(command, shell=True, capture_output=True, text=True)
        results.append({"command": command, "exit": done.returncode, "output": (done.stdout + done.stderr)[-2000:]})
    print(json.dumps({"passed": all(r["exit"] == 0 for r in results), "results": results}))


if __name__ == "__main__":
    main()
