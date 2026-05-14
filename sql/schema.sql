SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- (Opcional) Crear y seleccionar base de datos
CREATE DATABASE IF NOT EXISTS erp_ventas
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE erp_ventas;

-- ==========================================================
-- 1) Usuarios / Auth
-- ==========================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  correo VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol ENUM('gerente', 'vendedor', 'it') NOT NULL DEFAULT 'vendedor',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuarios_correo (correo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ==========================================================
-- 2) Clientes
-- ==========================================================
CREATE TABLE IF NOT EXISTS clientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  codigo_cliente VARCHAR(100) NOT NULL,
  nombre VARCHAR(255) NULL,
  correo VARCHAR(190) NULL,
  numero VARCHAR(60) NULL,
  direccion VARCHAR(255) NULL,
  nit VARCHAR(60) NULL,
  puntos_acumulados INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clientes_codigo_cliente (codigo_cliente),
  KEY idx_clientes_nombre (nombre),
  KEY idx_clientes_correo (correo),
  KEY idx_clientes_nit (nit)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ==========================================================
-- 3) Ventas
-- ==========================================================
CREATE TABLE IF NOT EXISTS ventas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  codigo_cliente VARCHAR(100) NOT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total DECIMAL(10,2) NOT NULL,
  total_normal DECIMAL(10,2) NOT NULL DEFAULT 0,
  descuento_aplicado DECIMAL(10,2) NOT NULL DEFAULT 0,
  premio_id INT NULL,
  codigo_cupon VARCHAR(40) NULL,
  estado VARCHAR(40) NOT NULL DEFAULT 'CONFIRMADA',
  vendedor VARCHAR(120) NOT NULL,
  KEY idx_ventas_fecha (fecha),
  KEY idx_ventas_cliente_id (cliente_id),
  KEY idx_ventas_codigo_cliente (codigo_cliente),
  KEY idx_ventas_vendedor (vendedor),
  KEY idx_ventas_premio_id (premio_id),
  CONSTRAINT fk_ventas_cliente
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ==========================================================
-- 4) Fidelización
-- ==========================================================
CREATE TABLE IF NOT EXISTS configuracion_fidelizacion (
  id INT NOT NULL PRIMARY KEY,
  monto_por_punto DECIMAL(10,2) NOT NULL DEFAULT 10.00,
  puntos_por_bloque INT NOT NULL DEFAULT 1,
  fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO configuracion_fidelizacion (id, monto_por_punto, puntos_por_bloque)
VALUES (1, 10.00, 1)
ON DUPLICATE KEY UPDATE id = id;

CREATE TABLE IF NOT EXISTS puntos_cliente_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NULL,
  codigo_cliente VARCHAR(100) NOT NULL,
  factura_id INT NOT NULL,
  puntos_obtenidos INT NOT NULL,
  total_compra DECIMAL(10,2) NOT NULL,
  monto_por_punto DECIMAL(10,2) NOT NULL,
  puntos_por_bloque INT NOT NULL,
  tipo_evento VARCHAR(60) NOT NULL DEFAULT 'PUNTOS_OBTENIDOS',
  fecha_registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_puntos_cliente_id (cliente_id),
  KEY idx_puntos_codigo_cliente (codigo_cliente),
  KEY idx_puntos_factura_id (factura_id),
  CONSTRAINT fk_puntos_cliente
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT fk_puntos_factura
    FOREIGN KEY (factura_id) REFERENCES ventas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ==========================================================
-- 5) Soporte (Tickets)
-- ==========================================================
CREATE TABLE IF NOT EXISTS tickets_soporte (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NULL,
  codigo_cliente VARCHAR(100) NOT NULL,
  titulo VARCHAR(255) NOT NULL,
  descripcion TEXT NULL,
  estado VARCHAR(40) NOT NULL DEFAULT 'ABIERTO',
  prioridad VARCHAR(40) NOT NULL DEFAULT 'MEDIA',
  fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ticket_codigo_cliente (codigo_cliente),
  KEY idx_ticket_estado (estado),
  KEY idx_ticket_prioridad (prioridad),
  KEY idx_ticket_fecha (fecha_creacion),
  CONSTRAINT fk_tickets_cliente
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ==========================================================
-- 6) Oportunidades de negocio
-- ==========================================================
CREATE TABLE IF NOT EXISTS oportunidades_negocio (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre_oportunidad VARCHAR(255) NOT NULL,
  cliente_id INT NULL,
  codigo_cliente VARCHAR(100) NOT NULL,
  vendedor VARCHAR(120) NOT NULL,
  estado VARCHAR(40) NOT NULL DEFAULT 'ABIERTA',
  fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_oportunidad_cliente (codigo_cliente),
  KEY idx_oportunidad_vendedor (vendedor),
  KEY idx_oportunidad_fecha (fecha_creacion),
  CONSTRAINT fk_oportunidades_cliente
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ==========================================================
-- 7) Interacciones con clientes
-- ==========================================================
CREATE TABLE IF NOT EXISTS interacciones_cliente (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  tipo VARCHAR(60) NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resumen TEXT NOT NULL,
  usuario VARCHAR(120) NULL,
  KEY idx_interacciones_cliente_id (cliente_id),
  KEY idx_interacciones_fecha (fecha),
  CONSTRAINT fk_interacciones_cliente
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ==========================================================
-- 8) Premios / Canje de puntos
-- ==========================================================
CREATE TABLE IF NOT EXISTS premios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  descripcion TEXT NULL,
  costo_puntos INT NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  tipo_descuento ENUM('MONTO', 'PORCENTAJE') NOT NULL DEFAULT 'MONTO',
  valor_descuento DECIMAL(10,2) NOT NULL DEFAULT 0,
  KEY idx_premios_activo (activo),
  KEY idx_premios_costo (costo_puntos)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS canjes_premios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NULL,
  codigo_cliente VARCHAR(100) NULL,
  premio_id INT NOT NULL,
  factura_id INT NULL,
  puntos_canjeados INT NOT NULL,
  codigo_cupon VARCHAR(40) NOT NULL,
  estado VARCHAR(30) NOT NULL DEFAULT 'GENERADO',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_canjes_codigo_cupon (codigo_cupon),
  KEY idx_canjes_cliente_id (cliente_id),
  KEY idx_canjes_codigo_cliente (codigo_cliente),
  KEY idx_canjes_premio_id (premio_id),
  KEY idx_canjes_factura_id (factura_id),
  CONSTRAINT fk_canjes_premio
    FOREIGN KEY (premio_id) REFERENCES premios(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE canjes_premios
  ADD CONSTRAINT fk_canjes_factura
    FOREIGN KEY (factura_id) REFERENCES ventas(id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL;
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
