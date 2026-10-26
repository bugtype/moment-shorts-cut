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

    # Dedicated append/import calls exercise their closed output schemas in the SDK.
    async with session() as (client, _, tools):
        assert len(tools.tools) == 41
        document = await call(client, "moment_project_get")
        document["project"]["clips"] = [{"start": 0, "end": 2}]
        original = {"start": 5, "end": 6, "text": "Preserved outside output",
                    "basis": "timeline", "speaker": "1", "keywords": "keep"}
        document["project"]["captions"] = [original]
        await call(client, "moment_project_import", {"document": document})
        added = {"start": 0, "end": 1, "text": "Added", "basis": "timeline"}
        ack = await call(client, "moment_captions_append", {"captions": [added]})
        assert ack == {"updated": True, "outputDuration": 2}
        before = await call(client, "moment_project_get")
        await call(client, "moment_captions_append", {"captions": []}, error="INVALID_ARGUMENT")
        assert await call(client, "moment_project_get") == before
        imported = await call(client, "moment_captions_import", {
            "text": "1\n00:00:00,000 --> 00:00:01,000\nImported",
            "basis": "source", "mode": "append",
        })
        assert imported == {"updated": True, "outputDuration": 2, "importedCaptions": 1}
        after = await call(client, "moment_project_get")
        assert after["project"]["captions"][:2] == [original, added]
        # Optional diagnostics do not change the default closed acknowledgment.
        reported = await call(client, "moment_captions_import", {
            "text": "1\n00:00:00,000 --> 00:00:20,000\nReported",
            "basis": "source", "report": True,
        })
        assert reported["report"] == {"acceptedCaptions": 1, "clippedCaptions": 1,
                                      "discardedRecognizedEntries": 0}

    # Both inspection modes use disjoint public input/output schema alternatives.
    async with session() as (client, _, tools):
        from jsonschema import Draft202012Validator
        tool = next(tool for tool in tools.tools if tool.name == "moment_captions_inspect")
        validator = Draft202012Validator(tool.inputSchema)
        for args in ({"review": {}}, {"maxGraphemesPerSecond": 3},
                     {"review": {"minDuration": 1, "includeOverlaps": False}}):
            validator.validate({"projectId": "session", **args})
        for args in ({}, {"review": None}, {"review": {"includeOverlaps": False}},
                     {"review": {}, "maxGraphemesPerSecond": 3}):
            assert not validator.is_valid({"projectId": "session", **args})
        document = await call(client, "moment_project_get")
        document["project"]["captions"] = [
            {"start": 0, "end": 1, "text": "ABCD"},
            {"start": 0.5, "end": 1, "text": "XY", "basis": "timeline"},
        ]
        await call(client, "moment_project_import", {"document": document})
        before = await call(client, "moment_project_get")
        legacy = await call(client, "moment_captions_inspect", {"maxGraphemesPerSecond": 3})
        assert legacy["metric"] == "non-whitespace-graphemes-per-second"
        review = await call(client, "moment_captions_inspect", {"review": {
            "maxGraphemesPerSecond": 3, "minDuration": 0.75, "maxDuration": 0.9,
        }})
        assert review["metric"] == "caption-review"
        assert review["counts"] == {"readingSpeed": 2, "tooShort": 1, "tooLong": 1, "overlap": 2}
        assert review["flaggedOccurrences"] == 2 and review["totalFindings"] == 6
        assert [issue["kind"] for issue in review["issues"]] == [
            "reading-speed", "too-long", "overlap", "reading-speed", "too-short", "overlap"]
        output_validator = Draft202012Validator(tool.outputSchema)
        invalid = {"ok": True, "apiVersion": 1, "command": "captions.inspect", "data": review}
        invalid = json.loads(json.dumps(invalid))
        invalid["data"]["issues"][0]["duration"] = 1
        assert not output_validator.is_valid(invalid), "Issue evidence must match its kind"
        invalid["data"] = {**legacy, "thresholds": {"includeOverlaps": True}}
        assert not output_validator.is_valid(invalid), "Legacy result must stay closed"
        await call(client, "moment_captions_inspect", {"review": {"includeOverlaps": False}}, error="INVALID_ARGUMENT")
        filtered = await call(client, "moment_captions_inspect", {
            "review": {"filter": "overlap"}, "limit": 1})
        assert filtered["matchedFindings"] == 2 and filtered["omittedFindings"] == 1
        assert await call(client, "moment_project_get") == before

    print(json.dumps({
        "ok": True, "sdk": f"mcp {SDK_VERSION}", "protocol": protocol,
        "tools": tool_count, "recoveredError": failure["code"],
        "handoffVerified": True, "subtitleFormat": subtitles["format"],
        "filesWritten": False, "appendVerified": True, "captionReviewVerified": True,
    }))


if __name__ == "__main__":
    try:
        asyncio.run(asyncio.wait_for(main(), timeout=45))
    except asyncio.TimeoutError:
        sys.exit("MCP example timed out; the stdio/session contexts were closed.")
