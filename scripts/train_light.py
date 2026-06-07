from __future__ import annotations

import json
from pathlib import Path


def main() -> None:
    output_dir = Path("model-artifacts")
    output_dir.mkdir(exist_ok=True)
    artifact = output_dir / "lightweight-demo.json"
    artifact.write_text(
        json.dumps(
            {
                "name": "lightweight-demo",
                "version": "0.1.0",
                "features": ["source_credibility", "direction_terms", "recency_days"],
                "metrics": {"calibration": None, "notes": "Cold-start placeholder artifact."},
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print(f"Trained lightweight artifact: {artifact}")


if __name__ == "__main__":
    main()
