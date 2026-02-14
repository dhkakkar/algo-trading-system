"""Sandboxed executor for user-defined trading strategies."""

import ast
import logging
from app.sandbox.restricted_env import compile_strategy_code, create_safe_globals
from app.sandbox.resource_limits import MAX_CODE_LENGTH
from app.sdk.strategy_base import Strategy

logger = logging.getLogger(__name__)


class StrategyExecutor:
    """Compiles and executes user strategy code in a sandboxed environment."""

    def __init__(self):
        self._strategy_instance = None
        self._strategy_class = None

    def validate_code(self, code: str) -> dict:
        """
        Validate strategy code without executing it.
        Returns {"valid": True} or {"valid": False, "error": "message"}.
        """
        if len(code) > MAX_CODE_LENGTH:
            return {"valid": False, "error": f"Code exceeds maximum length of {MAX_CODE_LENGTH} characters"}

        # Check syntax with ast.parse first (faster, better errors)
        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            return {"valid": False, "error": f"Syntax error at line {e.lineno}: {e.msg}"}

        # Check for a Strategy subclass
        has_strategy_class = False
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                for base in node.bases:
                    if isinstance(base, ast.Name) and base.id == "Strategy":
                        has_strategy_class = True
                        break

        if not has_strategy_class:
            return {"valid": False, "error": "Code must contain a class that extends Strategy"}

        # Try compiling with RestrictedPython
        try:
            compile_strategy_code(code)
        except SyntaxError as e:
            return {"valid": False, "error": str(e)}
        except Exception as e:
            return {"valid": False, "error": f"Compilation error: {str(e)}"}

        return {"valid": True}

    def load_strategy(self, code: str) -> type:
        """
        Compile and load a strategy class from user code.
        Returns the strategy class (not an instance).
        """
        validation = self.validate_code(code)
        if not validation["valid"]:
            raise ValueError(validation["error"])

        compiled = compile_strategy_code(code)
        safe_globals = create_safe_globals(Strategy)

        exec(compiled, safe_globals)

        # Find the Strategy subclass
        strategy_class = None
        for name, obj in safe_globals.items():
            if (
                isinstance(obj, type)
                and issubclass(obj, Strategy)
                and obj is not Strategy
            ):
                strategy_class = obj
                break

        if strategy_class is None:
            raise ValueError("No Strategy subclass found in code")

        self._strategy_class = strategy_class
        return strategy_class

    def create_instance(self, code: str) -> Strategy:
        """Compile, load, and instantiate the strategy."""
        cls = self.load_strategy(code)
        self._strategy_instance = cls()
        return self._strategy_instance
