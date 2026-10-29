export const RUBRIC_VERSION = "poster-judge-v3";
export const criteria = [
  {
    key: "route_quality",
    name: "Route quality",
    help: "Does the route match the reference shape and follow the correct path relative to shorelines, roads, water and landmarks? Both shape and placement must be correct. Ignore route color and line weight.",
  },
  {
    key: "background_geography",
    name: "Background geography",
    help: "Ignore the route and markers entirely. Compare land/water shapes, roads, feature positions and terrain layout with the schematic and satellite view, allowing the requested artistic style.",
  },
  {
    key: "design",
    name: "Design quality",
    help: "Legible text, visible route, balanced composition and adherence to the requested style. Score independently of route accuracy.",
  },
];

export function emptyReview(datasetId) {
  return {
    version: 3,
    datasetId,
    ratings: {},
    notes: {},
    feedback: {},
    revealedAt: null,
    previouslyRevealedCaseIds: [],
  };
}

export function validateReview(value, dataset) {
  if (!value || value.version !== 3 || value.datasetId !== dataset.id)
    throw new Error(
      "Ratings belong to a different trial or rubric. Earlier ratings are preserved separately.",
    );
  if (
    !value.ratings ||
    typeof value.ratings !== "object" ||
    Array.isArray(value.ratings) ||
    !value.notes ||
    typeof value.notes !== "object" ||
    Array.isArray(value.notes)
  )
    throw new Error("Invalid ratings format.");
  const ids = new Set(dataset.cases.map((c) => c.id));
  const cleaned = emptyReview(dataset.id);
  for (const [id, ratings] of Object.entries(value.ratings)) {
    if (
      !ids.has(id) ||
      !ratings ||
      typeof ratings !== "object" ||
      Array.isArray(ratings)
    )
      throw new Error("Unknown poster or invalid ratings.");
    cleaned.ratings[id] = {};
    for (const [key, rating] of Object.entries(ratings)) {
      if (
        !criteria.some((c) => c.key === key) ||
        !["pass", "fail"].includes(rating)
      )
        throw new Error("Ratings must be pass or fail for the three criteria.");
      cleaned.ratings[id][key] = rating;
    }
  }
  for (const [id, note] of Object.entries(value.notes)) {
    if (!ids.has(id) || typeof note !== "string" || note.length > 4000)
      throw new Error("Invalid note (maximum 4,000 characters).");
    cleaned.notes[id] = note;
  }
  if (
    value.feedback !== undefined &&
    (!value.feedback ||
      typeof value.feedback !== "object" ||
      Array.isArray(value.feedback))
  )
    throw new Error("Invalid feedback.");
  for (const [key, f] of Object.entries(value.feedback ?? {})) {
    if (
      !f ||
      !ids.has(f.id) ||
      !criteria.some((c) => c.key === f.criterion) ||
      key !== feedbackKey(f.id, f.criterion) ||
      !["keep_human", "accept_judge", "unsure"].includes(f.decision) ||
      !["threshold", "style", "missed_detail", "geography", "other"].includes(
        f.reason,
      ) ||
      ![f.human, f.judge, f.finalHuman].every((v) =>
        ["pass", "fail"].includes(v),
      ) ||
      f.human === f.judge ||
      typeof f.rationale !== "string" ||
      f.rationale.length > 4000 ||
      typeof f.rule !== "string" ||
      f.rule.length > 2000 ||
      typeof f.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(f.updatedAt)) ||
      (f.decision !== "unsure" && !f.rationale.trim()) ||
      f.finalHuman !== (f.decision === "accept_judge" ? f.judge : f.human)
    )
      throw new Error("Invalid disagreement feedback.");
    cleaned.feedback[key] = Object.fromEntries(
      [
        "id",
        "criterion",
        "decision",
        "reason",
        "human",
        "judge",
        "finalHuman",
        "rationale",
        "rule",
        "updatedAt",
      ].map((k) => [k, f[k]]),
    );
  }
  const previouslyRevealed = value.previouslyRevealedCaseIds ?? [];
  if (
    !Array.isArray(previouslyRevealed) ||
    new Set(previouslyRevealed).size !== previouslyRevealed.length ||
    previouslyRevealed.some(
      (id) =>
        !ids.has(id) ||
        Object.keys(cleaned.ratings[id] ?? {}).length !== criteria.length,
    )
  ) {
    throw new Error("Invalid previously revealed posters.");
  }
  cleaned.previouslyRevealedCaseIds = [...previouslyRevealed];
  if (value.revealedAt !== null) {
    if (
      typeof value.revealedAt !== "string" ||
      !Number.isFinite(Date.parse(value.revealedAt))
    )
      throw new Error("Invalid comparison timestamp.");
    if (ratingCount(cleaned) !== dataset.cases.length * criteria.length)
      throw new Error("Complete all ratings before revealing the judge.");
    cleaned.revealedAt = value.revealedAt;
  }
  return cleaned;
}

