
import os
import io
import json
import base64
import sqlite3
import uuid
import secrets
import logging

from pathlib import Path
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager
from typing import Optional

import fitz
import httpx
import jwt

from pwdlib import PasswordHash
from fastapi import (
    FastAPI,
    UploadFile,
    File,
    HTTPException,
    Depends,
    status,
)
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator


# ============================================================
# CONFIGURATION
# ============================================================
from dotenv import load_dotenv

load_dotenv()
BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = BASE_DIR / "medimate.db"

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5vl:3b")

MAX_FILE_SIZE = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}

JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 24  # 24 hours

# Set MEDIMATE_JWT_SECRET in your environment before starting
# the application. Never use a public or hardcoded production secret.
JWT_SECRET = os.getenv("MEDIMATE_JWT_SECRET", "").strip()

if len(JWT_SECRET) < 32:
    raise RuntimeError(
        "MEDIMATE_JWT_SECRET is missing or too short. "
        "Set it to a randomly generated secret of at least 32 characters."
    )

password_hasher = PasswordHash.recommended()
bearer_scheme = HTTPBearer(auto_error=False)

# Temporary analyses are tied to the account that created them.
# They are not persisted and will be lost when the backend restarts.
analyses = {}

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("medimate")


# ============================================================
# DATABASE HELPERS
# ============================================================

def get_connection():
    connection = sqlite3.connect(DATABASE_PATH, timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 15000")
    return connection


def get_columns(connection, table):
    # Table names passed here are internal constants, not user input.
    return {
        row["name"]: row
        for row in connection.execute(
            f'PRAGMA table_info("{table}")'
        ).fetchall()
    }


def add_column_if_missing(connection, table, column, definition):
    columns = get_columns(connection, table)

    if column not in columns:
        connection.execute(
            f'ALTER TABLE "{table}" ADD COLUMN "{column}" {definition}'
        )


def initialize_database():
    connection = get_connection()

    try:
        # Existing prescription schema is retained.
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS prescriptions (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT ''
            )
            """
        )

        # Existing medicines schema is retained. medicine_name is kept
        # because older databases may require it to be populated.
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS medicines (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prescription_id TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL DEFAULT '',
                medicine_name TEXT NOT NULL DEFAULT '',
                dosage TEXT NOT NULL DEFAULT '',
                quantity TEXT NOT NULL DEFAULT '',
                timing TEXT NOT NULL DEFAULT '',
                duration TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT ''
            )
            """
        )

        # New authentication table.
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL COLLATE NOCASE UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )

        # Preserve old prescription records. The new nullable user_id
        # leaves every pre-existing record unassigned.
        add_column_if_missing(
            connection,
            "prescriptions",
            "user_id",
            "INTEGER REFERENCES users(id) ON DELETE SET NULL",
        )

        prescription_additions = {
            "filename": "TEXT NOT NULL DEFAULT ''",
            "created_at": "TEXT NOT NULL DEFAULT ''",
        }

        for column, definition in prescription_additions.items():
            add_column_if_missing(
                connection, "prescriptions", column, definition
            )

        medicine_additions = {
            "prescription_id": "TEXT NOT NULL DEFAULT ''",
            "name": "TEXT NOT NULL DEFAULT ''",
            "medicine_name": "TEXT NOT NULL DEFAULT ''",
            "dosage": "TEXT NOT NULL DEFAULT ''",
            "quantity": "TEXT NOT NULL DEFAULT ''",
            "timing": "TEXT NOT NULL DEFAULT ''",
            "duration": "TEXT NOT NULL DEFAULT ''",
            "notes": "TEXT NOT NULL DEFAULT ''",
            "is_active": "INTEGER NOT NULL DEFAULT 1",
        }

        for column, definition in medicine_additions.items():
            add_column_if_missing(
                connection, "medicines", column, definition
            )

        # Keep legacy medicine-name columns synchronized.
        medicine_columns = get_columns(connection, "medicines")

        name_sources = [
            "medicine_name",
            "drug_name",
            "medicine",
            "drug",
        ]

        for source in name_sources:
            if source in medicine_columns and source != "name":
                connection.execute(
                    f"""
                    UPDATE medicines
                    SET name = "{source}"
                    WHERE (name IS NULL OR name = '')
                    AND "{source}" IS NOT NULL
                    AND "{source}" != ''
                    """
                )

        connection.execute(
            """
            UPDATE medicines
            SET medicine_name = name
            WHERE (medicine_name IS NULL OR medicine_name = '')
            AND name IS NOT NULL
            AND name != ''
            """
        )

        connection.execute(
            """
            UPDATE medicines
            SET name = medicine_name
            WHERE (name IS NULL OR name = '')
            AND medicine_name IS NOT NULL
            AND medicine_name != ''
            """
        )

        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_medicines_prescription_id
            ON medicines(prescription_id)
            """
        )

        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_prescriptions_user_id
            ON prescriptions(user_id)
            """
        )

        connection.commit()

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    yield


# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(
    title="MediMate API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# REQUEST MODELS
# ============================================================

class AuthInput(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        value = value.strip().lower()

        if value.count("@") != 1:
            raise ValueError("Enter a valid email address.")

        local, domain = value.split("@", 1)

        if (
            not local
            or not domain
            or "." not in domain
            or any(char.isspace() for char in value)
        ):
            raise ValueError("Enter a valid email address.")

        return value


class MedicineInput(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    dosage: str = Field(default="", max_length=200)
    quantity: str = Field(default="", max_length=200)
    timing: str = Field(default="", max_length=300)
    duration: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=2000)


class ConfirmPrescriptionRequest(BaseModel):
    analysis_id: str
    filename: str = Field(default="", max_length=500)
    medicines: list[MedicineInput] = Field(min_length=1, max_length=100)


# ============================================================
# AUTHENTICATION HELPERS
# ============================================================

def create_access_token(user_id: int):
    now = datetime.now(timezone.utc)

    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=JWT_EXPIRE_MINUTES),
        "jti": secrets.token_urlsafe(16),
    }

    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(
        bearer_scheme
    ),
):
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Please log in to continue.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["sub", "exp", "iat"]},
        )

        subject = payload.get("sub")

        if not subject or not subject.isdigit():
            raise jwt.InvalidTokenError("Invalid user identifier")

        user_id = int(subject)

    except (jwt.InvalidTokenError, TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session is invalid or expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    connection = get_connection()

    try:
        user = connection.execute(
            """
            SELECT id, email, created_at
            FROM users
            WHERE id = ?
            """,
            (user_id,),
        ).fetchone()

        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="This account no longer exists. Please log in again.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return dict(user)

    finally:
        connection.close()


def require_owned_prescription(
    connection,
    prescription_id: str,
    user_id: int,
):
    """
    Return a prescription only if it belongs to this authenticated user.
    Legacy records with user_id NULL are deliberately inaccessible.
    """
    columns = get_columns(connection, "prescriptions")

    if "id" in columns:
        id_column = "id"
    elif "prescription_id" in columns:
        id_column = "prescription_id"
    else:
        raise HTTPException(
            status_code=500,
            detail="The prescriptions table has no recognized ID column.",
        )

    if "user_id" not in columns:
        raise HTTPException(
            status_code=500,
            detail="Prescription ownership migration has not completed.",
        )

    prescription = connection.execute(
        f"""
        SELECT *
        FROM prescriptions
        WHERE "{id_column}" = ?
          AND user_id = ?
        """,
        (prescription_id, user_id),
    ).fetchone()

    if prescription is None:
        # Same response for missing and other users' records.
        raise HTTPException(
            status_code=404,
            detail="Prescription not found.",
        )

    return dict(prescription), id_column


def get_prescription_reference_values(prescription, prescription_id):
    values = {str(prescription_id)}

    for column in ("id", "prescription_id"):
        value = prescription.get(column)

        if value is not None:
            values.add(str(value))

    return values


# ============================================================
# PRESCRIPTION / OLLAMA HELPERS
# ============================================================

def get_text_from_pdf(file_bytes):
    text_parts = []
    images = []

    try:
        document = fitz.open(stream=file_bytes, filetype="pdf")

        for page in document:
            page_text = page.get_text("text").strip()

            if page_text:
                text_parts.append(page_text)

            if not page_text or len(page_text) < 40:
                pixmap = page.get_pixmap(
                    matrix=fitz.Matrix(1.5, 1.5),
                    alpha=False,
                )
                image_bytes = pixmap.tobytes("png")
                images.append(
                    base64.b64encode(image_bytes).decode("utf-8")
                )

        document.close()

    except Exception:
        logger.exception("Could not read uploaded PDF")
        raise HTTPException(
            status_code=400,
            detail="Could not read the PDF. Check that it is a valid PDF.",
        )

    return "\n".join(text_parts), images


def get_image_base64(file_bytes):
    return base64.b64encode(file_bytes).decode("utf-8")


async def analyze_with_ollama(text, images):
    prompt = """
You are a prescription-reading assistant for MediMate.

Extract the medicines written in the supplied prescription.

Return only valid JSON with this structure:
{
  "medicines": [
    {
      "name": "medicine name",
      "dosage": "written dosage or empty string",
      "quantity": "written quantity or empty string",
      "timing": "written timing or empty string",
      "duration": "written duration or empty string",
      "notes": "relevant instructions or uncertainty"
    }
  ],
  "document_uncertainties": []
}

Rules:
- Do not invent a medicine, dosage, quantity, timing, or duration.
- If information is unreadable or absent, use an empty string.
- Record uncertain or illegible details in document_uncertainties.
- Preserve the prescription's wording where possible.
- Do not recommend medicines or change the doctor's instructions.
- Return an empty medicines array if no medicine can be identified.
"""

    content = prompt

    if text.strip():
        content += "\n\nPrescription text:\n" + text

    request_data = {
        "model": OLLAMA_MODEL,
        "prompt": content,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0},
    }

    if images:
        request_data["images"] = images

    try:
        async with httpx.AsyncClient(timeout=180) as client:
            response = await client.post(
                f"{OLLAMA_URL.rstrip('/')}/api/generate",
                json=request_data,
            )
            response.raise_for_status()
            response_data = response.json()

    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Ollama is not running. Start Ollama and try again.",
        )

    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="Ollama took too long to analyze the prescription.",
        )

    except httpx.HTTPStatusError:
        logger.exception("Ollama returned an HTTP error")
        raise HTTPException(
            status_code=502,
            detail="Ollama returned an error while analyzing the prescription.",
        )

    except Exception:
        logger.exception("Prescription analysis failed")
        raise HTTPException(
            status_code=502,
            detail="Prescription analysis failed. Please try again.",
        )

    raw_response = response_data.get("response", "")

    try:
        result = json.loads(raw_response)
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(
            status_code=502,
            detail="The AI returned invalid JSON. Please try again.",
        )

    medicines = result.get("medicines", [])
    uncertainties = result.get("document_uncertainties", [])

    if not isinstance(medicines, list):
        medicines = []

    if not isinstance(uncertainties, list):
        uncertainties = []

    cleaned_medicines = []

    for medicine in medicines:
        if not isinstance(medicine, dict):
            continue

        name = str(medicine.get("name") or "").strip()

        if not name:
            continue

        cleaned_medicines.append(
            {
                "name": name[:300],
                "dosage": str(medicine.get("dosage") or "").strip()[:200],
                "quantity": str(medicine.get("quantity") or "").strip()[:200],
                "timing": str(medicine.get("timing") or "").strip()[:300],
                "duration": str(medicine.get("duration") or "").strip()[:200],
                "notes": str(medicine.get("notes") or "").strip()[:2000],
            }
        )

    cleaned_uncertainties = [
        str(item)[:1000]
        for item in uncertainties
        if isinstance(item, (str, int, float))
    ][:100]

    return cleaned_medicines, cleaned_uncertainties


