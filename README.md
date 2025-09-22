# Gestión de Stock y Clientes – Especificación Técnica

Este repositorio contiene la documentación técnica **lista para desarrollo**. 
Se sugiere el siguiente flujo:
1. Revisar `SPEC.md` (documento de arquitectura y requisitos).
2. Implementar la API conforme a `openapi.yaml`.
3. Usar `codex_prompts.md` para generar código inicial (modelos, endpoints, middleware RBAC, etc.).

## Pila sugerida
- **Backend**: Node.js + Express
- **DB**: MongoDB (Mongoose) o PostgreSQL
- **Front**: React.js
- **Infra**: Docker + VM en Google Cloud (e2-standard-4)
