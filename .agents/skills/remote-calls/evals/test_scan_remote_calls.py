"""P0.2/P0.3 scanner evidence and parser/alias naive traps (not scenario runs)."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPTS = Path(__file__).parents[1] / 'aip' / 'scripts'
spec = importlib.util.spec_from_file_location('scan', SCRIPTS / 'scan_remote_calls.py')
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)
CLIENTS = [{'module': 'httpx', 'timeoutOption': 'timeout'}]


class PythonScan(unittest.TestCase):
    def test_s03_domain_library_import_aliased(self):
        result = scan.scan_source('from tenacity import retry as again\n', [], True, resilience_library='tenacity')
        self.assertEqual(result['violations'][0]['module'], 'tenacity.retry')

    def test_s02_adapter_aliased_function_missing_timeout(self):
        result = scan.scan_source('from httpx import get as fetch\nfetch("url")\n', CLIENTS)
        self.assertEqual(result['missingTimeouts'][0]['call'], 'httpx.get')

    def test_module_alias_and_multiline_timeout(self):
        result = scan.scan_source('import httpx as web\nweb.get(\n"url",\ntimeout=3\n)\n', CLIENTS)
        self.assertFalse(any(result.values()))

    def test_comments_and_strings_do_not_import_or_call(self):
        result = scan.scan_source('# import tenacity\nx="httpx.get(url)"\n', CLIENTS, True, resilience_library='tenacity')
        self.assertFalse(any(result.values()))

    def test_nondefault_timeout_option(self):
        result = scan.scan_source('import sdk as s\ns.send(deadline=3)', [{'module':'sdk','timeoutOption':'deadline'}])
        self.assertFalse(result['missingTimeouts'])

    def test_uncertainty_never_clean(self):
        for source in ('from httpx import *', 'import httpx\nhttpx.get("u", **options)', 'import httpx\nc=httpx.Client()', 'def bad(:', '__import__("httpx")'):
            with self.subTest(source=source):
                self.assertTrue(scan.scan_source(source, CLIENTS)['unsupported'])

    def test_check_runner_reports_real_failure_and_success(self):
        done = subprocess.run(['python3', str(SCRIPTS/'run_check.py'), 'exit 0', 'exit 7'],capture_output=True,text=True)
        result=json.loads(done.stdout)
        self.assertFalse(result['passed'])
        self.assertEqual([item['exit'] for item in result['results']], [0,7])


class JavaScriptScan(unittest.TestCase):
    def test_esm_renamed_import_options_and_string_trap(self):
        modules = Path(os.environ.get('REMOTE_CALLS_NODE_MODULES', '/tmp/remote-calls-deps/node_modules'))
        self.assertTrue((modules/'acorn').exists(), 'install pinned acorn: npm install --prefix /tmp/remote-calls-deps acorn@8.15.0')
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'node_modules').symlink_to(modules.resolve(), target_is_directory=True)
            source=root/'adapter.mjs'
            source.write_text('import {request as send} from "../infra/network.js";\n// send(n,{timeout: 2})\nconst hint="import cockatiel";\nsend(network,{operation:"get"});\nsend(network,{timeout:4});\n')
            config={'domain':False,'library':'cockatiel','clients':[{'module':'../infra/network.js','timeoutOption':'timeout'}]}
            def run():
                done=subprocess.run(['node',str(SCRIPTS/'scan_javascript.cjs'),str(source),json.dumps(config)],capture_output=True,text=True,check=True)
                return json.loads(done.stdout)
            result=run()
            self.assertEqual(len(result['missingTimeouts']),1)
            self.assertFalse(result['violations'])
            self.assertFalse(result['unsupported'])
            source.write_text('import { retry as again } from "cockatiel";')
            config['domain']=True
            self.assertEqual(len(run()['violations']),1)
            source.write_text('import { request } from "../infra/network.js";request(n,{...options});')
            self.assertTrue(run()['unsupported'])


if __name__ == '__main__':
    unittest.main()
