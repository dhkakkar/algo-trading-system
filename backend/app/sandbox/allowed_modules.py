"""Whitelist of modules that user strategy code is allowed to import."""

ALLOWED_MODULES = {
    "math",
    "statistics",
    "datetime",
    "decimal",
    "collections",
    "itertools",
    "functools",
}

# These builtins are blocked in the sandbox
BLOCKED_BUILTINS = {
    "exec", "eval", "compile", "__import__", "open",
    "input", "breakpoint", "exit", "quit",
    "globals", "locals", "vars", "dir",
    "getattr", "setattr", "delattr",
    "type", "super", "classmethod", "staticmethod",
    "memoryview", "bytearray",
}
