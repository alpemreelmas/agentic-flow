import pytest

from todo.store import Store


def test_add_assigns_increasing_ids(tmp_path):
    s = Store(tmp_path / "t.json")
    assert s.add("a") == 1
    assert s.add("b") == 2


def test_done_marks_item(tmp_path):
    s = Store(tmp_path / "t.json")
    i = s.add("a")
    s.done(i)
    assert s.list()[0]["done"] is True


def test_done_unknown_id_raises(tmp_path):
    with pytest.raises(KeyError):
        Store(tmp_path / "t.json").done(99)


def test_items_survive_reload(tmp_path):
    Store(tmp_path / "t.json").add("a")
    assert [i["title"] for i in Store(tmp_path / "t.json").list()] == ["a"]
