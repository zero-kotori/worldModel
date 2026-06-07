import { existsSync } from "node:fs";
import path from "node:path";

const artifactPath = process.argv[2] ?? path.join(process.cwd(), "model-artifacts", "lightweight-demo.json");

if (!existsSync(artifactPath)) {
  console.log(
    JSON.stringify(
      {
        imported: false,
        path: artifactPath,
        message: "Model artifact path does not exist yet; provide a local artifact path to register it."
      },
      null,
      2
    )
  );
  process.exit(0);
}

console.log(
  JSON.stringify(
    {
      imported: true,
      path: artifactPath,
      message: "Model artifact is available for registration by the model service."
    },
    null,
    2
  )
);
