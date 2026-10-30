import json
from pathlib import Path


class Store:
    """Todo items kept in a JSON file. Ids start at 1 and are never reused."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.items: list[dict] = []
        if self.path.exists():
            self.items = json.loads(self.path.read_text())

    def add(self, title: str) -> int:
        new_id = max((i["id"] for i in self.items), default=0) + 1
        self.items.append({"id": new_id, "title": title, "done": False})
        self._save()
        return new_id

    def done(self, item_id: int) -> None:
        for item in self.items:
            if item["id"] == item_id:
                item["done"] = True
                self._save()
                return
        raise KeyError(item_id)

    def list(self) -> list[dict]:
        return list(self.items)

    def _save(self) -> None:
        self.path.write_text(json.dumps(self.items, indent=2))
