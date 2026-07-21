import sqlite3
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.enrich_official_websites import canonicalize_url, clean_text, extract_page, validate_public_target, website_sources


def test_url_normalization_rejects_credentials_and_private_targets():
    assert canonicalize_url("example.com/services#contact") == "https://example.com/services"
    with pytest.raises(ValueError, match="userinfo_forbidden"):
        canonicalize_url("https://user:secret@example.com")
    with pytest.raises(ValueError, match="non_public_target"):
        validate_public_target("http://127.0.0.1/")


def test_extracts_only_explicit_descriptions_services_and_social_links():
    html = b"""
      <html lang="fr"><head>
        <title>Entreprise exemple</title>
        <meta name="description" content="Description publiee par le site.">
        <script type="application/ld+json">{
          "@context":"https://schema.org", "@type":"Organization",
          "description":"Description structuree de l'entreprise.",
          "sameAs":["https://www.instagram.com/exemple"],
          "hasOfferCatalog":{"@type":"OfferCatalog","itemListElement":[
            {"@type":"Service","name":"Audit energetique"}
          ]}
        }</script>
      </head><body><section id="nos-services"><h2>Installation solaire</h2></section></body></html>
    """
    result = extract_page(html, "https://example.com/", {})
    assert result["description"] == "Description structuree de l'entreprise."
    assert result["description_source"] == "jsonld"
    assert "Audit energetique" in result["services_json"]
    assert "Installation solaire" in result["services_json"]
    assert "instagram" in result["social_json"]


def test_meta_robots_restriction_discards_reusable_content():
    html = b"""
      <html><head><meta name="robots" content="noindex,nosnippet">
      <meta name="description" content="Ne pas reutiliser."></head>
      <body><section class="services"><h2>Service prive</h2></section></body></html>
    """
    result = extract_page(html, "https://example.com/", {})
    assert result["meta_robots_restricted"] == 1
    assert result["description"] is None
    assert result["services_json"] == "[]"


def test_css_and_generic_titles_are_not_descriptions():
    html = b"""
      <html><head><title>Accueil | Exemple</title>
      <meta name="description" content=".hero { display: block; font-size: 48px; font-weight: bold; color: red; }">
      <meta property="og:description" content="Accueil | Exemple"></head><body></body></html>
    """
    result = extract_page(html, "https://example.com/", {})
    assert result["description"] is None


def test_text_is_unescaped_and_truncated_at_a_word_boundary():
    assert clean_text("Vente d&#039;occasion") == "Vente d'occasion"
    value = clean_text("mot " * 200, 40)
    assert value.endswith("…")
    assert len(value) <= 40


def test_descriptions_are_limited_to_25_words():
    html = f'<html><head><meta name="description" content="{"mot " * 40}"></head></html>'.encode()
    result = extract_page(html, "https://example.com/", {})
    assert len(result["description"].removesuffix("…").split()) == 25


def test_editorial_posts_are_not_treated_as_services():
    html = b"""
      <html><body><article class="post category-activites">
        <h2>Spectacle de fin d'annee</h2>
      </article><section class="expertises"><h2>Audit energetique</h2></section></body></html>
    """
    result = extract_page(html, "https://example.com/", {})
    assert "Audit energetique" in result["services_json"]
    assert "Spectacle" not in result["services_json"]


def test_website_sources_include_only_authorized_rna_urls_with_provenance(tmp_path):
    osm_path = tmp_path / "osm.sqlite"
    osm = sqlite3.connect(osm_path)
    osm.executescript("""
      CREATE TABLE osm_business_profiles (
        siren TEXT, siret TEXT, name TEXT, website TEXT, source_reference_date TEXT
      );
      INSERT INTO osm_business_profiles VALUES ('123456789', '12345678900010', 'Entreprise OSM', 'https://osm.example', '2026-07-18');
    """)
    osm.commit()
    osm.close()

    rna_path = tmp_path / "rna.sqlite"
    rna = sqlite3.connect(rna_path)
    rna.executescript("""
      CREATE TABLE association_profiles (
        siren TEXT, siret TEXT, title TEXT, website TEXT,
        website_publication_authorized INTEGER, source_reference_date TEXT
      );
      INSERT INTO association_profiles VALUES ('987654321', '98765432100011', 'Association autorisée', 'https://rna.example', 1, '2026-07-01');
      INSERT INTO association_profiles VALUES ('111111111', '', 'Association non autorisée', 'https://private.example', 0, '2026-07-01');
    """)
    rna.commit()
    rna.close()

    sources = website_sources(osm_path, rna_path)
    assert {(row["siren"], row["source_origin"]) for row in sources} == {
        ("123456789", "OpenStreetMap"),
        ("987654321", "RNA · publication autorisée"),
    }
