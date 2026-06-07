from __future__ import annotations

import json
from pathlib import Path


def main() -> None:
    output_dir = Path("model-artifacts")
    output_dir.mkdir(exist_ok=True)
    output = output_dir / "training-sources.json"
    output.write_text(
        json.dumps(
            {
                "sources": [
                    "FEVER",
                    "SciFact",
                    "Metaculus",
                    "Polymarket",
                    "Manifold",
                    "GDELT",
                    "GH Archive",
                    "Hugging Face Hub",
                ],
                "samples": [],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print(f"Prepared training manifest: {output}")


if __name__ == "__main__":
    main()
