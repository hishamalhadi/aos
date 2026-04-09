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
import asyncio
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


# ── Phase 4 commands — profile / classify / tiers / correct ─────────


def _get_runner(db_path: str | None):
    """Lazy import to keep the extractor-only path free of Phase 4 deps."""
    from .runner import ClassifierRunner
    return ClassifierRunner(db_path=db_path)


def cmd_profile(args: argparse.Namespace) -> int:
    """Print a compiled PersonProfile for one person."""
    from .profiler import ProfileBuilder
    builder = ProfileBuilder(args.db)
    profile = builder.build(args.person_id)
    if profile is None:
        print(f"No profile for {args.person_id} (no stored signals)", file=sys.stderr)
        return 1

    _print_header(f"Profile for {args.person_id}")
    print(f"Name:             {profile.person_name or '(unknown)'}")
    print(f"Sources covered:  {', '.join(sorted(profile.source_coverage)) or '(none)'}")
    print(f"Extracted at:     {profile.extracted_at or '(unknown)'}")
    print()

    print("Aggregates:")
    print(f"  Messages:         {profile.total_messages}")
    print(f"  Calls:            {profile.total_calls}")
    print(f"  Photos:           {profile.total_photos}")
    print(f"  Emails:           {profile.total_emails}")
    print(f"  Mentions:         {profile.total_mentions}")
    print()

    print("Channel diversity:")
    print(f"  Active channels:  {', '.join(profile.channels_active) or 'none'}")
    print(f"  Channel count:    {profile.channel_count}")
    print(f"  Multi-channel:    {profile.is_multi_channel}")
    print()

    print("Temporal:")
    print(f"  First:            {profile.first_interaction_date or '(unknown)'}")
    print(f"  Last:             {profile.last_interaction_date or '(unknown)'}")
    print(f"  Days since last:  {profile.days_since_last if profile.days_since_last is not None else '(unknown)'}")
    print(f"  Span:             {profile.span_years} years")
    print(f"  Dominant pattern: {profile.dominant_pattern}")
    print()

    print("Density:")
    print(f"  Score:            {profile.density_score}")
    print(f"  Rank:             {profile.density_rank}")
    print()

    print("Metadata:")
    print(f"  Richness score:   {profile.metadata_richness}")
    print(f"  Has birthday:     {profile.has_birthday}")
    print(f"  Has address:      {profile.has_physical_address}")
    print(f"  Has related:      {profile.has_related_names}")
    print()

    if profile.circles:
        print("Circles:")
        for c in profile.circles[:10]:
            name = c.get("name", "?")
            ctype = c.get("type", "")
            conf = c.get("confidence", 0)
            print(f"  - {name} ({ctype}, conf={conf:.2f})")
    else:
        print("Circles: (none detected)")

    if args.json:
        from dataclasses import asdict
        print()
        print(json.dumps(asdict(profile), indent=2, default=str))

    return 0


def cmd_classify(args: argparse.Namespace) -> int:
    """Run the classification pipeline."""
    runner = _get_runner(args.db)

    adapter_names = None  # classify uses all adapters via the extractor upstream

    person_ids = None
    if args.person:
        person_ids = [args.person]

    print(
        f"Starting classification "
        f"(limit={args.limit or 'none'}, "
        f"with_llm={args.with_llm}, "
        f"budget=${args.budget:.2f}, "
        f"dry_run={args.dry_run})"
    )
    print()

    try:
        report = asyncio.run(
            runner.run(
                person_ids=person_ids,
                limit=args.limit,
                with_llm=args.with_llm,
                max_budget_usd=args.budget,
                dry_run=args.dry_run,
                llm_model=args.model,
            )
        )
    except Exception as e:
        logger.exception("classify run failed")
        print(f"Error: {e}", file=sys.stderr)
        return 2

    _print_header("Classification complete")
    print(f"Duration:            {report.duration_seconds}s")
    print(f"Persons profiled:    {report.persons_profiled}")
    print(f"Rule classifications: {report.rule_classifications}")
    if report.with_llm:
        print(f"LLM classifications:  {report.llm_classifications}")
        print(f"LLM errors:           {report.llm_errors}")
        print(f"Estimated spend:      ${report.estimated_cost_usd:.4f}")
        print(f"Budget cap:           ${report.budget_usd:.2f}")
    print(f"Persisted:           {report.persisted}")
    print(f"Mode:                {'dry-run' if report.dry_run else 'persisted'}")
    if report.aborted_reason:
        print(f"ABORTED:             {report.aborted_reason}")
    print()

    if report.tier_distribution:
        print(f"{'TIER':<22}{'COUNT':>10}")
        print(_hr())
        for tier in sorted(
            report.tier_distribution.keys(),
            key=lambda k: -report.tier_distribution[k],
        ):
            print(f"{tier:<22}{report.tier_distribution[tier]:>10}")
        print()

    if report.errors:
        print("Errors (first 10):")
        for e in report.errors[:10]:
            pid = e.get("person_id", "?")
            err = e.get("error", "?")
            print(f"  {pid}: {err}")
        if len(report.errors) > 10:
            print(f"  ... and {len(report.errors) - 10} more")
        print()

    if args.json:
        print(json.dumps(report.to_dict(), indent=2))

    return 0 if not report.aborted_reason else 1


