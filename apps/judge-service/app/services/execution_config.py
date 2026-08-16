"""Per-language image, source filename, compile step and run command.

Ported from the code-runner reference engine; only the image tags changed. The comments on
typescript and java are load-bearing — they record why the command is shaped that way.
"""

LANGUAGE_CONFIG = {
    "python": {
        "image": "codementor-runner-python:1.0",
        "filename": "main.py",
        "compile_cmd": None,
        "run_cmd": ["python3", "main.py"],
    },
    "c": {
        "image": "codementor-runner-cpp:1.0",
        "filename": "main.c",
        "compile_cmd": ["gcc", "main.c", "-O2", "-o", "main"],
        "run_cmd": ["./main"],
    },
    "cpp": {
        "image": "codementor-runner-cpp:1.0",
        "filename": "main.cpp",
        "compile_cmd": ["g++", "main.cpp", "-O2", "-o", "main"],
        "run_cmd": ["./main"],
    },
    "java": {
        "image": "codementor-runner-java:1.0",
        "filename": "Main.java",  # class must be named Main
        "compile_cmd": ["javac", "Main.java"],
        "run_cmd": ["java", "Main"],
    },
    "php": {
        "image": "codementor-runner-php:1.0",
        "filename": "main.php",
        "compile_cmd": None,
        "run_cmd": ["php", "main.php"],
    },
    "javascript": {
        "image": "codementor-runner-node:1.0",
        "filename": "main.js",
        "compile_cmd": None,
        "run_cmd": ["node", "main.js"],
    },
    "typescript": {
        "image": "codementor-runner-node:1.0",
        "filename": "main.ts",
        # tsc catches real type errors before anything runs -- unlike ts-node,
        # which would surface them as Runtime Error the same way python's
        # syntax errors do (see INTERPRETED_LANGUAGES in the benchmark scripts).
        "compile_cmd": [
            "tsc",
            "--typeRoots",
            "/opt/ts-types/node_modules/@types",
            "--types",
            "node",
            "main.ts",
        ],
        "run_cmd": ["node", "main.js"],
    },
    "go": {
        "image": "codementor-runner-go:1.0",
        "filename": "main.go",
        "compile_cmd": ["go", "build", "-o", "main", "main.go"],
        "run_cmd": ["./main"],
    },
}
