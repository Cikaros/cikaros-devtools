{
  "prompt": "<the task prompt - copied verbatim from real work>",
  "acceptance": {
    "tests_pass": ["test_status.py", "test_auth.py"],
    "lint_clean": true,
    "behavior_unchanged": ["test_smoke.py"],
    "policy_followed": ["secure-api-review"],
    "screenshot_matches": "mocks/claims-panel.png"
  },
  "metadata": {
    "source": "real-task|incident-postmortem|regression-case",
    "incident_id": "<optional, if from incident>",
    "added_at": "<date>",
    "added_by": "<team>"
  }
}
