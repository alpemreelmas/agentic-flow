import argparse
import sys

from .store import Store


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="todo")
    p.add_argument("--file", default="todo.json")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    a = sub.add_parser("add")
    a.add_argument("title")
    d = sub.add_parser("done")
    d.add_argument("id", type=int)
    args = p.parse_args(argv)

    store = Store(args.file)
    if args.cmd == "add":
        print(store.add(args.title))
    elif args.cmd == "done":
        store.done(args.id)
    else:
        for i in store.list():
            print(f"{i['id']}. [{'x' if i['done'] else ' '}] {i['title']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
