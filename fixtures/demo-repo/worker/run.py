"""The slow half of the invented service."""

import logging
import os

import requests
from celery.schedules import crontab

from .rules import score

TOKEN = os.getenv("WORKER_TOKEN")
LOG = logging.getLogger("kiteline.worker")

BEAT = crontab(hour=9, minute=0)


def sweep():
    response = requests.get("https://api.example.com/v1/queue", headers={"authorization": TOKEN})
    if response.status_code != 200:
        logging.error("queue read failed: %s", response.status_code)
        return []
    return [score(row) for row in response.json()]
