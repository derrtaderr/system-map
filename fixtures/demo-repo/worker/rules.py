"""Invented scoring rules, so the worker has an internal edge of its own."""

import os

THRESHOLD = int(os.environ.get("SCORE_THRESHOLD", "40"))


def score(row):
    return {"id": row["id"], "score": min(100, len(row.get("signals", [])) * 10), "keep": THRESHOLD < 50}
