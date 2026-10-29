import { emptyReview, validateReview } from "./core.mjs";

export const ROUTE_COMBINATION_RULE =
  "Route quality passes only when route shape and geographic placement pass; either failure fails, otherwise uncertainty is retained. Placement not_applicable uses the shape verdict.";

export function combineRouteVerdicts(shape, placement) {
  if (
    !["pass", "fail", "uncertain"].includes(shape) ||
    !["pass", "fail", "uncertain", "not_applicable"].includes(placement)
  ) {
    throw new Error("Invalid source route verdicts");
  }
  if (shape === "fail" || placement === "fail") return "fail";
  if (shape === "uncertain" || placement === "uncertain") return "uncertain";
  return "pass";
}

export function combineRouteAssessments(shape, placement) {
  const verdict = combineRouteVerdicts(shape?.verdict, placement?.verdict);
  if (
    typeof shape.summary !== "string" ||
    typeof placement.summary !== "string" ||
    !Array.isArray(shape.issues) ||
    !Array.isArray(placement.issues)
  ) {
    throw new Error("Invalid source route assessments");
  }
  return {
    verdict,
    summary: `Combined from prior assessments. Shape: ${shape.summary} Geographic placement: ${placement.summary}`,
    issues: [
      ...shape.issues.map((issue) => ({
        ...issue,
        location: `Route shape — ${issue.location}`,
      })),
      ...placement.issues.map((issue) => ({
        ...issue,
        location: `Geographic placement — ${issue.location}`,
      })),
    ],
  };
}

export function migrateFourCriterionReview(previous, previousDataset, dataset) {
  if (
    previous?.version !== 2 ||
    previous.datasetId !== previousDataset.id ||
    previousDataset.judgeVersion !== "poster-judge-v2" ||
    dataset.judgeVersion !== "poster-judge-v3"
  )
    throw new Error("Expected a v2 review and v3 destination");
  const oldIds = new Set(previousDataset.cases.map((c) => c.id));
  const newIds = new Set(dataset.cases.map((c) => c.id));
  if (previousDataset.cases.some((c) => !newIds.has(c.id)))
    throw new Error("Migration must retain previous posters");
  const next = emptyReview(dataset.id);
  if (
    !previous.ratings ||
    typeof previous.ratings !== "object" ||
    Array.isArray(previous.ratings) ||
    !previous.notes ||
    typeof previous.notes !== "object" ||
    Array.isArray(previous.notes)
  )
    throw new Error("Invalid previous review");
  for (const [id, ratings] of Object.entries(previous.ratings)) {
    if (
      !oldIds.has(id) ||
      !ratings ||
      typeof ratings !== "object" ||
      Array.isArray(ratings)
    )
      throw new Error("Invalid previous ratings");
    for (const [key, value] of Object.entries(ratings)) {
      if (
        ![
          "route",
          "route_geography",
          "background_geography",
          "design",
        ].includes(key) ||
        !["pass", "fail"].includes(value)
      )
        throw new Error("Invalid previous ratings");
    }
    const combined = {};
    if (ratings.route && ratings.route_geography)
      combined.route_quality = combineRouteVerdicts(
        ratings.route,
        ratings.route_geography,
      );
    if (ratings.background_geography)
      combined.background_geography = ratings.background_geography;
    if (ratings.design) combined.design = ratings.design;
    if (Object.keys(combined).length) next.ratings[id] = combined;
  }
  next.notes = structuredClone(previous.notes);
  const revealed = previous.previouslyRevealedCaseIds ?? [];
  if (
    !Array.isArray(revealed) ||
    new Set(revealed).size !== revealed.length ||
    revealed.some(
      (id) =>
        !oldIds.has(id) || Object.keys(previous.ratings[id] ?? {}).length !== 4,
    )
  )
    throw new Error("Invalid previous reveal state");
  next.previouslyRevealedCaseIds = [...revealed];
  if (previous.revealedAt !== null) {
    if (
      typeof previous.revealedAt !== "string" ||
      !Number.isFinite(Date.parse(previous.revealedAt)) ||
      previousDataset.cases.some(
        (c) => Object.keys(previous.ratings[c.id] ?? {}).length !== 4,
      )
    )
      throw new Error("Invalid previous completion state");
    next.previouslyRevealedCaseIds = [
      ...new Set([...revealed, ...previousDataset.cases.map((c) => c.id)]),
    ];
    if (previousDataset.cases.length === dataset.cases.length)
      next.revealedAt = previous.revealedAt;
  }
  return validateReview(next, dataset);
}