export function extendReview(previous, previousDataset, dataset) {
  const source = validateReview(previous, previousDataset);
  const ids = new Set(dataset.cases.map((c) => c.id));
  if (previousDataset.cases.some((c) => !ids.has(c.id)))
    throw new Error("Expanded trial must retain every previous poster.");
  const expanded = emptyReview(dataset.id);
  expanded.ratings = structuredClone(source.ratings);
  expanded.notes = structuredClone(source.notes);
  expanded.feedback = structuredClone(source.feedback);
  expanded.previouslyRevealedCaseIds = [
    ...new Set([
      ...source.previouslyRevealedCaseIds,
      ...(source.revealedAt ? previousDataset.cases.map((c) => c.id) : []),
    ]),
  ];
  return validateReview(expanded, dataset);
}

export function carryReviewToRejudgedDataset(
  previous,
  previousDataset,
  dataset,
) {
  if (
    previousDataset.judgeVersion !== RUBRIC_VERSION ||
    dataset.judgeVersion !== RUBRIC_VERSION ||
    previousDataset.cases.length !== dataset.cases.length
  )
    throw new Error("Rejudging requires the same rubric and posters");
  const identity = (c) =>
    JSON.stringify({
      id: c.id,
      label: c.label,
      brief: c.brief,
      candidate: c.candidate,
      references: c.references,
    });
  for (const item of previousDataset.cases) {
    const next = dataset.cases.find((c) => c.id === item.id);
    if (!next || identity(item) !== identity(next))
      throw new Error("Rejudging must preserve the original images and brief");
  }
  const review = validateReview(previous, previousDataset);
  return validateReview({ ...review, datasetId: dataset.id }, dataset);
}

export function ratingCount(review) {
  return Object.values(review.ratings).reduce(
    (n, r) => n + Object.keys(r).length,
    0,
  );
}

export function completedCaseIds(review, dataset) {
  return dataset.cases
    .filter((c) =>
      criteria.every((criterion) => review.ratings[c.id]?.[criterion.key]),
    )
    .map((c) => c.id);
}

export function confirmCaseAssessment(review, dataset, id, overrides = {}) {
  const next = validateReview(review, dataset);
  if (!dataset.cases.some((c) => c.id === id))
    throw new Error("Unknown poster");
  for (const [key, value] of Object.entries(overrides)) {
    if (
      !criteria.some((c) => c.key === key) ||
      !["pass", "fail"].includes(value)
    )
      throw new Error("Invalid rating override");
  }
  next.ratings[id] = Object.fromEntries(
    criteria.map((c) => [
      c.key,
      overrides[c.key] ?? next.ratings[id]?.[c.key] ?? "pass",
    ]),
  );
  return validateReview(next, dataset);
}

export function assessmentChanges(
  before,
  after,
  dataset,
  previouslyRevealed = [],
) {
  const seen = new Set([
    ...previouslyRevealed,
    ...before.previouslyRevealedCaseIds,
  ]);
  const changes = dataset.cases.flatMap((item) =>
    [...criteria.map((c) => c.key), "notes"].flatMap((key) => {
      const from =
        key === "notes"
          ? (before.notes[item.id] ?? "")
          : (before.ratings[item.id]?.[key] ?? null);
      const to =
        key === "notes"
          ? (after.notes[item.id] ?? "")
          : (after.ratings[item.id]?.[key] ?? null);
      return from === to
        ? []
        : [
            {
              id: item.id,
              criterion: key,
              from,
              to,
              afterReveal: Boolean(before.revealedAt) || seen.has(item.id),
            },
          ];
    }),
  );
  for (const key of new Set([
    ...Object.keys(before.feedback ?? {}),
    ...Object.keys(after.feedback ?? {}),
  ])) {
    const from = before.feedback?.[key] ?? null,
      to = after.feedback?.[key] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to))
      changes.push({
        id: (to ?? from).id,
        criterion: "feedback",
        from,
        to,
        afterReveal: true,
      });
  }
  return changes;
}

