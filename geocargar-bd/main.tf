# main.tf

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Usaremos la región us-east-1 como indica la pizarra
provider "aws" {
  region = "us-east-1"
}

# 1. Security Group para permitir la conexión a la base de datos
resource "aws_security_group" "rds_sg" {
  name        = "geocarga_rds_sg_dev"
  description = "Permite trafico al puerto de PostgreSQL"

  ingress {
    description = "Acceso a PostgreSQL"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    # 0.0.0.0/0 permite que tú y tu compañero se conecten desde cualquier internet.
    # En producción (PROD), esto se cambia por la IP del servidor Traccar.
    cidr_blocks = ["0.0.0.0/0"] 
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# 2. Instancia RDS PostgreSQL (Capa Gratuita)
resource "aws_db_instance" "geocarga_db" {
  identifier             = "geocarga-db-dev"
  engine                 = "postgres"
  engine_version         = "15"
  instance_class         = "db.t3.micro"       # Gratis por 12 meses
  allocated_storage      = 20                  # Límite de la capa gratuita
  db_name                = "geocargadb"        # Nombre de la base de datos
  username               = "admin_geo"         # Usuario administrador
  password               = "Geocarga2026Seguro!" # Cambia esta contraseña
  
  publicly_accessible    = true                # Permite conexión externa
  multi_az               = false               # Evita cobros dobles
  skip_final_snapshot    = true                # Permite borrarla rápido (terraform destroy)
  
  vpc_security_group_ids = [aws_security_group.rds_sg.id]
}

# 3. Output para obtener la URL de conexión al terminar
output "endpoint_base_de_datos" {
  value       = aws_db_instance.geocarga_db.endpoint
  description = "Entrégale esta URL a la persona de Traccar"
}
# --- Módulo de Almacenamiento (S3 para Documentación) ---

# Generar un sufijo aleatorio para garantizar que el nombre del bucket sea único a nivel mundial
resource "random_id" "bucket_suffix" {
  byte_length = 4
}

# Creación del Bucket S3
resource "aws_s3_bucket" "geocarga_docs" {
  bucket        = "geocarga-documentacion-${random_id.bucket_suffix.hex}"
  force_destroy = true # Permite destruir el bucket con terraform destroy aunque tenga archivos (ideal para desarrollo)

  tags = {
    Name        = "GeoCarga Documentos"
    Environment = "Dev"
    Project     = "GeoCarga"
  }
}

# Bloqueo de acceso público predeterminado (por seguridad)
resource "aws_s3_bucket_public_access_block" "geocarga_docs_block" {
  bucket = aws_s3_bucket.geocarga_docs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Output para obtener el nombre exacto del bucket creado
output "s3_bucket_name" {
  value       = aws_s3_bucket.geocarga_docs.id
  description = "Nombre del bucket S3 creado para documentación"
}