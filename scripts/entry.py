"""PyInstaller entry point: the frozen app needs a top-level script, not a module with relative imports."""
from looper.main import cli

if __name__ == "__main__":
    cli()
