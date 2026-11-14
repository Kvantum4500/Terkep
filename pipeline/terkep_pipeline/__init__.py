"""Terkep adatpipeline: magyar látnivalók gyűjtése, összevonása és pontozása."""

from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = PIPELINE_DIR.parent
CONFIG_DIR = PIPELINE_DIR / "config"
CURATION_DIR = PIPELINE_DIR / "curation"
CACHE_DIR = PIPELINE_DIR / "cache"
BUILD_DIR = PIPELINE_DIR / "build"
DATA_DIR = REPO_DIR / "data"
