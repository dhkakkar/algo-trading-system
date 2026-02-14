"""RestrictedPython configuration for sandboxed strategy execution."""

from RestrictedPython import compile_restricted, safe_builtins
from RestrictedPython.Guards import safe_globals, guarded_iter_unpack_sequence
from app.sandbox.allowed_modules import ALLOWED_MODULES, BLOCKED_BUILTINS
import math
import statistics
import datetime
import decimal
import collections
import itertools
import functools


def create_safe_builtins():
    """Create a restricted builtins dict for strategy execution."""
    safe = dict(safe_builtins)

    # Remove blocked builtins
    for name in BLOCKED_BUILTINS:
        safe.pop(name, None)

    # Add safe math functions
    safe["abs"] = abs
    safe["round"] = round
    safe["min"] = min
    safe["max"] = max
    safe["sum"] = sum
    safe["len"] = len
    safe["range"] = range
    safe["enumerate"] = enumerate
    safe["zip"] = zip
    safe["sorted"] = sorted
    safe["reversed"] = reversed
    safe["map"] = map
    safe["filter"] = filter
    safe["any"] = any
    safe["all"] = all
    safe["isinstance"] = isinstance
    safe["int"] = int
    safe["float"] = float
    safe["str"] = str
    safe["bool"] = bool
    safe["list"] = list
    safe["dict"] = dict
    safe["tuple"] = tuple
    safe["set"] = set
    safe["frozenset"] = frozenset
    safe["print"] = print  # Will be redirected to ctx.log()

    return safe


def create_safe_globals(strategy_base_class, context_instance=None):
    """
    Create the globals dict for executing user strategy code.

    Args:
        strategy_base_class: The Strategy base class to expose
        context_instance: Optional TradingContext instance for runtime
    """
    safe_globs = {"__builtins__": create_safe_builtins()}

    # Add the Strategy base class
    safe_globs["Strategy"] = strategy_base_class

    # Add allowed modules
    safe_globs["math"] = math
    safe_globs["statistics"] = statistics
    safe_globs["datetime"] = datetime
    safe_globs["decimal"] = decimal
    safe_globs["collections"] = collections
    safe_globs["itertools"] = itertools
    safe_globs["functools"] = functools

    # Guard for iteration unpacking
    safe_globs["_iter_unpack_sequence_"] = guarded_iter_unpack_sequence
    safe_globs["_getiter_"] = iter

    return safe_globs


def compile_strategy_code(code: str) -> any:
    """
    Compile user strategy code using RestrictedPython.

    Returns compiled code object or raises SyntaxError/CompileError.
    """
    result = compile_restricted(
        code,
        filename="<strategy>",
        mode="exec",
    )

    if result.errors:
        raise SyntaxError(f"Strategy compilation errors: {'; '.join(result.errors)}")

    return result.code
