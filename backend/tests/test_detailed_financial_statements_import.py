import json
import sqlite3

import duckdb
import scripts.import_detailed_financial_statements as importer

from scripts.import_detailed_financial_statements import (
    build_index,
    derive_metrics,
    download_source_resource,
    normalized_cells,
    parse_subset,
)


def metadata():
    return {
        "source_updated_at": "2026-02-10T09:26:01+00:00",
        "dataset_url": "https://www.data.gouv.fr/datasets/donnees-financieres-detaillees-des-entreprises-format-parquet",
        "resource_url": "https://static.data.gouv.fr/resources/test/export-detail-bilan.parquet",
        "license_name": "Licence Ouverte 2.0",
        "license_url": "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
        "resource_id": "resource-test",
        "resource_last_modified": "2026-02-10T09:26:01+00:00",
        "resource_size": 12,
    }


def test_normalized_cells_excludes_invalid_values_and_person_fields():
    cells = normalized_cells({"EE": 1000, "FL": "2000", "bad key": 3, "email": "a@b.fr", "XX": float("nan"), "SAT": 2147483647, "MIN": -2147483648})
    assert cells == {"EE": 1000, "FL": 2000}


def test_complete_statement_metrics_follow_dgfip_cells():
    metrics = derive_metrics("C", {
        "EE": 6237507, "DL": 2489037, "DR": 299196, "DU": 177000, "DV": 556225,
        "EC": 3449274, "BJ": 9321572, "BK": 7474877, "CJ": 6436511, "CK": 2045699,
        "BL": 100000, "BM": 10000, "BX": 4859355, "BY": 300000, "CD": 10000,
        "CE": 500, "CF": 500000, "CG": 5000, "DX": 1684404, "DY": 684556,
        "DA": 1000000, "FL": 16710965, "GG": 484376, "GW": 458000, "HN": 415919,
        "FY": 2300000, "FZ": 980000, "FW": 4500000, "FX": 220000,
    })
    assert metrics["balance_sheet_total"] == 6237507
    assert metrics["equity"] == 2489037
    assert metrics["financial_debt"] == 733225
    assert metrics["fixed_assets_net"] == 1846695
    assert metrics["trade_receivables_net"] == 4559355
    assert metrics["cash_and_securities_net"] == 504500
    assert metrics["personnel_costs"] == 3280000


def test_simplified_statement_metrics_follow_2033_a_cells():
    metrics = derive_metrics("S", {
        "180": 500000, "142": 180000, "154": 10000, "156": 120000, "176": 310000,
        "044": 300000, "048": 90000, "096": 290000, "098": 0, "050": 30000,
        "052": 2000, "060": 20000, "062": 1000, "068": 120000, "070": 10000,
        "080": 5000, "082": 0, "084": 85000, "086": 0, "166": 70000, "172": 50000,
        "120": 10000, "210": 800000, "214": 200000, "218": 50000, "270": 90000,
        "280": 10000, "294": 5000, "310": 72000, "250": 240000, "252": 90000,
        "242": 210000, "244": 16000,
    })
    assert metrics["revenue"] == 1050000
    assert metrics["current_pre_tax_result"] == 95000
    assert metrics["fixed_assets_net"] == 210000
    assert metrics["inventory_net"] == 47000
    assert metrics["cash_and_securities_net"] == 90000


def test_parquet_parser_and_atomic_index_keep_raw_cells_without_personal_columns(tmp_path):
    parquet = tmp_path / "subset.parquet"
    connection = duckdb.connect()
    connection.execute("""CREATE TABLE sample AS SELECT
      '123456789'::VARCHAR AS siren, DATE '2024-12-31' AS date_cloture_exercice,
      'C'::VARCHAR AS type_bilan, 'Public'::VARCHAR AS confidentiality,
      MAP(['EE','DL','FL','HN'], [500000,200000,900000,60000]) AS liasse""")
    parquet_sql = str(parquet).replace("'", "''")
    connection.execute(f"COPY sample TO '{parquet_sql}' (FORMAT PARQUET)")
    connection.close()
    statements, parse_stats = parse_subset(parquet, metadata()["source_updated_at"])
    assert len(statements) == 1
    assert json.loads(statements[0]["liasse_json"])["EE"] == 500000
    output = tmp_path / "details.sqlite"
    report = build_index(output, statements, metadata(), {"extract": {}, "parse": parse_stats})
    db = sqlite3.connect(output)
    columns = {row[1] for row in db.execute("PRAGMA table_info(detailed_financial_statements)")}
    assert db.execute("SELECT COUNT(*) FROM detailed_financial_metric_definitions").fetchone()[0] == 24
    db.close()
    assert report["contains_personal_data"] is False
    assert not {"name", "director", "email", "phone", "address"} & columns


def test_segmented_download_validates_ranges_assembles_and_reuses_cache(tmp_path, monkeypatch):
    payload = b"PAR1xxxxPAR1"
    calls = []

    class Response:
        def __init__(self, start, end):
            self.status_code = 206
            self.headers = {"Content-Range": f"bytes {start}-{end}/{len(payload)}"}
            self.body = payload[start:end + 1]

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def raise_for_status(self):
            return None

        def iter_content(self, _chunk_size):
            yield self.body

    class Session:
        def __init__(self):
            self.headers = {}

        def get(self, _url, *, headers, stream, timeout):
            assert stream is True
            assert timeout == (30, 180)
            start, end = (int(value) for value in headers["Range"].removeprefix("bytes=").split("-"))
            calls.append((start, end))
            return Response(start, end)

        def close(self):
            return None

    monkeypatch.setattr(importer.requests, "Session", Session)
    path, stats = download_source_resource(metadata(), tmp_path, refresh=False)
    assert path.read_bytes() == payload
    assert stats["downloaded"] is True
    assert sorted(calls) == [(index, index) for index in range(len(payload))]
    calls.clear()
    cached_path, cached_stats = download_source_resource(metadata(), tmp_path, refresh=False)
    assert cached_path == path
    assert cached_stats["downloaded"] is False
    assert calls == []