# ============================================================
# SCHEMA-ADAPTIVE INSERT HELPERS
# ============================================================

def insert_record(connection, table, data):
    columns_info = get_columns(connection, table)
    insert_data = {}

    for column, value in data.items():
        if column in columns_info:
            insert_data[column] = value

    # Preserve support for legacy tables with additional required columns.
    for column, info in columns_info.items():
        if column in insert_data:
            continue

        is_required = bool(info["notnull"])
        has_default = info["dflt_value"] is not None
        is_primary_key = bool(info["pk"])

        if is_required and not has_default and not is_primary_key:
            column_type = (info["type"] or "").upper()

            if "INT" in column_type or "REAL" in column_type:
                insert_data[column] = 0
            else:
                insert_data[column] = ""

    if not insert_data:
        cursor = connection.execute(
            f'INSERT INTO "{table}" DEFAULT VALUES'
        )
        return cursor.lastrowid

    columns = list(insert_data.keys())
    column_names = ", ".join(f'"{column}"' for column in columns)
    placeholders = ", ".join("?" for _ in columns)

    cursor = connection.execute(
        f'INSERT INTO "{table}" ({column_names}) VALUES ({placeholders})',
        [insert_data[column] for column in columns],
    )

    return cursor.lastrowid


def get_inserted_prescription_reference(connection, generated_id, row_id):
    columns = get_columns(connection, "prescriptions")

    if "id" in columns:
        id_info = columns["id"]

        if id_info["pk"]:
            column_type = (id_info["type"] or "").upper()

            if "INT" in column_type:
                return row_id

            return generated_id

    if "prescription_id" in columns:
        return generated_id

    return row_id if row_id is not None else generated_id


