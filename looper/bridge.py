"""Trusted Linear broker and credential-free, newline JSON-RPC MCP proxy."""
import json
import os
import secrets
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from .linear_tools import LinearTools, TOOLS

MAX_MESSAGE = 1_000_000


def clean_agent_env():
    # Keep agent providers' own login/auth intact; application service credentials stay in broker.
    return {k: v for k, v in os.environ.items()
            if k not in {"LINEAR_API_KEY", "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN",
                         "GITHUB_ENTERPRISE_TOKEN"} and not k.startswith("LOOPER_BRIDGE_")}


class Broker:
    def __init__(self, tools, emit=lambda event: None):
        self.tools, self.emit = tools, emit
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.RLock()
        broker = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                if self.path != "/tools" or not secrets.compare_digest(
                        self.headers.get("Authorization", ""), "Bearer " + broker.token):
                    self.send_error(403)
                    return
                try:
                    size = int(self.headers.get("Content-Length", "0"))
                    if not 0 < size <= MAX_MESSAGE:
                        raise ValueError("Invalid request size")
                    request = json.loads(self.rfile.read(size))
                    with broker.lock:
                        broker.tools.check_scope()
                        if request == {"method": "tools/list"}:
                            result = {"tools": TOOLS}
                        elif request.get("method") == "tools/call" and set(request) == {"method", "name", "arguments"}:
                            result = broker.call(request["name"], request["arguments"])
                        else:
                            raise ValueError("Unknown broker request")
                except Exception as exc:
                    # Do not expose stack traces, HTTP request objects or credentials.
                    message = str(exc) if isinstance(exc, (ValueError, RuntimeError)) else "Bridge request failed"
                    if broker.tools.key:
                        message = message.replace(broker.tools.key, "[redacted]")
                    result = {"isError": True, "content": [{"type": "text", "text": message}]}
                body = json.dumps(result).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self):
        self.thread.start()
        return {"url": f"http://127.0.0.1:{self.server.server_port}/tools", "token": self.token,
                "name": "looper_linear_" + secrets.token_hex(8)}

    def close(self):
        with self.lock:
            self.token = secrets.token_urlsafe(32)
            self.tools.key = None
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def call(self, name, args):
        call_id = "bridge-" + uuid.uuid4().hex
        # Validated before logging: unexpected fields might contain secret material.
        from .linear_tools import validate_call
        validate_call(name, args)
        self.emit({"type": "tool_call", "id": call_id, "title": name, "status": "in_progress",
                   "tool_kind": "fetch", "raw_input": args})
        try:
            value = self.tools.call(name, args)
        except Exception as exc:
            message = str(exc) if isinstance(exc, (ValueError, RuntimeError)) else "Linear operation failed"
            if self.tools.key:
                message = message.replace(self.tools.key, "[redacted]")
            self.emit({"type": "tool_update", "id": call_id, "status": "failed",
                       "raw_output": message})
            raise
        text = json.dumps(value, ensure_ascii=False)
        if isinstance(value, dict) and value.get("identifier"):
            text = (f"[{value['identifier']}]({value['url']}) · {value['state']['name']} · "
                    f"queue eligible: {value['queue_eligible']}\n\n" + text)
        self.emit({"type": "tool_update", "id": call_id, "status": "completed", "raw_output": text})
        if name in {"linear_create_issue", "linear_update_issue", "linear_submit_issue"}:
            self.emit({"type": "linear_changed"})
        return {"content": [{"type": "text", "text": text}], "isError": False}


def run_broker():
    # Only the trusted parent sends this startup line; never put its key in argv/env.
    startup = json.loads(sys.stdin.readline(MAX_MESSAGE))
    output_lock = threading.Lock()

    def emit(event):
        with output_lock:
            print(json.dumps(event, ensure_ascii=False), flush=True)

    tools = LinearTools(startup.get("key"), startup["scope"], startup["state_dir"], startup.get("config_path"))
    broker = Broker(tools, emit)
    descriptor = broker.start()
    emit({"type": "bridge_ready", **descriptor})
    try:
        for line in sys.stdin:
            message = json.loads(line)
            if message.get("type") == "key":
                with broker.lock:
                    tools.key = message.get("key")
                emit({"type": "bridge_status", "available": bool(tools.key),
                      "message": "Linear bağlantısı güncellendi." if tools.key else "Linear anahtarı kaldırıldı; araç erişimi kapalı."})
    finally:
        broker.close()


def proxy_request(descriptor, method, **kwargs):
    parsed = urlsplit(descriptor["url"])
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.path != "/tools" or parsed.query or parsed.username:
        raise ValueError("Invalid application bridge endpoint")
    try:
        response = httpx.post(descriptor["url"], headers={"Authorization": "Bearer " + descriptor["token"]},
                              json={"method": method, **kwargs}, timeout=180, trust_env=False)
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError):
        return {"isError": True, "content": [{"type": "text", "text": "Application bridge is unavailable; reopen the chat"}]}


def run_proxy():
    descriptor = json.loads(os.environ.pop("LOOPER_BRIDGE_DESCRIPTOR"))
    for line in sys.stdin:
        request_id = None
        try:
            if len(line) > MAX_MESSAGE:
                raise ValueError("Message too large")
            request = json.loads(line)
            request_id = request.get("id")
            if request_id is None:
                continue
            method = request.get("method")
            if method == "initialize":
                version = request.get("params", {}).get("protocolVersion")
                supported = {"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"}
                result = {"protocolVersion": version if version in supported else "2025-06-18",
                          "capabilities": {"tools": {}}, "serverInfo": {"name": "linear-looper", "version": "0.1.0"}}
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = proxy_request(descriptor, method)
                if result.get("isError"):
                    # MCP list must return a protocol error, not a tools/call result.
                    raise ValueError(result["content"][0]["text"])
            elif method == "tools/call":
                params = request.get("params", {})
                result = proxy_request(descriptor, method, name=params.get("name"), arguments=params.get("arguments", {}))
            else:
                print(json.dumps({"jsonrpc": "2.0", "id": request_id,
                                  "error": {"code": -32601, "message": "Method not found"}}), flush=True)
                continue
            response = {"jsonrpc": "2.0", "id": request_id, "result": result}
        except (ValueError, TypeError, AttributeError):
            response = {"jsonrpc": "2.0", "id": request_id,
                        "error": {"code": -32602, "message": "Invalid request or unavailable bridge; reopen the chat"}}
        print(json.dumps(response), flush=True)


def mcp_server(descriptor):
    from acp.schema import EnvVariable, McpServerStdio
    if getattr(sys, "frozen", False):
        command, args = sys.executable, ["--mcp-proxy"]
    else:
        command = sys.executable
        args = [str(Path(__file__).resolve().parent.parent / "scripts" / "entry.py"), "--mcp-proxy"]
    return McpServerStdio(name=descriptor["name"], command=command, args=args,
                         env=[EnvVariable(name="LOOPER_BRIDGE_DESCRIPTOR", value=json.dumps(descriptor))])
