# Proyecto Técnico – Gestión de Stock y Clientes

## 1. Objetivo
Desarrollar un sistema de gestión de stock que permita:
- Controlar inventario en múltiples grupos de artículos.
- Administrar sobrestock general y específico (Thibe, Arenal Import).
- Gestionar stock reservado para clientes (evitar mezcla con stock general).
- Registrar movimientos (entrada, salida, transferencia).
- Consultar y exportar reportes de stock y movimientos.

---

## 2. Alcance Funcional
- **Grupos de artículos**: Medias, Ropa Interior, Blancos, Accesorios, Jean Hombre/Dama/Niño, Ropa Hombre/Dama/Niño, Calzado, Electrónicos, Juguetes, Escolares.
- **Listas de stock**:
  - Stock General
  - Sobrestock (General, Thibe, Arenal Import)
  - Clientes (stock reservado)
- **Operaciones**:
  - Alta de artículos
  - Baja de stock (venta/retiro)
  - Transferencia entre listas (ej. cliente paga pero no retira)
- **Reportes**:
  - Stock por grupo
  - Stock reservado por cliente
  - Histórico de movimientos

---

## 3. Arquitectura Técnica

### 3.1 Backend
- Lenguaje: Node.js + Express
- Base de datos: MongoDB (preferido) o PostgreSQL
- API REST:
  - `POST /api/items` → crear artículo
  - `GET /api/items` → listar artículos
  - `POST /api/stock/move` → mover stock entre listas
  - `GET /api/customers/:id/stock` → ver stock de cliente
  - `GET /api/reports/stock` → reportes generales

### 3.2 Frontend
- Framework: React.js
- Módulos:
  - Gestión de artículos
  - Movimientos de stock
  - Vista de clientes y stock reservado
  - Exportación CSV/Excel

### 3.3 Infraestructura
- Hosting: VM en Google Cloud (ejemplo e2-standard-4 ~ USD 150/mes)
- Contenedores: Docker para backend y frontend
- Seguridad: JWT + HTTPS

---

## 4. Modelo de Datos

### Groups
```json
{
  "id": "uuid",
  "name": "string"
}
```

### Items
```json
{
  "id": "uuid",
  "code": "string",
  "description": "string",
  "groupId": "uuid",
  "stock": "int"
}
```

### Customers
```json
{
  "id": "uuid",
  "name": "string",
  "contactInfo": "string"
}
```

### CustomerStock
```json
{
  "id": "uuid",
  "customerId": "uuid",
  "itemId": "uuid",
  "quantity": "int",
  "status": "reserved | delivered",
  "dateCreated": "datetime"
}
```

### Movements
```json
{
  "id": "uuid",
  "itemId": "uuid",
  "type": "in | out | transfer",
  "fromList": "general | overstock | customer",
  "toList": "general | overstock | customer",
  "quantity": "int",
  "date": "datetime",
  "user": "string"
}
```

---

## 5. Casos de Uso

1. **Alta stock general** → Ingreso artículo en stock principal.  
2. **Venta con retiro inmediato** → Baja en stock general.  
3. **Venta con reserva** → Baja en stock general + alta en lista cliente.  
4. **Entrega diferida** → Movimiento desde lista cliente a entregado.  
5. **Reportes** → Stock por grupo, por cliente y movimientos históricos.

---

## 6. Seguridad y Auditoría
- Autenticación JWT
- Roles: admin, operador, consulta
- Registro de movimientos en `Movements`

---

## 7. Requisitos No Funcionales
- Escalabilidad: >100k artículos y >1k clientes
- Disponibilidad: 99.5% en Google Cloud
- Respuesta de consultas < 1s
- Backup diario automático

---

## 8. Roadmap
1. Backend API + Modelo de datos
2. Frontend básico
3. Reportes + exportación Excel
4. Optimización + despliegue cloud
