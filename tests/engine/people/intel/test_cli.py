"""Tests for the People Intelligence CLI.

Mocks the SignalExtractor so we don't touch real people.db during tests.
Focused on command dispatch, argparse wiring, and exit codes — not the
exact text format of the output.
"""
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from core.engine.people.intel.cli import build_parser, main
from core.engine.people.intel.extractor import RunReport
from core.engine.people.intel.types import (
    CommunicationSignal,
    PersonSignals,
    VoiceSignal,
)


# ── Parser tests ──────────────────────────────────────────────────────


def test_parser_requires_command():
    parser = build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args([])


def test_parser_coverage():
    parser = build_parser()
    args = parser.parse_args(["coverage"])
    assert args.command == "coverage"


def test_parser_extract_flags():
    parser = build_parser()
    args = parser.parse_args(
        ["extract", "--limit", "5", "--adapters", "apple_messages,whatsapp", "--dry-run"]
    )
    assert args.command == "extract"
    assert args.limit == 5
    assert args.adapters == "apple_messages,whatsapp"
    assert args.dry_run is True


def test_parser_show_requires_person_id():
    parser = build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["show"])


def test_parser_show_accepts_person_id():
    parser = build_parser()
    args = parser.parse_args(["show", "p_abc"])
    assert args.person_id == "p_abc"


# ── Command tests (with mocked extractor) ────────────────────────────


def _fake_coverage_report():
    return {
        "available_count": 2,
        "total_count": 3,
        "coverage_pct": 0.67,
        "signal_types_covered": ["communication", "voice"],
        "signal_types_missing": ["mention"],
        "available": [
            {
                "name": "adapter_a",
                "display_name": "Adapter A",
                "platform": "macos",
                "signal_types": ["communication"],
                "description": "",
                "available": True,
            },
            {
                "name": "adapter_b",
                "display_name": "Adapter B",
                "platform": "any",
                "signal_types": ["voice"],
                "description": "",
                "available": True,
            },
        ],
        "unavailable": [
            {
                "name": "adapter_c",
                "display_name": "Adapter C",
                "platform": "macos",
                "signal_types": ["mention"],
                "description": "",
                "available": False,
            }
        ],
    }


