from enum import Enum
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class VerificationStatus(str, Enum):
    unverified = "unverified"
    auto_verified = "auto_verified"
    claimed = "claimed"
    admin_verified = "admin_verified"


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True)
    siren: Mapped[str] = mapped_column(String(9), unique=True, index=True)
    raison_sociale: Mapped[str] = mapped_column(String(255), index=True)
    nom_commercial: Mapped[str | None] = mapped_column(String(255))
    forme_juridique: Mapped[str | None] = mapped_column(String(255))
    date_creation: Mapped[Date | None]
    statut: Mapped[str] = mapped_column(String(32), default="active")
    categorie_entreprise: Mapped[str | None] = mapped_column(String(64))
    tranche_effectif: Mapped[str | None] = mapped_column(String(64))
    site_web: Mapped[str | None] = mapped_column(String(512))
    email_public: Mapped[str | None] = mapped_column(String(255))
    telephone_public: Mapped[str | None] = mapped_column(String(64))
    description_courte: Mapped[str | None] = mapped_column(Text)
    description_longue: Mapped[str | None] = mapped_column(Text)
    description_source: Mapped[str | None] = mapped_column(String(80))
    description_confidence: Mapped[float] = mapped_column(Float, default=0)
    logo_url: Mapped[str | None] = mapped_column(String(512))
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    claimed_at: Mapped[DateTime | None]
    created_at: Mapped[DateTime] = mapped_column(server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(server_default=func.now(), onupdate=func.now())

    establishments: Mapped[list["Establishment"]] = relationship(back_populates="company")


class Establishment(Base):
    __tablename__ = "establishments"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    siret: Mapped[str] = mapped_column(String(14), unique=True, index=True)
    is_head_office: Mapped[bool] = mapped_column(Boolean, default=False)
    enseigne: Mapped[str | None] = mapped_column(String(255))
    code_naf: Mapped[str | None] = mapped_column(String(8), index=True)
    libelle_naf: Mapped[str | None] = mapped_column(String(255))
    secteur_normalise: Mapped[str | None] = mapped_column(String(120), index=True)
    adresse_complete: Mapped[str | None] = mapped_column(Text)
    numero_voie: Mapped[str | None] = mapped_column(String(32))
    type_voie: Mapped[str | None] = mapped_column(String(64))
    nom_voie: Mapped[str | None] = mapped_column(String(255))
    complement_adresse: Mapped[str | None] = mapped_column(String(255))
    code_postal: Mapped[str | None] = mapped_column(String(12), index=True)
    commune: Mapped[str | None] = mapped_column(String(120), index=True)
    code_commune: Mapped[str | None] = mapped_column(String(10), index=True)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    geocoding_precision: Mapped[str | None] = mapped_column(String(64))
    geocoding_source: Mapped[str | None] = mapped_column(String(80))
    statut: Mapped[str] = mapped_column(String(32), default="active")
    date_creation: Mapped[Date | None]
    opening_hours: Mapped[str | None] = mapped_column(Text)
    accessibility_info: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[DateTime] = mapped_column(server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(server_default=func.now(), onupdate=func.now())

    company: Mapped[Company] = relationship(back_populates="establishments")


class DataImportRun(Base):
    __tablename__ = "data_import_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(120), index=True)
    source_version: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(32), index=True)
    rows_read: Mapped[int] = mapped_column(Integer, default=0)
    rows_created: Mapped[int] = mapped_column(Integer, default=0)
    rows_updated: Mapped[int] = mapped_column(Integer, default=0)
    rows_skipped: Mapped[int] = mapped_column(Integer, default=0)
    errors_count: Mapped[int] = mapped_column(Integer, default=0)
    logs: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[DateTime] = mapped_column(server_default=func.now())
    finished_at: Mapped[DateTime | None]