export function revealAssessed(
  review,
  dataset,
  now = new Date().toISOString(),
) {
  const next = validateReview(review, dataset);
  if (next.revealedAt) return next;
  const completed = completedCaseIds(next, dataset);
  if (!completed.length)
    throw new Error(
      "Complete all three criteria for at least one poster before comparing.",
    );
  next.previouslyRevealedCaseIds = [
    ...new Set([...next.previouslyRevealedCaseIds, ...completed]),
  ];
  if (completed.length === dataset.cases.length) next.revealedAt ??= now;
  return validateReview(next, dataset);
}

export function comparisonDataset(review, dataset) {
  const visible = new Set(review.previouslyRevealedCaseIds);
  return {
    ...dataset,
    cases: dataset.cases.filter((c) => review.revealedAt || visible.has(c.id)),
  };
}

export function compareReview(review, dataset) {
  const rows = dataset.cases.flatMap((item) =>
    criteria.map((c) => {
      const human = review.ratings[item.id]?.[c.key] ?? null;
      const judge = item.judgment?.[c.key]?.verdict ?? "error";
      const comparable = human !== null && ["pass", "fail"].includes(judge);
      return {
        id: item.id,
        label: item.label,
        criterion: c.key,
        human,
        judge,
        outcome:
          human === null
            ? "unrated"
            : !comparable
              ? "no_binary_verdict"
              : human === judge
                ? "agree"
                : judge === "pass"
                  ? "false_accept"
                  : "false_reject",
      };
    }),
  );
  const summarize = (subset) => {
    const counts = {
      rated: 0,
      compared: 0,
      agree: 0,
      falseAccept: 0,
      falseReject: 0,
      abstained: 0,
    };
    for (const row of subset) {
      if (row.human === null) continue;
      counts.rated++;
      if (row.outcome === "no_binary_verdict") {
        counts.abstained++;
        continue;
      }
      counts.compared++;
      if (row.outcome === "agree") counts.agree++;
      if (row.outcome === "false_accept") counts.falseAccept++;
      if (row.outcome === "false_reject") counts.falseReject++;
    }
    return {
      ...counts,
      agreement: counts.compared ? counts.agree / counts.compared : null,
    };
  };
  return {
    total: summarize(rows),
    byCriterion: Object.fromEntries(
      criteria.map((c) => [
        c.key,
        summarize(rows.filter((r) => r.criterion === c.key)),
      ]),
    ),
    rows,
  };
}

export function feedbackKey(id, criterion) {
  return `${id}:${criterion}`;
}

export function disagreementCases(review, dataset) {
  const visible = comparisonDataset(review, dataset);
  return compareReview(review, visible).rows.flatMap((row) => {
    const feedback = review.feedback?.[feedbackKey(row.id, row.criterion)];
    const mismatch = ["false_accept", "false_reject"].includes(row.outcome);
    if (!mismatch && !feedback) return [];
    const stale = Boolean(
      feedback &&
        (feedback.finalHuman !== row.human || feedback.judge !== row.judge),
    );
    return [
      {
        ...row,
        key: feedbackKey(row.id, row.criterion),
        feedback,
        originalHuman: feedback?.human ?? row.human,
        originalJudge: feedback?.judge ?? row.judge,
        status: stale
          ? "stale"
          : feedback && feedback.decision !== "unsure"
            ? "reviewed"
            : "pending",
      },
    ];
  });
}

