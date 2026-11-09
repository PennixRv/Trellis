#!/usr/bin/env python3
"""Protocol fixture only: real Git resources, synthetic SDK receipts."""
import json
import os
from pathlib import Path
import subprocess
import sys

request = json.load(sys.stdin)
op, p = request["operation"], request["payload"]
root = Path(os.environ["PASEO_TEST_REPO"])
tree = root / ".paseo-worktrees" / "execution"
with open(os.environ["PASEO_TEST_CALLS"], "a") as output:
    output.write(json.dumps(request) + "\n")
identity = {"server_id": "fixture-local", "home": "/fixture", "pid": 1, "started_at": "fixture"}
agent = {"id": "agent-test-id", "workspaceId": "workspace-test-id", "cwd": str(tree), "status": "idle", "activeTurn": None, "runtimeInfo": {"model": "fixture-model", "modeId": "full-access", "thinkingOptionId": "high"}, "labels": {"trellis.attempt": request.get("attempt_id"), "trellis.control": __import__("hashlib").sha256(str(root).encode()).hexdigest()}}
workspace = {"id": "workspace-test-id", "workspaceDirectory": str(tree)}
observed = {"identity": identity}
if op == "capability":
    observed.update(models=[{"id": "fixture-model", "thinkingOptions": [{"id": "high"}]}], modes=[{"id": "full-access"}])
elif op in {"inspect", "resource-preview"}:
    observed.update(agents=[agent] if tree.exists() else [], workspaces=[workspace] if p.get("workspace_id") else [], lifecycle={"autoArchiveAfterMerge": False})
elif op == "prepare-workspace":
    subprocess.run(["git", "worktree", "add", "-b", p["branch"], str(tree), p["base_commit"]], cwd=root, check=True, capture_output=True)
    observed["workspace"] = workspace
elif op == "prepare-agent":
    observed["agent"] = agent
elif op in {"execute", "followup"}:
    observed.update(send_returned=True, delivery_proven=False)
else:
    observed["agent"] = agent
if os.environ.get("PASEO_TEST_FAIL_OPERATION") == op:
    sys.exit(1)
print(json.dumps({"version": 1, "operation": op, "attempt_id": request.get("attempt_id"), "binding_revision": request.get("binding_revision"), "ok": True, "observations": observed}))
