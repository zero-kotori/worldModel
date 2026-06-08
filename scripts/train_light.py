from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from pathlib import Path


TOKEN_PATTERN = re.compile(r"[a-z0-9\u4e00-\u9fa5]+", re.IGNORECASE)


def tokens(value: str) -> set[str]:
    return {token.lower() for token in TOKEN_PATTERN.findall(value) if len(token) >= 2}


def load_samples(path: Path) -> list[dict]:
    if not path.exists():
        return []
    samples = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            samples.append(json.loads(line))
    return samples


def evidence_text(sample: dict) -> str:
    if sample.get("evidence"):
        return str(sample.get("evidence", ""))
    return f"{sample.get('evidenceTitle', '')} {sample.get('evidenceContent', '')}"


def claim_text(sample: dict) -> str:
    return str(sample.get("claim") or sample.get("hypothesis") or "")


def predict_log_lr(sample: dict, token_weights: dict[str, float], bias: float) -> float:
    evidence_tokens = tokens(evidence_text(sample))
    hypothesis_tokens = tokens(claim_text(sample))
    overlap = evidence_tokens.intersection(hypothesis_tokens)
    if not overlap:
        return bias
    return bias + sum(token_weights.get(token, 0.0) for token in overlap) / len(overlap)


def main() -> None:
    output_dir = Path("model-artifacts")
    output_dir.mkdir(exist_ok=True)
    samples_path = output_dir / "training-samples.jsonl"
    samples = load_samples(samples_path)
    artifact = output_dir / "lightweight-local.json"

    if not samples:
        artifact.write_text(
            json.dumps(
                {
                    "name": "lightweight-local",
                    "kind": "LIGHTWEIGHT",
                    "version": "0.1.0",
                    "trained": False,
                    "reason": "No confirmed evidence links were available in model-artifacts/training-samples.jsonl.",
                    "features": ["token_overlap", "source_credibility", "relevance", "confidence"],
                    "metrics": {"sampleCount": 0},
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"Wrote insufficient-data artifact: {artifact}")
        return

    weighted_targets: list[tuple[float, float]] = []
    token_totals: dict[str, float] = defaultdict(float)
    token_weights_denominator: dict[str, float] = defaultdict(float)

    for sample in samples:
        likelihood_ratio = max(float(sample.get("likelihoodRatio", 1.0)), 1e-9)
        target = math.log(likelihood_ratio)
        sample_weight = (
            float(sample.get("credibility", 0.7))
            * float(sample.get("relevance", 0.5))
            * float(sample.get("confidence", 0.5))
        )
        weighted_targets.append((target, sample_weight))
        evidence_tokens = tokens(evidence_text(sample))
        hypothesis_tokens = tokens(claim_text(sample))
        for token in evidence_tokens.intersection(hypothesis_tokens):
            token_totals[token] += target * sample_weight
            token_weights_denominator[token] += sample_weight

    denominator = sum(weight for _, weight in weighted_targets) or 1.0
    bias = sum(target * weight for target, weight in weighted_targets) / denominator
    token_weights = {
        token: token_totals[token] / token_weights_denominator[token]
        for token in token_totals
        if token_weights_denominator[token] > 0
    }
    absolute_errors = [
        abs(math.log(max(float(sample.get("likelihoodRatio", 1.0)), 1e-9)) - predict_log_lr(sample, token_weights, bias))
        for sample in samples
    ]
    mean_absolute_log_error = sum(absolute_errors) / len(absolute_errors)
    source_counts: dict[str, int] = defaultdict(int)
    label_counts: dict[str, int] = defaultdict(int)
    for sample in samples:
        source_counts[str(sample.get("source", "unknown"))] += 1
        label_counts[str(sample.get("label", "unknown"))] += 1

    artifact.write_text(
        json.dumps(
            {
                "name": "lightweight-local",
                "kind": "LIGHTWEIGHT",
                "version": "0.1.0",
                "trained": True,
                "features": ["token_overlap", "source_credibility", "relevance", "confidence"],
                "biasLogLikelihoodRatio": bias,
                "tokenWeights": dict(sorted(token_weights.items(), key=lambda item: abs(item[1]), reverse=True)[:200]),
                "metrics": {
                    "sampleCount": len(samples),
                    "sourceCounts": dict(sorted(source_counts.items())),
                    "labelCounts": dict(sorted(label_counts.items())),
                    "meanAbsoluteLogError": mean_absolute_log_error,
                    "trainingData": str(samples_path),
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Trained lightweight artifact: {artifact}")


if __name__ == "__main__":
    main()
