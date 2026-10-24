"""Optional official MCP Python SDK consumer; no installs or project files written.

Run: python examples/use-mcp-sdk.py
Prerequisites: Python 3.10+, Node.js 20+ on PATH, and optional mcp==1.29.0.
Tested with mcp 1.29.0 (v1 API); this is not a claim of v2 compatibility.
The dependency-free JavaScript example remains available as use-mcp-client.mjs.
"""

import asyncio
import json
import shutil
import sys
from contextlib import asynccontextmanager
from datetime import timedelta
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

if not __debug__:
    raise SystemExit("Run this verification example without -O or PYTHONOPTIMIZE; assertions are required.")

try:
    SDK_VERSION = version("mcp")
except PackageNotFoundError:
    raise SystemExit(
        "Optional MCP SDK unavailable. Use a Python environment with mcp==1.29.0 "
        "or run node examples/use-mcp-client.mjs. No dependencies were installed."
    ) from None
if SDK_VERSION.split(".", 1)[0] != "1":
    raise SystemExit(
        f"This example uses the MCP SDK v1 API (tested 1.29.0); found {SDK_VERSION}. "
        "Use a separate compatible environment or the dependency-free JavaScript example."
    )

try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
except ImportError:
    raise SystemExit(
        "Optional MCP SDK unavailable. Use a Python environment with mcp==1.29.0 "
        "(v1 API), or run node examples/use-mcp-client.mjs. "
        "This example does not install dependencies."
    ) from None

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")
if NODE is None:
    raise SystemExit("Node.js 20+ must be available on PATH.")


@asynccontextmanager
async def session():
    # An isolated demo session, not the user's browser or a persistent server.
    params = StdioServerParameters(
        command=NODE, args=[str(ROOT / "cli" / "mcp.mjs")], cwd=str(ROOT)
    )
    async with stdio_client(params) as streams:
        async with ClientSession(
            *streams, read_timeout_seconds=timedelta(seconds=10)
        ) as client:
            initialized = await client.initialize()
            tools = await client.list_tools()
            # Discovery registers output schemas in the official SDK client.
            # Subsequent successful call_tool results undergo SDK validation.
            yield client, initialized, tools


async def call(client, name, arguments=None, *, error=None):
    result = await client.call_tool(
        name, {"projectId": "session", **(arguments or {})}
    )
    envelope = result.structuredContent
    assert isinstance(envelope, dict), "Expected a structured Moment envelope"
    if error is not None:
        assert result.isError and envelope["ok"] is False
        assert envelope["error"]["code"] == error
        return envelope["error"]
    assert not result.isError and envelope["ok"] is True, envelope
    return envelope["data"]


async def main():
    async with session() as (client, initialized, tools):
        names = {tool.name for tool in tools.tools}
        assert {"moment_project_import", "moment_project_update",
                "moment_project_get", "moment_project_summary", "moment_captions_export"} <= names
        demo = await call(client, "moment_project_get")
        await call(client, "moment_project_import", {"document": demo})
        await call(client, "moment_project_update", {
            "patch": {"name": "Official SDK demo"}
        })
        before_error = await call(client, "moment_project_get")
        failure = await call(client, "moment_project_update", {
            "patch": {"speed": 0}
        }, error="INVALID_ARGUMENT")
        assert await call(client, "moment_project_get") == before_error
        # Tool errors are results, not transport failures: the session is usable.
        await call(client, "moment_project_update", {"patch": {"speed": 2}})
        handoff = await call(client, "moment_project_get")
        summary = await call(client, "moment_project_summary")
        assert summary["speed"] == 2
        assert summary["ratio"] == handoff["project"]["ratio"]
        assert summary["captionCount"] == len(handoff["project"]["captions"])
        assert summary["media"] == {"requiresVideo": False, "requiresAudio": False}
        assert "name" not in summary  # This overview intentionally omits authored text.
        subtitles = await call(client, "moment_captions_export", {"format": "vtt"})
        assert subtitles["text"].startswith("WEBVTT\n\n")
        assert handoff["project"]["speed"] == 2
        protocol, tool_count = initialized.protocolVersion, len(tools.tools)

    # Save the whole project.get data document in a real integration, not the
    # update acknowledgement. Here JSON transport stays entirely in memory.
    restored_document = json.loads(json.dumps(handoff, ensure_ascii=False))
    async with session() as (client, _, __):
        fresh_demo = await call(client, "moment_project_get")
        assert fresh_demo != handoff, "A new process must not retain prior edits"
        await call(client, "moment_project_import", {"document": restored_document})
        assert await call(client, "moment_project_get") == handoff

    print(json.dumps({
        "ok": True, "sdk": f"mcp {SDK_VERSION}", "protocol": protocol,
        "tools": tool_count, "recoveredError": failure["code"],
        "handoffVerified": True, "subtitleFormat": subtitles["format"],
        "filesWritten": False,
    }))


if __name__ == "__main__":
    try:
        asyncio.run(asyncio.wait_for(main(), timeout=45))
    except asyncio.TimeoutError:
        sys.exit("MCP example timed out; the stdio/session contexts were closed.")
