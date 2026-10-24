"""Runs the admin UI helper tests (tests/admin/web/*.test.ts) with Node's built-in runner.

The helpers (name normalisation, last-admin protection, permission matrix, settings
validation) are plain TypeScript without imports, so ``node --experimental-strip-types``
executes them directly - no extra npm dependency. Skipped when Node is not installed.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
TEST_FILES = sorted((HERE / "web").glob("*.test.ts"))


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_admin_web_helpers() -> None:
    assert TEST_FILES, "no tests/admin/web/*.test.ts files found"
    result = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            "--no-warnings=ExperimentalWarning",
            "--test",
            *[str(path.relative_to(REPO)) for path in TEST_FILES],
        ],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert result.returncode == 0, f"node --test failed:\n{result.stdout}\n{result.stderr}"
