import hashlib
import hmac
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from venue_pr import InvalidSubmission, notify

API = "https://sec-deadlines-submissions.test-account.workers.dev"
SECRET = "unit-test-callback-value-do-not-use" * 2
ENVELOPE = {"id": "2da86da5-942b-4360-9f12-4a65482c6e09", "day": "2026-10-14"}
PR = "https://github.com/alirafiqmalik/sec-deadlines/pull/1"


class CallbackTests(unittest.TestCase):
    def configured(self):
        return patch.dict(os.environ, {"SUBMISSION_API_URL": API, "SUBMISSION_SIGNING_KEY": SECRET})

    def test_signs_exact_body_and_keeps_signature_out_of_process_arguments(self):
        with self.configured(), patch("venue_pr.subprocess.run", return_value=subprocess.CompletedProcess([], 0, '{"ok":true}\n200', "")) as run:
            notify(ENVELOPE, "created", PR)
        args = run.call_args.args[0]
        config = run.call_args.kwargs["input"]
        lines = config.splitlines()
        raw = json.loads(next(line.removeprefix("data = ") for line in lines if line.startswith("data = ")))
        signature = hmac.new(SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
        self.assertEqual(json.loads(raw), {**ENVELOPE, "status": "created", "prUrl": PR})
        self.assertIn(signature, config)
        self.assertNotIn(signature, " ".join(args))
        self.assertNotIn(SECRET, config)
        self.assertEqual(args[:4], ["curl", "--disable", "--config", "-"])
        self.assertNotIn("--location", args)
        self.assertIn("=https", args)

    def test_rejects_redirects_failures_and_false_success_without_exposing_bodies(self):
        for output, returncode in [("redirect\n302", 0), ("private-response\n403", 0), ('{"ok":false}\n200', 0), ('{"ok":true}\n200', 7), ("malformed\n200", 0)]:
            with self.subTest(output=output), self.configured(), patch("venue_pr.subprocess.run", return_value=subprocess.CompletedProcess([], returncode, output, "private-error")):
                with self.assertRaises(InvalidSubmission) as error:
                    notify(ENVELOPE, "created", PR)
                self.assertNotIn("private", str(error.exception))
                self.assertNotIn(SECRET, str(error.exception))

    def test_rejects_unsafe_callback_origins_before_starting_a_process(self):
        for endpoint in ["http://127.0.0.1", API + "/path", API + ".attacker.org", "https://user:pass@sec-deadlines-submissions.test-account.workers.dev"]:
            with self.subTest(endpoint=endpoint), patch.dict(os.environ, {"SUBMISSION_API_URL": endpoint}), patch("venue_pr.subprocess.run") as run:
                with self.assertRaises(InvalidSubmission): notify(ENVELOPE, "failed")
                run.assert_not_called()

    def test_transport_timeout_has_a_safe_error(self):
        with self.configured(), patch("venue_pr.subprocess.run", side_effect=subprocess.TimeoutExpired(["curl"], 25)):
            with self.assertRaisesRegex(InvalidSubmission, "pull request may already exist"):
                notify(ENVELOPE, "created", PR)


if __name__ == "__main__":
    unittest.main()
