"""AOS Execution Router — routes agent work to the appropriate provider.

Resolves model references like "sonnet", "openrouter/google/gemini-2.5-pro",
"ollama/qwen3:32b" to the correct execution path. Handles fallback when the
primary provider is unavailable.

Usage:
    from core.engine.execution.router import ExecutionRouter

    router = ExecutionRouter()
    result = await router.execute(
        agent_id="steward",
        prompt="Check system health",
        model="sonnet",  # or "openrouter/google/gemini-2.5-pro"
    )
"""

from __future__ import annotations

import asyncio
import json
import logging
import subprocess
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

PROVIDERS_FILE = Path.home() / ".aos" / "config" / "providers.yaml"
AGENTS_DIR = Path.home() / ".claude" / "agents"
SYSTEM_DIR = Path.home() / "aos" / "core" / "agents"


def _load_providers() -> dict[str, Any]:
    """Load provider configs from yaml."""
    if PROVIDERS_FILE.is_file():
        try:
            data = yaml.safe_load(PROVIDERS_FILE.read_text())
            return data.get("providers", {})
        except Exception:
            pass
    return {}


def _find_agent_prompt(agent_id: str) -> str | None:
    """Read the system prompt (body) from an agent .md file."""
    for directory in [AGENTS_DIR, SYSTEM_DIR]:
        path = directory / f"{agent_id}.md"
        if path.is_file():
            content = path.read_text(encoding="utf-8", errors="replace")
            if content.startswith("---"):
                end = content.find("---", 3)
                if end != -1:
                    return content[end + 3:].strip()
            return content
    return None


def _get_credential(name: str) -> str | None:
    """Get a credential from macOS Keychain."""
    agent_secret = Path.home() / "aos" / "core" / "bin" / "cli" / "agent-secret"
    try:
        r = subprocess.run(
            [str(agent_secret), "get", name],
            capture_output=True, text=True, timeout=5,
        )
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


class ExecutionResult:
    """Result of an agent execution."""

    def __init__(
        self,
        text: str,
        provider: str,
        model: str,
        status: str = "ok",
        duration_ms: int = 0,
        tokens_in: int = 0,
        tokens_out: int = 0,
        error: str | None = None,
    ):
        self.text = text
        self.provider = provider
        self.model = model
        self.status = status
        self.duration_ms = duration_ms
        self.tokens_in = tokens_in
        self.tokens_out = tokens_out
        self.error = error

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "provider": self.provider,
            "model": self.model,
            "status": self.status,
            "duration_ms": self.duration_ms,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
            "error": self.error,
        }