# ============================================================
# PUBLIC / HEALTH ENDPOINTS
# ============================================================

@app.get("/")
def root():
    return {
        "message": "MediMate API is running",
        "docs": "/docs",
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": OLLAMA_MODEL,
    }


# ============================================================
# AUTH ENDPOINTS
# ============================================================

@app.post("/api/auth/signup", status_code=status.HTTP_201_CREATED)
def signup(payload: AuthInput):
    email = payload.email
    password = payload.password

    # Hash before inserting. A duplicate email is handled below.
    password_hash = password_hasher.hash(password)
    created_at = datetime.now(timezone.utc).isoformat()

    connection = get_connection()

    try:
        cursor = connection.execute(
            """
            INSERT INTO users (email, password_hash, created_at)
            VALUES (?, ?, ?)
            """,
            (email, password_hash, created_at),
        )
        connection.commit()
        user_id = cursor.lastrowid

    except sqlite3.IntegrityError:
        connection.rollback()
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists.",
        )

    finally:
        connection.close()

    return {
        "message": "Account created successfully.",
        "access_token": create_access_token(user_id),
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "email": email,
            "created_at": created_at,
        },
    }


@app.post("/api/auth/login")
def login(payload: AuthInput):
    connection = get_connection()

    try:
        user = connection.execute(
            """
            SELECT id, email, password_hash, created_at
            FROM users
            WHERE email = ?
            """,
            (payload.email,),
        ).fetchone()

    finally:
        connection.close()

    # Use the same error for unknown email and incorrect password.
    if user is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password.",
        )

    try:
        password_valid = password_hasher.verify(
            payload.password,
            user["password_hash"],
        )
    except Exception:
        password_valid = False

    if not password_valid:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password.",
        )

    return {
        "message": "Login successful.",
        "access_token": create_access_token(user["id"]),
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "email": user["email"],
            "created_at": user["created_at"],
        },
    }


@app.get("/api/auth/me")
def get_me(current_user: dict = Depends(get_current_user)):
    return {"user": current_user}


