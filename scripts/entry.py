"""PyInstaller entry point: the frozen app needs a top-level script, not a module with relative imports."""
import sys
from pathlib import Path

if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from looper.main import cli

if __name__ == "__main__":
    cli()