def test_coverage_command(capsys):
    with patch("core.engine.people.intel.cli.SignalExtractor") as Extractor:
        Extractor.return_value.coverage_report.return_value = _fake_coverage_report()
        rc = main(["coverage"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "adapter coverage" in out
    assert "adapter_a" in out
    assert "adapter_b" in out
    assert "adapter_c" in out


def test_list_adapters_json_output(capsys):
    with patch("core.engine.people.intel.cli.SignalExtractor") as Extractor:
        Extractor.return_value.coverage_report.return_value = _fake_coverage_report()
        rc = main(["list-adapters"])
    assert rc == 0
    out = capsys.readouterr().out.strip()
    data = json.loads(out)
    assert isinstance(data, list)
    assert any(a["name"] == "adapter_a" for a in data)
    assert any(a["name"] == "adapter_c" and a["available"] is False for a in data)


def test_extract_command_success(capsys):
    report = RunReport(
        persons_indexed=5,
        persons_extracted=4,
        sources_used=["adapter_a", "adapter_b"],
        sources_skipped=["adapter_c"],
        per_source_persons={"adapter_a": 3, "adapter_b": 4},
        duration_seconds=1.23,
        errors=[],
        dry_run=True,
    )
    with patch("core.engine.people.intel.cli.SignalExtractor") as Extractor:
        Extractor.return_value.run.return_value = report
        rc = main(["extract", "--limit", "5", "--dry-run"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "Extraction complete" in out
    assert "5" in out
    assert "adapter_a" in out


def test_extract_command_passes_args_to_run():
    report = RunReport(persons_indexed=0, persons_extracted=0)
    with patch("core.engine.people.intel.cli.SignalExtractor") as Extractor:
        Extractor.return_value.run.return_value = report
        main(
            [
                "extract",
                "--limit",
                "10",
                "--adapters",
                "a,b",
                "--dry-run",
                "--person",
                "p_xyz",
            ]
        )
        Extractor.return_value.run.assert_called_once_with(
            person_ids=["p_xyz"],
            limit=10,
            adapter_names=["a", "b"],
            dry_run=True,
        )


def test_extract_command_returns_error_when_all_failed(capsys):
    report = RunReport(
        persons_indexed=1,
        persons_extracted=0,
        sources_used=[],
        sources_skipped=[],
        errors=[{"adapter": "adapter_a", "error": "boom"}],
        dry_run=False,
    )
    with patch("core.engine.people.intel.cli.SignalExtractor") as Extractor:
        Extractor.return_value.run.return_value = report
        rc = main(["extract"])
    assert rc == 1
    out = capsys.readouterr().out
    assert "Errors" in out
    assert "boom" in out


def test_extract_json_flag_emits_json(capsys):
    report = RunReport(persons_indexed=0, persons_extracted=0)
    with patch("core.engine.people.intel.cli.SignalExtractor") as Extractor:
        Extractor.return_value.run.return_value = report
        main(["extract", "--json"])
    out = capsys.readouterr().out
    # The JSON block is emitted as a pretty-printed multiline object at the
    # end. Find the first line that is exactly "{" and parse from there.
    lines = out.splitlines()
    start = None
    for i, line in enumerate(lines):
        if line.strip() == "{":
            start = i
            break
    assert start is not None, f"No JSON block found in output:\n{out}"
    json_text = "\n".join(lines[start:])
    parsed = json.loads(json_text)
    assert "persons_indexed" in parsed


def test_stats_command(capsys):
    with patch("core.engine.people.intel.cli.SignalExtractor") as Extractor:
        Extractor.return_value.stats.return_value = {
            "total_rows": 42,
            "distinct_persons": 15,
            "by_source": {"adapter_a": 30, "adapter_b": 12},
        }
        rc = main(["stats"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "Signal store" in out
    assert "42" in out
    assert "adapter_a" in out


def test_stats_command_empty(capsys):
    with patch("core.engine.people.intel.cli.SignalExtractor") as Extractor:
        Extractor.return_value.stats.return_value = {
            "total_rows": 0,
            "distinct_persons": 0,
            "by_source": {},
        }
        rc = main(["stats"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "no signals stored" in out


def test_show_command_success(capsys):
    ps = PersonSignals(
        person_id="p_test",
        person_name="Fake Person",
        source_coverage=["adapter_a"],
    )
    ps.communication.append(
        CommunicationSignal(source="adapter_a", channel="test", total_messages=10)
    )
    ps.voice.append(VoiceSignal(source="adapter_a", total_calls=3))

    with patch("core.engine.people.intel.cli.SignalExtractor") as Extractor:
        Extractor.return_value.get_person_signals.return_value = ps
        rc = main(["show", "p_test"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "p_test" in out
    assert "Fake Person" in out
    assert "Messages:" in out


def test_show_command_not_found(capsys):
    with patch("core.engine.people.intel.cli.SignalExtractor") as Extractor:
        Extractor.return_value.get_person_signals.return_value = None
        rc = main(["show", "p_missing"])
    assert rc == 1
    err = capsys.readouterr().err
    assert "No signals" in err


def test_show_json_flag_prints_full_signals(capsys):
    ps = PersonSignals(person_id="p_test", person_name="Fake")
    ps.communication.append(
        CommunicationSignal(source="a", channel="test", total_messages=1)
    )
    with patch("core.engine.people.intel.cli.SignalExtractor") as Extractor:
        Extractor.return_value.get_person_signals.return_value = ps
        main(["show", "p_test", "--json"])
    out = capsys.readouterr().out
    # Should contain a JSON object
    assert "{" in out
    assert "person_id" in out


def test_main_handles_unknown_command():
    with pytest.raises(SystemExit):
        main(["bogus"])


def test_main_unhandled_exception_returns_2(capsys):
    with patch("core.engine.people.intel.cli.SignalExtractor") as Extractor:
        Extractor.side_effect = RuntimeError("simulated")
        rc = main(["coverage"])
    assert rc == 2
    err = capsys.readouterr().err
    assert "Error" in err
