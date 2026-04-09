"""People Intelligence CLI.

Invoke via ``python3 -m core.engine.people.intel.cli <command>``.

Commands:

    coverage                     Show which adapters are registered + available
    extract [options]            Run extraction and persist to signal_store
    stats                        Signal store row counts
    show <person_id>             Print stored signals for one person
    list-adapters                List registered adapters

The CLI uses stdlib only (argparse) so it runs from system Python without
venv activation — important for AOS 4am update cycle and troubleshooting
sessions.

Privacy note: output is intentionally aggregate-first. The ``show``
command prints per-person signal details on request, but ``extract`` and
``coverage`` never dump raw names or message content.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from .extractor import SignalExtractor

logger = logging.getLogger(__name__)


# ── Formatting helpers (plain text, no deps) ────────────────────────

def _fmt_pct(n: int, total: int) -> str:
    if total == 0:
        return "0%"
    return f"{round(100 * n / total)}%"


def _hr(char: str = "─", width: int = 60) -> str:
    return char * width


def _print_header(text: str) -> None:
    print(text)
    print(_hr())


# ── Commands ─────────────────────────────────────────────────────────

def cmd_coverage(args: argparse.Namespace) -> int:
    """Print adapter registration + availability."""
    ex = SignalExtractor(db_path=args.db)
    report = ex.coverage_report()

    _print_header("People Intelligence — adapter coverage")
    print(f"Registered: {report['total_count']}")
    print(f"Available:  {report['available_count']}")
    print(f"Coverage:   {_fmt_pct(report['available_count'], report['total_count'])}")
    print()

    print("Signal types covered:")
    for st in sorted(report["signal_types_covered"]):
        print(f"  ✓ {st}")
    if report["signal_types_missing"]:
        print("Signal types missing:")
        for st in sorted(report["signal_types_missing"]):
            print(f"  ✗ {st}")
    print()

    print(f"{'ADAPTER':<22}{'PLATFORM':<10}{'AVAILABLE':<12}SIGNALS")
    print(_hr())
    for detail in sorted(
        report["available"] + report["unavailable"], key=lambda d: d["name"]
    ):
        mark = "yes" if detail["available"] else "no"
        signals = ",".join(detail["signal_types"])
        print(f"{detail['name']:<22}{detail['platform']:<10}{mark:<12}{signals}")

    return 0


def cmd_list_adapters(args: argparse.Namespace) -> int:
    """Print registered adapters as JSON (machine-readable)."""
    ex = SignalExtractor(db_path=args.db)
    report = ex.coverage_report()
    items = []
    for d in report["available"] + report["unavailable"]:
        items.append(
            {
                "name": d["name"],
                "display_name": d.get("display_name", d["name"]),
                "available": d["available"],
                "platform": d["platform"],
                "signal_types": d["signal_types"],
            }
        )
    print(json.dumps(items, indent=2))
    return 0


def cmd_extract(args: argparse.Namespace) -> int:
    """Run signal extraction."""
    ex = SignalExtractor(db_path=args.db)

    adapter_names = None
    if args.adapters:
        adapter_names = [a.strip() for a in args.adapters.split(",") if a.strip()]

    person_ids = None
    if args.person:
        person_ids = [args.person]

    print(
        "Starting extraction "
        f"(limit={args.limit or 'none'}, "
        f"adapters={adapter_names or 'all'}, "
        f"dry_run={args.dry_run})"
    )
    print()

    report = ex.run(
        person_ids=person_ids,
        limit=args.limit,
        adapter_names=adapter_names,
        dry_run=args.dry_run,
    )

    _print_header("Extraction complete")
    print(f"Duration:          {report.duration_seconds}s")
    print(f"Persons indexed:   {report.persons_indexed}")
    print(f"Persons extracted: {report.persons_extracted} "
          f"({_fmt_pct(report.persons_extracted, report.persons_indexed)})")
    print(f"Sources used:      {len(report.sources_used)}")
    print(f"Sources skipped:   {len(report.sources_skipped)}")
    print(f"Errors:            {len(report.errors)}")
    print(f"Mode:              {'dry-run' if report.dry_run else 'persisted'}")
    print()

    if report.per_source_persons:
        print(f"{'SOURCE':<22}{'PERSONS':>10}")
        print(_hr())
        for src in sorted(
            report.per_source_persons.keys(),
            key=lambda k: -report.per_source_persons[k],
        ):
            count = report.per_source_persons[src]
            print(f"{src:<22}{count:>10}")
        print()

    if report.errors:
        print("Errors:")
        for e in report.errors:
            adapter = e.get("adapter", "?")
            err = e.get("error", "?")
            pid = e.get("person_id")
            if pid:
                print(f"  [{adapter}] {pid}: {err}")
            else:
                print(f"  [{adapter}] {err}")
        print()

    if args.json:
        print(json.dumps(report.to_dict(), indent=2))

    return 1 if report.errors and not report.sources_used else 0


def cmd_stats(args: argparse.Namespace) -> int:
    """Print signal store row counts."""
    ex = SignalExtractor(db_path=args.db)
    s = ex.stats()

    _print_header("Signal store — row counts")
    print(f"Total rows:        {s.get('total_rows', 0)}")
    print(f"Distinct persons:  {s.get('distinct_persons', 0)}")
    print()

    by_source = s.get("by_source") or {}
    if by_source:
        print(f"{'SOURCE':<22}{'ROWS':>10}")
        print(_hr())
        for src in sorted(by_source.keys(), key=lambda k: -by_source[k]):
            print(f"{src:<22}{by_source[src]:>10}")
    else:
        print("(no signals stored yet — run `extract` first)")

    return 0


def cmd_show(args: argparse.Namespace) -> int:
    """Print stored signals for one person."""
    ex = SignalExtractor(db_path=args.db)
    signals = ex.get_person_signals(args.person_id)
    if signals is None:
        print(f"No signals found for {args.person_id}", file=sys.stderr)
        return 1

    _print_header(f"Signals for {args.person_id}")
    print(f"Name:           {signals.person_name or '(unknown)'}")
    print(f"Sources:        {', '.join(sorted(signals.source_coverage)) or '(none)'}")
    print(f"Extracted at:   {signals.extracted_at or '(unknown)'}")
    print()

    print("Aggregates:")
    print(f"  Messages:       {signals.total_messages}")
    print(f"  Calls:          {signals.total_calls}")
    print(f"  Photos:         {signals.total_photos}")
    print(f"  Emails:         {signals.total_emails}")
    print(f"  Active channels: {signals.channel_count} "
          f"({', '.join(signals.channels_active) or 'none'})")
    print()

    print("Signal breakdown by type:")
    print(f"  communication:       {len(signals.communication)}")
    print(f"  voice:               {len(signals.voice)}")
    print(f"  physical_presence:   {len(signals.physical_presence)}")
    print(f"  professional:        {len(signals.professional)}")
    print(f"  group_membership:    {len(signals.group_membership)}")
    print(f"  mentions:            {len(signals.mentions)}")
    print(f"  metadata:            {len(signals.metadata)}")

    if args.json:
        from dataclasses import asdict
        print()
        print(json.dumps(asdict(signals), indent=2, default=str))

    return 0


# ── Parser ───────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python3 -m core.engine.people.intel.cli",
        description="People Intelligence — extract typed signals from local sources",
    )
    parser.add_argument(
        "--db",
        help="Override people.db path (defaults to ~/.aos/data/people.db)",
        default=None,
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose logging")

    sub = parser.add_subparsers(dest="command", required=True)

    # coverage
    sp = sub.add_parser("coverage", help="Show adapter registration + availability")
    sp.set_defaults(func=cmd_coverage)

    # list-adapters (machine-readable)
    sp = sub.add_parser("list-adapters", help="List registered adapters as JSON")
    sp.set_defaults(func=cmd_list_adapters)

    # extract
    sp = sub.add_parser("extract", help="Run signal extraction")
    sp.add_argument("--limit", type=int, default=None, help="Cap persons extracted")
    sp.add_argument("--person", default=None, help="Extract only for a single person_id")
    sp.add_argument(
        "--adapters",
        default=None,
        help="Comma-separated list of adapter names to run (default: all available)",
    )
    sp.add_argument(
        "--dry-run",
        action="store_true",
        help="Run extraction but do not persist to signal_store",
    )
    sp.add_argument(
        "--json",
        action="store_true",
        help="Also print the full run report as JSON",
    )
    sp.set_defaults(func=cmd_extract)

    # stats
    sp = sub.add_parser("stats", help="Signal store row counts")
    sp.set_defaults(func=cmd_stats)

    # show <person_id>
    sp = sub.add_parser("show", help="Print stored signals for one person")
    sp.add_argument("person_id", help="Person ID (e.g. p_xyz123)")
    sp.add_argument("--json", action="store_true", help="Print full signals as JSON")
    sp.set_defaults(func=cmd_show)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    try:
        return int(args.func(args) or 0)
    except KeyboardInterrupt:
        print("\nAborted.", file=sys.stderr)
        return 130
    except Exception as e:
        logger.exception("Unhandled error")
        print(f"Error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