export function saveDisagreement(
  review,
  dataset,
  key,
  input,
  now = new Date().toISOString(),
) {
  const row = disagreementCases(review, dataset).find((r) => r.key === key);
  if (!row) throw new Error("Only revealed disagreements can be reviewed.");
  if (input.decision !== "unsure" && !input.rationale?.trim())
    throw new Error(
      "Add decisive evidence before marking this disagreement reviewed.",
    );
  const next = validateReview(review, dataset);
  const human = row.status === "stale" ? row.human : row.originalHuman;
  const judge = row.judge;
  if (human === judge)
    throw new Error(
      "This assessment now agrees. Review its history or choose another disagreement.",
    );
  const finalHuman = input.decision === "accept_judge" ? judge : human;
  next.feedback[key] = {
    id: row.id,
    criterion: row.criterion,
    human,
    judge,
    finalHuman,
    decision: input.decision,
    reason: input.reason,
    rationale: input.rationale.trim(),
    rule: input.rule.trim(),
    updatedAt: now,
  };
  next.ratings[row.id][row.criterion] = finalHuman;
  return validateReview(next, dataset);
}

export function calibrationBundle(review, dataset) {
  const rows = disagreementCases(review, dataset);
  const reviewed = rows.filter((r) => r.status === "reviewed");
  return {
    version: 1,
    datasetId: dataset.id,
    model: dataset.model,
    rubric: criteria,
    exportedAt: new Date().toISOString(),
    purpose:
      "Human-adjudicated calibration examples; not an independent accuracy benchmark.",
    currentComparison: compareReview(review, comparisonDataset(review, dataset))
      .total,
    rules: reviewed
      .filter((r) => r.feedback.rule)
      .map((r) => ({
        criterion: r.criterion,
        rule: r.feedback.rule,
        source: r.key,
      })),
    examples: reviewed.map((r) => {
      const item = dataset.cases.find((c) => c.id === r.id);
      return {
        ...r.feedback,
        label: item.label,
        candidate: item.candidate,
        references: item.references,
        brief: item.brief,
        judgeExplanation: item.judgment?.[r.criterion],
      };
    }),
    pending: rows.filter((r) => r.status !== "reviewed").length,
    validationAdvice:
      "Tune on these examples, retain agreeing examples as regression checks, and validate on unseen route families. Images are relative paths in the lab folder.",
  };
}

export function correctDisagreementRating(
  review,
  dataset,
  key,
  verdict,
  now = new Date().toISOString(),
) {
  if (!["pass", "fail"].includes(verdict))
    throw new Error("Choose Pass or Fail.");
  const row = disagreementCases(review, dataset).find((r) => r.key === key);
  if (!row)
    throw new Error("Only revealed disagreements can be corrected here.");
  if (row.human === verdict) return validateReview(review, dataset);
  return saveDisagreement(
    review,
    dataset,
    key,
    {
      decision: verdict === row.judge ? "accept_judge" : "keep_human",
      reason: "other",
      rationale: "Corrected my human rating using the Pass / Fail controls.",
      rule: "",
    },
    now,
  );
}

export function disagreementSummary(review, dataset) {
  const rows = disagreementCases(review, dataset);
  const summarize = (group) => ({
    total: group.length,
    kept: group.filter(
      (r) => r.status === "reviewed" && r.feedback.decision === "keep_human",
    ).length,
    corrected: group.filter(
      (r) => r.status === "reviewed" && r.feedback.decision === "accept_judge",
    ).length,
    pending: group.filter((r) => r.status !== "reviewed").length,
    remaining: group.filter((r) => r.human !== r.judge).length,
  });
  return {
    ...summarize(rows),
    posters: new Set(rows.map((r) => r.id)).size,
    current: compareReview(review, comparisonDataset(review, dataset)).total,
    byCriterion: Object.fromEntries(
      criteria.map((c) => [
        c.key,
        summarize(rows.filter((r) => r.criterion === c.key)),
      ]),
    ),
    reasons: Object.fromEntries(
      ["threshold", "style", "missed_detail", "geography", "other"].map(
        (key) => [
          key,
          rows.filter(
            (r) => r.status === "reviewed" && r.feedback.reason === key,
          ).length,
        ],
      ),
    ),
    rules: rows.filter((r) => r.status === "reviewed" && r.feedback.rule.trim())
      .length,
    rows,
  };
}
