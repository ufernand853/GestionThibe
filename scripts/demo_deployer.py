#!/usr/bin/env python3
"""Automate demo deployment tasks for GestionThibe."""
from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path
from typing import Dict, Iterable, Optional

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_DIR = REPO_ROOT / "frontend"

DEFAULT_MONGO_URI = "mongodb://admin:admin123@localhost:27017/gestionthibe?authSource=admin"
DOCKER_CONTAINER_NAME = "gestionthibe-mongo"


def which_or_exit(tool: str) -> None:
    if shutil.which(tool) is None:
        print(f"Error: se requiere '{tool}' pero no se encontró en PATH.", file=sys.stderr)
        sys.exit(1)


def run(cmd: Iterable[str], cwd: Optional[Path] = None, env: Optional[Dict[str, str]] = None) -> None:
    print(f"\n[cmd] {' '.join(cmd)}")
    try:
        subprocess.run(cmd, check=True, cwd=cwd, env=env)
    except subprocess.CalledProcessError as exc:
        print(f"El comando falló con código {exc.returncode}", file=sys.stderr)
        sys.exit(exc.returncode)


def ensure_repo_root() -> None:
    expected = REPO_ROOT / ".git"
    if not expected.exists():
        print("Ejecuta este script desde la raíz del repositorio (donde está la carpeta .git).", file=sys.stderr)
        sys.exit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepara y levanta el backend y frontend para una demo automática."
    )
    parser.add_argument(
        "--mongo-mode",
        choices=["docker", "uri", "skip"],
        default="docker",
        help=(
            "Cómo preparar MongoDB: 'docker' crea un contenedor local, 'uri' usa la cadena proporcionada y 'skip' supone que ya está disponible."
        ),
    )
    parser.add_argument(
        "--mongo-uri",
        help="Cadena de conexión a MongoDB cuando se usa --mongo-mode uri o skip.",
    )
    parser.add_argument("--backend-port", type=int, default=3000, help="Puerto en el que escuchará el backend.")
    parser.add_argument("--frontend-port", type=int, default=4173, help="Puerto para el preview del frontend.")
    parser.add_argument("--admin-email", default="admin@example.com", help="Correo para el usuario administrador inicial.")
    parser.add_argument("--admin-password", default="ChangeMe123!", help="Contraseña para el usuario administrador inicial.")
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="No ejecutar npm run build en el frontend (útil para pruebas rápidas).",
    )
    parser.add_argument(
        "--no-start",
        action="store_true",
        help="Prepara todo pero no deja procesos corriendo. Ideal si deseas iniciarlos manualmente después.",
    )
    return parser.parse_args()


def ensure_docker_container() -> str:
    which_or_exit("docker")
    try:
        result = subprocess.run(
            [
                "docker",
                "ps",
                "-a",
                "--filter",
                f"name={DOCKER_CONTAINER_NAME}",
                "--format",
                "{{.Status}}",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        print("No se pudo verificar el estado de Docker.", file=sys.stderr)
        sys.exit(exc.returncode)

    status = result.stdout.strip()
    if status:
        print(f"Contenedor {DOCKER_CONTAINER_NAME} existente encontrado: {status}")
        if not status.lower().startswith("up"):
            run(["docker", "start", DOCKER_CONTAINER_NAME])
    else:
        run(
            [
                "docker",
                "run",
                "--name",
                DOCKER_CONTAINER_NAME,
                "-p",
                "27017:27017",
                "-e",
                "MONGO_INITDB_ROOT_USERNAME=admin",
                "-e",
                "MONGO_INITDB_ROOT_PASSWORD=admin123",
                "-d",
                "mongo:6",
            ]
        )
    return DEFAULT_MONGO_URI


def write_env_file(path: Path, values: Dict[str, str]) -> None:
    lines = [f"{key}={value}" for key, value in values.items()]
    content = "\n".join(lines) + "\n"
    if path.exists():
        current = path.read_text()
        if current == content:
            print(f"Sin cambios en {path}")
            return
        backup = path.with_suffix(path.suffix + ".bak")
        path.replace(backup)
        print(f"Archivo {path.name} existente respaldado como {backup.name}")
    else:
        example = path.with_suffix(path.suffix + ".example")
        if example.exists():
            shutil.copy(example, path)
            print(f"Se creó {path.name} a partir de {example.name}")
    path.write_text(content)
    print(f"Archivo {path} actualizado")


def prepare_backend(mongo_uri: str, backend_port: int, admin_email: str, admin_password: str) -> None:
    print("\n=== Preparando backend ===")
    which_or_exit("npm")
    write_env_file(
        BACKEND_DIR / ".env",
        {
            "PORT": str(backend_port),
            "MONGO_URI": mongo_uri,
            "JWT_SECRET": os.environ.get("JWT_SECRET", "demo-secret-change-me"),
            "ACCESS_TOKEN_TTL": "3600",
            "REFRESH_TOKEN_TTL": "604800",
            "ADMIN_EMAIL": admin_email,
            "ADMIN_PASSWORD": admin_password,
        },
    )
    run(["npm", "install"], cwd=BACKEND_DIR)


def prepare_frontend(backend_port: int) -> None:
    print("\n=== Preparando frontend ===")
    which_or_exit("npm")
    write_env_file(
        FRONTEND_DIR / ".env",
        {
            "VITE_API_BASE_URL": f"http://localhost:{backend_port}/api",
        },
    )
    run(["npm", "install"], cwd=FRONTEND_DIR)


def start_services(args: argparse.Namespace) -> None:
    backend_cmd = ["npm", "start"]
    frontend_cmd = [
        "npm",
        "run",
        "preview",
        "--",
        "--host",
        "0.0.0.0",
        "--port",
        str(args.frontend_port),
    ]
    backend_proc = subprocess.Popen(backend_cmd, cwd=BACKEND_DIR)
    frontend_proc = subprocess.Popen(frontend_cmd, cwd=FRONTEND_DIR)
    print("\nProcesos iniciados. Usa Ctrl+C para detenerlos.")

    def _terminate(*_sig):
        print("\nDeteniendo procesos...")
        for proc in (backend_proc, frontend_proc):
            if proc.poll() is None:
                proc.terminate()
        for proc in (backend_proc, frontend_proc):
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, _terminate)
    signal.signal(signal.SIGTERM, _terminate)
    backend_proc.wait()
    frontend_proc.wait()


def main() -> None:
    ensure_repo_root()
    args = parse_args()
    which_or_exit("node")

    if args.mongo_mode == "docker":
        mongo_uri = ensure_docker_container()
    else:
        if args.mongo_uri:
            mongo_uri = args.mongo_uri
        elif args.mongo_mode == "uri":
            print("Debes proporcionar --mongo-uri cuando uses --mongo-mode uri.", file=sys.stderr)
            sys.exit(1)
        else:
            mongo_uri = DEFAULT_MONGO_URI

    prepare_backend(mongo_uri, args.backend_port, args.admin_email, args.admin_password)
    prepare_frontend(args.backend_port)

    if not args.skip_build:
        run(["npm", "run", "build"], cwd=FRONTEND_DIR)

    if args.no_start:
        print("\nPreparación completa. Puedes iniciar los servicios manualmente si lo deseas.")
        return

    start_services(args)


if __name__ == "__main__":
    main()
