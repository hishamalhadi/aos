"""
Invariant: The Qareen service is running and healthy on port 4096.

Full lifecycle:
- If qareen venv doesn't exist → skip (migration 026 hasn't run yet)
- If venv exists but plist missing → deploy from template, start
- If plist exists but service unhealthy → kickstart
- If healthy → OK
"""

import os
import subprocess
import sys
from pathlib import Path
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).parent.parent))
from base import CheckResult, ReconcileCheck, Status


class QareenServiceCheck(ReconcileCheck):
    name = "qareen_service"
    description = "Qareen intelligence service is running and healthy on port 4096"

    HOME = Path.home()
    QAREEN_VENV = HOME / ".aos" / "services" / "qareen" / ".venv"
    HEALTH_URL = "http://127.0.0.1:4096/api/health"
    PLIST_NAME = "com.aos.qareen"
    PLIST_PATH = HOME / "Library" / "LaunchAgents" / "com.aos.qareen.plist"
    TEMPLATE_PATH = HOME / "aos" / "config" / "launchagents" / "com.aos.qareen.plist.template"
    SCREEN_DIST = HOME / "aos" / "core" / "qareen" / "screen" / "dist"
    LOG_DIR = HOME / ".aos" / "logs"

    def _is_healthy(self) -> bool:
        """Check if the Qareen health endpoint responds."""
        try:
            req = Request(self.HEALTH_URL, method="GET")
            with urlopen(req, timeout=5) as resp:
                return resp.status == 200
        except Exception:
            return False

    def _deploy_plist(self) -> str | None:
        """Instantiate plist from template. Returns error message or None."""
        if not self.TEMPLATE_PATH.exists():
            return f"Template not found: {self.TEMPLATE_PATH}"

        template = self.TEMPLATE_PATH.read_text()
        plist_content = template.replace("__HOME__", str(self.HOME))

        self.LOG_DIR.mkdir(parents=True, exist_ok=True)
        self.PLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
        self.PLIST_PATH.write_text(plist_content)
        return None

    def _kickstart(self) -> bool:
        """Start or restart the service using bootout/bootstrap/kickstart."""
        uid = os.getuid()
        domain_target = f"gui/{uid}"
        service_target = f"gui/{uid}/{self.PLIST_NAME}"

        # Bootout first (ignore failure — may not be registered)
        subprocess.run(
            ["launchctl", "bootout", service_target],
            capture_output=True, timeout=10,
        )

        # Bootstrap the plist
        result = subprocess.run(
            ["launchctl", "bootstrap", domain_target, str(self.PLIST_PATH)],
            capture_output=True, text=True, timeout=10,
        )

        # Kickstart to ensure it's actually running
        subprocess.run(
            ["launchctl", "kickstart", "-k", service_target],
            capture_output=True, timeout=10,
        )

        return result.returncode == 0

    def check(self) -> bool:
        # No venv = migration hasn't run yet, skip
        if not self.QAREEN_VENV.exists():
            return True

        # Venv exists — service should be running and healthy
        return self._is_healthy()

    def fix(self) -> CheckResult:
        if not self.QAREEN_VENV.exists():
            return CheckResult(
                self.name, Status.SKIP,
                "Qareen venv not found — run migration 026 first"
            )

        fixed = []

        # Step 1: Check frontend dist exists
        if not (self.SCREEN_DIST / "index.html").exists():
            return CheckResult(
                self.name, Status.NOTIFY,
                "Frontend dist not built — run: cd ~/aos/core/qareen/screen && bun run build",
                notify=True,
            )

        # Step 2: Deploy plist if missing
        if not self.PLIST_PATH.exists():
            error = self._deploy_plist()
            if error:
                return CheckResult(
                    self.name, Status.NOTIFY,
                    f"Cannot deploy qareen plist: {error}",
                    notify=True,
                )
            fixed.append("deployed plist from template")

        # Step 3: Kickstart the service
        if self._kickstart():
            fixed.append("kickstarted service")
        else:
            return CheckResult(
                self.name, Status.NOTIFY,
                "Qareen plist deployed but kickstart failed",
                detail="Check logs at ~/.aos/logs/qareen.err.log",
                notify=True,
            )

        if fixed:
            return CheckResult(
                self.name, Status.FIXED,
                f"qareen: {', '.join(fixed)}"
            )
        return CheckResult(self.name, Status.OK, "ok")