class ExecutionRouter:
    """Routes agent work to the right provider."""

    def __init__(self) -> None:
        self.providers = _load_providers()

    def reload(self) -> None:
        """Reload provider configs from disk."""
        self.providers = _load_providers()

    def resolve_provider(self, model: str) -> tuple[str, str, dict[str, Any]]:
        """Resolve a model reference to (provider_id, model_name, provider_config).

        Examples:
            "sonnet" → ("claude-code", "sonnet", {...})
            "openrouter/google/gemini-2.5-pro" → ("openrouter", "google/gemini-2.5-pro", {...})
            "ollama/qwen3:32b" → ("ollama", "qwen3:32b", {...})
            "anthropic/claude-sonnet-4-6" → ("anthropic", "claude-sonnet-4-6", {...})
        """
        if "/" in model:
            parts = model.split("/", 1)
            provider_id = parts[0]
            model_name = parts[1]
        else:
            # No provider prefix — use default
            provider_id = None
            model_name = model
            for pid, cfg in self.providers.items():
                if cfg.get("is_default"):
                    provider_id = pid
                    break
            if not provider_id:
                provider_id = "claude-code"  # ultimate fallback

        config = self.providers.get(provider_id, {})
        return provider_id, model_name, config

    async def execute(
        self,
        *,
        agent_id: str | None = None,
        prompt: str,
        model: str = "sonnet",
        system_prompt: str | None = None,
        max_tokens: int = 4096,
        timeout: float = 120,
    ) -> ExecutionResult:
        """Execute a prompt through the appropriate provider.

        Args:
            agent_id: If provided, loads the agent's system prompt from .md file
            prompt: The user prompt to execute
            model: Model reference (e.g. "sonnet", "openrouter/google/gemini-2.5-pro")
            system_prompt: Override system prompt (takes precedence over agent_id)
            max_tokens: Maximum response tokens
            timeout: Execution timeout in seconds
        """
        import time
        start = time.monotonic()

        # Resolve system prompt
        if system_prompt is None and agent_id:
            system_prompt = _find_agent_prompt(agent_id)

        # Resolve provider
        provider_id, model_name, config = self.resolve_provider(model)
        provider_type = config.get("type", "harness")

        try:
            if provider_type == "harness":
                result = await self._execute_harness(model_name, prompt, system_prompt, timeout)
            elif provider_type == "api":
                result = await self._execute_api(config, model_name, prompt, system_prompt, max_tokens)
            elif provider_type == "gateway":
                result = await self._execute_gateway(config, model_name, prompt, system_prompt, max_tokens)
            elif provider_type == "local":
                result = await self._execute_local(config, model_name, prompt, system_prompt, max_tokens)
            else:
                return ExecutionResult(
                    text="", provider=provider_id, model=model_name,
                    status="error", error=f"Unknown provider type: {provider_type}",
                )

            elapsed = int((time.monotonic() - start) * 1000)
            result.provider = provider_id
            result.model = model_name
            result.duration_ms = elapsed
            return result

        except Exception as e:
            elapsed = int((time.monotonic() - start) * 1000)
            logger.exception("Execution failed for %s/%s", provider_id, model_name)
            return ExecutionResult(
                text="", provider=provider_id, model=model_name,
                status="error", duration_ms=elapsed, error=str(e),
            )

    async def _execute_harness(
        self, model: str, prompt: str, system_prompt: str | None, timeout: float,
    ) -> ExecutionResult:
        """Execute via Claude Code CLI (claude --print)."""
        cmd = ["claude", "--print", "--model", model]
        if system_prompt:
            cmd.extend(["--system-prompt", system_prompt])

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(prompt.encode()), timeout=timeout,
            )
        except asyncio.TimeoutError:
            proc.kill()
            return ExecutionResult(text="", provider="claude-code", model=model, status="timeout", error="Execution timed out")

        text = stdout.decode("utf-8", errors="replace").strip()
        if proc.returncode != 0:
            err = stderr.decode("utf-8", errors="replace").strip()
            return ExecutionResult(text=text, provider="claude-code", model=model, status="error", error=err or f"Exit code {proc.returncode}")

        return ExecutionResult(text=text, provider="claude-code", model=model, status="ok")

    async def _execute_api(
        self, config: dict, model: str, prompt: str, system_prompt: str | None, max_tokens: int,
    ) -> ExecutionResult:
        """Execute via direct Anthropic API."""
        credential = config.get("credential")
        api_key = _get_credential(credential) if credential else None
        if not api_key:
            return ExecutionResult(text="", provider="anthropic", model=model, status="error", error=f"Missing credential: {credential}")

        import httpx
        messages = [{"role": "user", "content": prompt}]
        body: dict[str, Any] = {"model": model, "max_tokens": max_tokens, "messages": messages}
        if system_prompt:
            body["system"] = system_prompt

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{config.get('endpoint', 'https://api.anthropic.com')}/v1/messages",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json=body,
            )
            if resp.status_code != 200:
                return ExecutionResult(text="", provider="anthropic", model=model, status="error", error=f"API {resp.status_code}: {resp.text[:200]}")

            data = resp.json()
            text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
            usage = data.get("usage", {})
            return ExecutionResult(
                text=text, provider="anthropic", model=model, status="ok",
                tokens_in=usage.get("input_tokens", 0), tokens_out=usage.get("output_tokens", 0),
            )

    async def _execute_gateway(
        self, config: dict, model: str, prompt: str, system_prompt: str | None, max_tokens: int,
    ) -> ExecutionResult:
        """Execute via OpenAI-compatible gateway (OpenRouter, etc.)."""
        credential = config.get("credential")
        api_key = _get_credential(credential) if credential else None
        if not api_key:
            return ExecutionResult(text="", provider="gateway", model=model, status="error", error=f"Missing credential: {credential}")

        import httpx
        messages: list[dict[str, str]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{config.get('endpoint', 'https://openrouter.ai/api/v1')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "content-type": "application/json"},
                json={"model": model, "max_tokens": max_tokens, "messages": messages},
            )
            if resp.status_code != 200:
                return ExecutionResult(text="", provider="gateway", model=model, status="error", error=f"Gateway {resp.status_code}: {resp.text[:200]}")

            data = resp.json()
            text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            usage = data.get("usage", {})
            return ExecutionResult(
                text=text, provider="gateway", model=model, status="ok",
                tokens_in=usage.get("prompt_tokens", 0), tokens_out=usage.get("completion_tokens", 0),
            )

    async def _execute_local(
        self, config: dict, model: str, prompt: str, system_prompt: str | None, max_tokens: int,
    ) -> ExecutionResult:
        """Execute via local Ollama instance."""
        endpoint = config.get("endpoint", "http://localhost:11434")

        import httpx
        body: dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
        }
        if system_prompt:
            body["system"] = system_prompt
        if max_tokens:
            body["options"] = {"num_predict": max_tokens}

        async with httpx.AsyncClient(timeout=300) as client:
            try:
                resp = await client.post(f"{endpoint}/api/generate", json=body)
            except httpx.ConnectError:
                return ExecutionResult(text="", provider="ollama", model=model, status="error", error="Ollama not running")

            if resp.status_code != 200:
                return ExecutionResult(text="", provider="ollama", model=model, status="error", error=f"Ollama {resp.status_code}")

            data = resp.json()
            return ExecutionResult(
                text=data.get("response", ""), provider="ollama", model=model, status="ok",
                tokens_in=data.get("prompt_eval_count", 0), tokens_out=data.get("eval_count", 0),
            )