# ============================================================
# ANALYZE PRESCRIPTION — AUTHENTICATED
# ============================================================

@app.post("/api/prescriptions/analyze")
async def analyze_prescription(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    filename = Path(file.filename or "prescription").name
    extension = Path(filename).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Upload a PDF, JPG, JPEG, PNG, or WEBP file.",
        )

    # Read at most MAX_FILE_SIZE + 1 bytes to enforce the limit.
    file_bytes = await file.read(MAX_FILE_SIZE + 1)
    await file.close()

    if not file_bytes:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is empty.",
        )

    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="The file must be 10 MB or smaller.",
        )

    text = ""
    images = []

    if extension == ".pdf":
        text, images = get_text_from_pdf(file_bytes)

        if not text.strip() and not images:
            raise HTTPException(
                status_code=400,
                detail="No readable content was found in the PDF.",
            )
    else:
        images = [get_image_base64(file_bytes)]

    medicines, uncertainties = await analyze_with_ollama(text, images)

    analysis_id = str(uuid.uuid4())

    analyses[analysis_id] = {
        "user_id": current_user["id"],
        "filename": filename,
        "medicines": medicines,
        "document_uncertainties": uncertainties,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    return {
        "analysis_id": analysis_id,
        "filename": filename,
        "medicines": medicines,
        "document_uncertainties": uncertainties,
        "requires_user_confirmation": True,
    }


# ============================================================
# CONFIRM / SAVE PRESCRIPTION — AUTHENTICATED AND OWNED
# ============================================================

@app.post("/api/prescriptions/confirm")
def confirm_prescription(
    payload: ConfirmPrescriptionRequest,
    current_user: dict = Depends(get_current_user),
):
    analysis = analyses.get(payload.analysis_id)

    if analysis is None or analysis["user_id"] != current_user["id"]:
        raise HTTPException(
            status_code=404,
            detail="Analysis not found. Please analyze the prescription again.",
        )

    filename = (
        payload.filename.strip()
        or analysis["filename"]
        or "prescription"
    )

    if len(payload.medicines) == 0:
        raise HTTPException(
            status_code=400,
            detail="Add at least one medicine before confirming.",
        )

    # Do not let the client confirm medicines unrelated to its analysis.
    # The user may edit the analyzed list, but the analysis must belong
    # to this same account.
    generated_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    connection = get_connection()

    try:
        connection.execute("BEGIN")

        prescription_row_id = insert_record(
            connection,
            "prescriptions",
            {
                "id": generated_id,
                "prescription_id": generated_id,
                "filename": filename,
                "file_name": filename,
                "created_at": created_at,
                "uploaded_at": created_at,
                "created": created_at,
                "analysis_id": payload.analysis_id,
                "user_id": current_user["id"],
            },
        )

        prescription_reference = get_inserted_prescription_reference(
            connection,
            generated_id,
            prescription_row_id,
        )

        saved_count = 0

        for medicine in payload.medicines:
            medicine_name = medicine.name.strip()

            if not medicine_name:
                continue

            medicine_data = {
                "prescription_id": prescription_reference,
                "prescription": prescription_reference,
                "prescription_ref": prescription_reference,
                "name": medicine_name,
                "medicine_name": medicine_name,
                "drug_name": medicine_name,
                "medicine": medicine_name,
                "dosage": medicine.dosage,
                "dose": medicine.dosage,
                "quantity": medicine.quantity,
                "timing": medicine.timing,
                "frequency": medicine.timing,
                "duration": medicine.duration,
                "notes": medicine.notes,
                "instructions": medicine.notes,
                "created_at": created_at,
                "is_active": 1,
            }

            insert_record(connection, "medicines", medicine_data)
            saved_count += 1

        if saved_count == 0:
            raise HTTPException(
                status_code=400,
                detail="No valid medicines were provided.",
            )

        connection.commit()
        analyses.pop(payload.analysis_id, None)

        return {
            "message": "Prescription saved successfully.",
            "prescription_id": str(prescription_reference),
            "filename": filename,
            "medicines_saved": saved_count,
        }

    except HTTPException:
        connection.rollback()
        raise

    except sqlite3.Error:
        connection.rollback()
        logger.exception("Database error while saving prescription")
        raise HTTPException(
            status_code=500,
            detail="Database error while saving the prescription.",
        )

    except Exception:
        connection.rollback()
        logger.exception("Could not save prescription")
        raise HTTPException(
            status_code=500,
            detail="Could not save the prescription.",
        )

    finally:
        connection.close()


# ============================================================
# LIST ONLY THE CURRENT USER'S PRESCRIPTIONS
# ============================================================

@app.get("/api/prescriptions")
def list_prescriptions(
    current_user: dict = Depends(get_current_user),
):
    connection = get_connection()

    try:
        columns = get_columns(connection, "prescriptions")

        if "user_id" not in columns:
            raise HTTPException(
                status_code=500,
                detail="Prescription ownership migration has not completed.",
            )

        rows = connection.execute(
            """
            SELECT *
            FROM prescriptions
            WHERE user_id = ?
            ORDER BY rowid DESC
            """,
            (current_user["id"],),
        ).fetchall()

        return [dict(row) for row in rows]

    finally:
        connection.close()


# ============================================================
# GET A PRESCRIPTION ONLY IF IT BELONGS TO THE CURRENT USER
# ============================================================

@app.get("/api/prescriptions/{prescription_id}")
def get_prescription(
    prescription_id: str,
    current_user: dict = Depends(get_current_user),
):
    connection = get_connection()

    try:
        prescription, _ = require_owned_prescription(
            connection,
            prescription_id,
            current_user["id"],
        )

        medicine_columns = get_columns(connection, "medicines")

        reference_column = next(
            (
                column
                for column in (
                    "prescription_id",
                    "prescription",
                    "prescription_ref",
                )
                if column in medicine_columns
            ),
            None,
        )

        if reference_column is None:
            return {
                "prescription": prescription,
                "medicines": [],
            }

        reference_values = get_prescription_reference_values(
            prescription,
            prescription_id,
        )

        placeholders = ", ".join("?" for _ in reference_values)

        active_filter = (
            "AND is_active = 1"
            if "is_active" in medicine_columns
            else ""
        )

        medicines = connection.execute(
            f"""
            SELECT *
            FROM medicines
            WHERE "{reference_column}" IN ({placeholders})
            {active_filter}
            ORDER BY rowid ASC
            """,
            list(reference_values),
        ).fetchall()

        medicine_results = []

        for row in medicines:
            medicine = dict(row)
            medicine["name"] = (
                medicine.get("name")
                or medicine.get("medicine_name")
                or medicine.get("drug_name")
                or ""
            )
            medicine_results.append(medicine)

        return {
            "prescription": prescription,
            "medicines": medicine_results,
        }

    finally:
        connection.close()


# ============================================================
# SOFT-DELETE A MEDICINE ONLY IF ITS PRESCRIPTION IS OWNED
# ============================================================

@app.delete("/api/medicines/{medicine_id}")
def delete_medicine(
    medicine_id: int,
    current_user: dict = Depends(get_current_user),
):
    connection = get_connection()

    try:
        connection.execute("BEGIN")

        medicine_columns = get_columns(connection, "medicines")

        if "id" not in medicine_columns:
            raise HTTPException(
                status_code=500,
                detail="The medicines table has no recognized ID column.",
            )

        reference_column = next(
            (
                column
                for column in (
                    "prescription_id",
                    "prescription",
                    "prescription_ref",
                )
                if column in medicine_columns
            ),
            None,
        )

        if reference_column is None:
            raise HTTPException(
                status_code=500,
                detail="The medicines table has no recognized prescription reference.",
            )

        prescription_columns = get_columns(connection, "prescriptions")

        if "user_id" not in prescription_columns:
            raise HTTPException(
                status_code=500,
                detail="Prescription ownership migration has not completed.",
            )

        if "id" in prescription_columns:
            prescription_id_column = "id"
        elif "prescription_id" in prescription_columns:
            prescription_id_column = "prescription_id"
        else:
            raise HTTPException(
                status_code=500,
                detail="The prescriptions table has no recognized ID column.",
            )

        # A medicine is accessible only through a prescription owned by
        # the authenticated user. Unassigned legacy records do not match.
        query = f"""
            SELECT m.id, m.is_active
            FROM medicines AS m
            JOIN prescriptions AS p
              ON CAST(p."{prescription_id_column}" AS TEXT)
                 = CAST(m."{reference_column}" AS TEXT)
            WHERE m.id = ?
              AND p.user_id = ?
        """

        # Legacy schemas can use an alternate prescription reference.
        if (
            "prescription_id" in prescription_columns
            and prescription_id_column != "prescription_id"
        ):
            query = f"""
                SELECT m.id, m.is_active
                FROM medicines AS m
                JOIN prescriptions AS p
                  ON (
                    CAST(p."{prescription_id_column}" AS TEXT)
                      = CAST(m."{reference_column}" AS TEXT)
                    OR CAST(p."prescription_id" AS TEXT)
                      = CAST(m."{reference_column}" AS TEXT)
                  )
                WHERE m.id = ?
                  AND p.user_id = ?
            """

        medicine = connection.execute(
            query,
            (medicine_id, current_user["id"]),
        ).fetchone()

        if medicine is None:
            connection.rollback()
            raise HTTPException(
                status_code=404,
                detail="Medicine not found.",
            )

        if not medicine["is_active"]:
            connection.rollback()
            raise HTTPException(
                status_code=404,
                detail="This medicine has already been removed.",
            )

        connection.execute(
            "UPDATE medicines SET is_active = 0 WHERE id = ?",
            (medicine_id,),
        )

        connection.commit()

        return {
            "message": "Medicine removed successfully.",
            "medicine_id": medicine_id,
        }

    except HTTPException:
        if connection.in_transaction:
            connection.rollback()
        raise

    except sqlite3.Error:
        connection.rollback()
        logger.exception("Database error while removing medicine")
        raise HTTPException(
            status_code=500,
            detail="Database error while removing the medicine.",
        )

    finally:
        connection.close()


# ============================================================
# DELETE A PRESCRIPTION ONLY IF IT BELONGS TO THE CURRENT USER
# ============================================================

@app.delete("/api/prescriptions/{prescription_id}")
def delete_prescription(
    prescription_id: str,
    current_user: dict = Depends(get_current_user),
):
    connection = get_connection()

    try:
        connection.execute("BEGIN")

        prescription, id_column = require_owned_prescription(
            connection,
            prescription_id,
            current_user["id"],
        )

        medicine_columns = get_columns(connection, "medicines")

        reference_column = next(
            (
                column
                for column in (
                    "prescription_id",
                    "prescription",
                    "prescription_ref",
                )
                if column in medicine_columns
            ),
            None,
        )

        if reference_column:
            reference_values = get_prescription_reference_values(
                prescription,
                prescription_id,
            )

            for reference in reference_values:
                connection.execute(
                    f'DELETE FROM medicines WHERE "{reference_column}" = ?',
                    (reference,),
                )

        connection.execute(
            f'DELETE FROM prescriptions WHERE "{id_column}" = ? AND user_id = ?',
            (prescription_id, current_user["id"]),
        )

        connection.commit()

        return {"message": "Prescription deleted successfully."}

    except HTTPException:
        if connection.in_transaction:
            connection.rollback()
        raise

    except sqlite3.Error:
        connection.rollback()
        logger.exception("Database error while deleting prescription")
        raise HTTPException(
            status_code=500,
            detail="Database error while deleting the prescription.",
        )

    finally:
        connection.close()
