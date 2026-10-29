import { createHash } from "node:crypto";
export function annotationDataset(comparison) {
  const cases = comparison.rows
    .filter(
      (r) =>
        r.criterion === "background_geography" &&
        r.human === "fail" &&
        r.after === "pass",
    )
    .map((row) => {
      const item = comparison.cases.find((c) => c.id === row.id);
      return {
        id: item.id,
        label: item.label,
        notes: item.notes,
        judge: item.newJudgment.background_geography,
        images: [
          { key: "candidate", role: "Generated poster", file: item.candidate },
          ...item.references.map((r, i) => ({
            key: `reference:${i}`,
            role: r.role,
            file: r.image,
          })),
        ],
      };
    });
  return {
    id: createHash("sha256")
      .update(JSON.stringify({ runAt: comparison.runAt, cases }))
      .digest("hex")
      .slice(0, 24),
    model: comparison.model,
    runAt: comparison.runAt,
    cases,
  };
}
export function emptyAnnotations(dataset) {
  return { version: 2, datasetId: dataset.id, cases: {} };
}
export function validateAnnotations(value, dataset) {
  if (
    !value ||
    ![1, 2].includes(value.version) ||
    value.datasetId !== dataset.id ||
    !value.cases ||
    typeof value.cases !== "object" ||
    Array.isArray(value.cases)
  )
    throw new Error(
      "Annotations belong to a different dataset or have an invalid format.",
    );
  const cleaned = emptyAnnotations(dataset);
  for (const [id, entry] of Object.entries(value.cases)) {
    const item = dataset.cases.find((c) => c.id === id);
    if (
      !item ||
      !entry ||
      !Array.isArray(entry.issues) ||
      entry.issues.length > 26 ||
      typeof entry.ready !== "boolean" ||
      typeof entry.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(entry.updatedAt))
    )
      throw new Error("Invalid poster annotations.");
    const labels = new Set();
    const issues = [];
    for (const issue of entry.issues) {
      const geometry = value.version === 1 ? issue?.boxes : issue?.paths;
      if (
        !issue ||
        !/^[A-Z]$/.test(issue.label) ||
        labels.has(issue.label) ||
        typeof issue.explanation !== "string" ||
        issue.explanation.length > 4000 ||
        !geometry ||
        typeof geometry !== "object" ||
        Array.isArray(geometry)
      )
        throw new Error("Invalid annotation region.");
      const scope = issue.scope ?? "region";
      if (!["region", "full_poster"].includes(scope))
        throw new Error("Invalid annotation scope.");
      labels.add(issue.label);
      const paths = {};
      for (const [key, shape] of Object.entries(geometry)) {
        if (!item.images.some((i) => i.key === key))
          throw new Error("Unknown annotation image.");
        let points = shape;
        if (value.version === 1) {
          const b = shape;
          if (
            !b ||
            !["x", "y", "w", "h"].every(
              (k) => typeof b[k] === "number" && Number.isFinite(b[k]),
            ) ||
            b.x < 0 ||
            b.y < 0 ||
            b.w <= 0 ||
            b.h <= 0 ||
            b.x + b.w > 1.000001 ||
            b.y + b.h > 1.000001
          )
            throw new Error(
              "Annotation boxes must stay inside the original image.",
            );
          points = [
            { x: b.x, y: b.y },
            { x: Math.min(1, b.x + b.w), y: b.y },
            { x: Math.min(1, b.x + b.w), y: Math.min(1, b.y + b.h) },
            { x: b.x, y: Math.min(1, b.y + b.h) },
            { x: b.x, y: b.y },
          ];
        }
        if (
          !Array.isArray(points) ||
          points.length < 2 ||
          points.length > 500 ||
          points.some(
            (p) =>
              !p ||
              typeof p.x !== "number" ||
              typeof p.y !== "number" ||
              !Number.isFinite(p.x) ||
              !Number.isFinite(p.y) ||
              p.x < 0 ||
              p.x > 1 ||
              p.y < 0 ||
              p.y > 1,
          )
        )
          throw new Error(
            "Polylines need 2–500 points inside the original image.",
          );
        paths[key] = points.map((p) => ({ x: p.x, y: p.y }));
      }
      issues.push({
        label: issue.label,
        explanation: issue.explanation,
        paths,
        ...(scope === "full_poster" ? { scope } : {}),
      });
    }
    if (
      entry.ready &&
      (!issues.length ||
        issues.some(
          (i) =>
            !i.explanation.trim() ||
            (i.scope !== "full_poster" &&
              (!i.paths.candidate ||
                !Object.keys(i.paths).some((k) => k.startsWith("reference:")))),
        ))
    )
      throw new Error(
        "To mark ready, every comment needs an explanation. Regional comments also need a poster polyline and at least one reference polyline.",
      );
    cleaned.cases[id] = {
      issues,
      ready: entry.ready,
      updatedAt: entry.updatedAt,
    };
  }
  return cleaned;
}
