"""Test package.

The suite always runs with the default module set, whatever this checkout's ``.env`` says, so
its assertions are deterministic. An explicit shell variable still wins
(``ENABLED_MODULES=attendance,admin make test``); tests that need another module set build
their own app through the ``client_for`` fixture in ``conftest.py``.
"""

import os

from app.config import DEFAULT_ENABLED_MODULES

os.environ.setdefault("ENABLED_MODULES", DEFAULT_ENABLED_MODULES)