def cmd_tiers(args: argparse.Namespace) -> int:
    """Print the tier distribution — aggregate counts only."""
    runner = _get_runner(args.db)
    dist = runner.tier_distribution()

    _print_header("Tier distribution")
    if not dist:
        print("(no classifications stored yet — run `classify` first)")
        return 0

    total = sum(dist.values())
    print(f"Total classifications: {total}")
    print()
    print(f"{'TIER':<22}{'COUNT':>8}{'%':>8}")
    print(_hr())
    for tier in sorted(dist.keys(), key=lambda k: -dist[k]):
        count = dist[tier]
        pct = _fmt_pct(count, total)
        print(f"{tier:<22}{count:>8}{pct:>8}")
    return 0


def cmd_correct(args: argparse.Namespace) -> int:
    """Record an operator correction for one person's classification."""
    from .taxonomy import Tier

    runner = _get_runner(args.db)

    new_tier: Tier | None = None
    if args.tier:
        new_tier = Tier.from_str(args.tier)
        if new_tier == Tier.UNKNOWN and args.tier.lower() != "unknown":
            print(
                f"Unknown tier: {args.tier}. Valid: "
                + ", ".join(t.value for t in Tier),
                file=sys.stderr,
            )
            return 2

    new_tags: list[dict] | None = None
    if args.tags:
        # "tag1,tag2,tag3" → each with confidence 1.0
        new_tags = [
            {"tag": t.strip(), "confidence": 1.0}
            for t in args.tags.split(",")
            if t.strip()
        ]

    if new_tier is None and new_tags is None:
        print("At least one of --tier or --tags must be provided", file=sys.stderr)
        return 2

    try:
        result = runner.record_correction(
            args.person_id,
            new_tier=new_tier,
            new_tags=new_tags,
            notes=args.notes or "",
        )
    except Exception as e:
        logger.exception("correction failed")
        print(f"Error: {e}", file=sys.stderr)
        return 2

    _print_header(f"Correction recorded for {args.person_id}")
    print(f"Tier:    {result.tier.value}")
    if result.context_tags:
        tags = ", ".join(
            f"{t['tag']}({t['confidence']:.2f})" for t in result.context_tags
        )
        print(f"Tags:    {tags}")
    else:
        print("Tags:    (none)")
    if args.notes:
        print(f"Notes:   {args.notes}")
    return 0


def cmd_show_classification(args: argparse.Namespace) -> int:
    """Print the current classification for one person."""
    runner = _get_runner(args.db)
    result = runner.get_classification(args.person_id)
    if result is None:
        print(
            f"No classification for {args.person_id} (run `classify` first)",
            file=sys.stderr,
        )
        return 1

    _print_header(f"Classification for {args.person_id}")
    print(f"Tier:     {result.tier.value}")
    print(f"Model:    {result.model or '(rule-only)'}")
    print(f"Run ID:   {result.run_id}")
    print(f"Created:  {result.created_at}")

    if result.context_tags:
        print("Tags:")
        for t in result.context_tags:
            print(f"  - {t['tag']} ({t['confidence']:.2f})")
    else:
        print("Tags: (none)")

    if result.reasoning:
        print(f"Reasoning: {result.reasoning}")

    if args.json:
        print()
        print(json.dumps(result.to_dict(), indent=2))
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

    # ── Phase 4 commands ──

    # profile <person_id>
    sp = sub.add_parser(
        "profile", help="Print compiled profile for one person (Phase 4)"
    )
    sp.add_argument("person_id", help="Person ID")
    sp.add_argument("--json", action="store_true", help="Print full profile as JSON")
    sp.set_defaults(func=cmd_profile)

    # classify
    sp = sub.add_parser(
        "classify",
        help="Run the classification pipeline (rule-based + optional LLM)",
    )
    sp.add_argument("--limit", type=int, default=None, help="Cap persons classified")
    sp.add_argument("--person", default=None, help="Classify only one person_id")
    sp.add_argument(
        "--with-llm",
        action="store_true",
        help="Enable LLM classifier for context tags (default: rule-only)",
    )
    sp.add_argument(
        "--budget",
        type=float,
        default=1.00,
        help="Soft USD budget cap for LLM runs (default: 1.00)",
    )
    sp.add_argument(
        "--model",
        default=None,
        help="Override LLM model (default: operator preferred execution model)",
    )
    sp.add_argument(
        "--dry-run",
        action="store_true",
        help="Compile profiles + prompts without LLM calls or persistence",
    )
    sp.add_argument("--json", action="store_true", help="Also print run report as JSON")
    sp.set_defaults(func=cmd_classify)

    # tiers
    sp = sub.add_parser("tiers", help="Aggregate tier distribution (no names)")
    sp.set_defaults(func=cmd_tiers)

    # correct <person_id>
    sp = sub.add_parser(
        "correct",
        help="Record an operator correction to a person's classification",
    )
    sp.add_argument("person_id", help="Person ID")
    sp.add_argument("--tier", default=None, help="Set the tier (core, active, ...)")
    sp.add_argument(
        "--tags",
        default=None,
        help="Comma-separated list of context tags (e.g. family_nuclear,close_friend)",
    )
    sp.add_argument("--notes", default="", help="Free-text notes")
    sp.set_defaults(func=cmd_correct)

    # classification <person_id> — show current classification
    sp = sub.add_parser(
        "classification",
        help="Print the current classification for one person",
    )
    sp.add_argument("person_id", help="Person ID")
    sp.add_argument("--json", action="store_true", help="Print full result as JSON")
    sp.set_defaults(func=cmd_show_classification)

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
