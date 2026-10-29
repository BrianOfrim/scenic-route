const dataset = JSON.parse(document.getElementById("dataset").textContent);
const $ = (id) => document.getElementById(id);
const practice = new URLSearchParams(location.search).has("practice");
const storageKey = `scenic-poster-review:${dataset.id}${practice ? ":practice" : ""}`;
let review = emptyReview(dataset.id),
  current = 0,
  reference = 0,
  revision = 0;
let ready = false,
  serverAvailable = false,
  conflicted = false,
  saving = Promise.resolve();
const total = dataset.cases.length * criteria.length;
const currentCaseRevealed = () =>
  Boolean(review.revealedAt) ||
  review.previouslyRevealedCaseIds.includes(dataset.cases[current].id);

function confirmCurrent(overrides = {}) {
  if (!ready || conflicted) return;
  const id = dataset.cases[current].id;
  const next = confirmCaseAssessment(review, dataset, id, overrides);
  if (JSON.stringify(next.ratings[id]) !== JSON.stringify(review.ratings[id])) {
    review = next;
    refreshControls();
    persist();
  }
}

function text(tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}
function status(message, error = false) {
  $("save-status").textContent = (practice ? "Practice mode · " : "") + message;
  $("save-status").classList.toggle("error", error);
}
function localSave() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(review));
    return true;
  } catch {
    return false;
  }
}
function persist() {
  const snapshot = structuredClone(review);
  const browserSaved = localSave();
  status("Saving…");
  saving = saving
    .catch(() => {})
    .then(async () => {
      if (serverAvailable && !conflicted) {
        try {
          const response = await fetch("/ratings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ revision, review: snapshot }),
            signal: AbortSignal.timeout(5000),
          });
          const result = await response.json();
          if (response.status === 409) {
            conflicted = true;
            refreshControls();
            throw new Error(
              result.error +
                " Export this tab’s ratings first if you want to keep them.",
            );
          }
          if (!response.ok)
            throw new Error(result.error || "Could not save ratings");
          revision = result.revision;
          status("Saved to human-ratings.json on this computer");
          return;
        } catch (error) {
          status(
            `${browserSaved ? "Saved in this browser. " : "Not saved. "}${error.message}`,
            true,
          );
          return;
        }
      }
      status(
        browserSaved
          ? "Saved in this browser · Export ratings for a portable copy"
          : "Browser storage unavailable · Export ratings to keep your work",
        !browserSaved,
      );
    });
  return saving;
}

function refreshControls() {
  const count = ratingCount(review);
  const completed = completedCaseIds(review, dataset);
  const hasComparison = comparisonDataset(review, dataset).cases.length > 0;
  const newCompleted = completed.some(
    (id) => !review.previouslyRevealedCaseIds.includes(id),
  );
  $("progress-label").textContent = `${count} / ${total} ratings`;
  $("progress-fill").style.width = `${(count / total) * 100}%`;
  $("finish").hidden = Boolean(dataset.humanOnly);
  $("finish").disabled = !ready || conflicted || completed.length === 0;
  $("finish").textContent =
    review.revealedAt || (hasComparison && !newCompleted)
      ? `View comparison (${completed.length})`
      : count === total
        ? "Finish & compare"
        : `Compare assessed (${completed.length})`;
  $("export").disabled = !ready;
  $("import").disabled = !ready || conflicted;
  $("case-select").disabled = !ready;
  $("notes").disabled = !ready || conflicted;
  $("previous").disabled = !ready || current === 0;
  const last = current === dataset.cases.length - 1;
  $("next").disabled =
    !ready ||
    conflicted ||
    (last && completed.includes(dataset.cases[current].id));
  $("next").textContent = last ? "Save assessment" : "Save & next";
  $("view-switch").hidden = Boolean(dataset.humanOnly) || !hasComparison;
  for (const c of criteria) {
    const rating = review.ratings[dataset.cases[current].id]?.[c.key];
    for (const verdict of ["pass", "fail"]) {
      const b = $(`${c.key}-${verdict}`);
      b.setAttribute("aria-pressed", String((rating ?? "pass") === verdict));
      b.disabled = !ready || conflicted;
    }
    $(`${c.key}-status`).textContent = rating
      ? rating === "pass"
        ? "Pass"
        : "Fail"
      : "Pass (default)";
  }
  dataset.cases.forEach((item, i) => {
    const n = Object.keys(review.ratings[item.id] ?? {}).length;
    $("case-select").options[i].textContent =
      `${i + 1}. ${item.label} (${n}/${criteria.length}${review.previouslyRevealedCaseIds.includes(item.id) || review.revealedAt ? " · compared" : ""})`;
  });
  $("panel-intro").textContent = currentCaseRevealed()
    ? "You can edit these assessments at any time. Changes save automatically and update the comparison; revisions after reveal are recorded."
    : "All criteria default to Pass. Override any failures, then Save & next to confirm this poster. Defaults count only after you save or choose a rating.";
}

function renderReference() {
  const r = dataset.cases[current].references[reference];
  $("reference-image").src = r.image;
  $("reference-image").alt = `${r.role} reference`;
  $("reference-caption").textContent =
    `${r.role.charAt(0).toUpperCase() + r.role.slice(1)} reference`;
  Array.from($("reference-tabs").children).forEach((b, i) =>
    b.setAttribute("aria-pressed", String(i === reference)),
  );
}

function renderCase() {
  const item = dataset.cases[current];
  reference = Math.max(
    0,
    item.references.findIndex(
      (r) => r.role.trim().toLowerCase() === "schematic",
    ),
  );
  $("case-select").value = String(current);
  $("case-position").textContent =
    `${current + 1} of ${dataset.cases.length} posters`;
  $("candidate-image").src = item.candidate;
  $("candidate-image").alt = item.label;
  $("reference-tabs").replaceChildren();
  item.references.forEach((r, i) => {
    const b = text("button", r.role);
    b.type = "button";
    b.addEventListener("click", () => {
      reference = i;
      renderReference();
    });
    $("reference-tabs").append(b);
  });
  renderReference();
  $("notes").value = review.notes[item.id] ?? "";
  const brief = $("brief-content");
  brief.replaceChildren();
  const spec = item.brief ?? {};
  brief.append(
    text("p", spec.style?.references || "No style description supplied."),
  );
  const dl = document.createElement("dl");
  const fields = [
    ["Style", spec.style?.name],
    ["Palette", spec.style?.palette?.join(", ")],
    ["Typography", spec.style?.typography],
    ["Title", spec.text?.title],
    ["Subtitle", spec.text?.subtitle],
    ...(spec.text?.stats ?? []).map((s) => [s.label, s.value]),
    ["Text rules", spec.text?.rules],
    ["Landmarks", (spec.landmarks ?? []).map((l) => l.name).join(", ")],
    ["Edits", (spec.editRequests ?? []).join("\n")],
  ];
  for (const [label, value] of fields)
    if (value) dl.append(text("dt", label), text("dd", value));
  brief.append(dl);
  refreshControls();
}

function showResults() {
  if (dataset.humanOnly) return;
  const visibleDataset = comparisonDataset(review, dataset);
  if (!visibleDataset.cases.length) return;
  const comparison = compareReview(review, visibleDataset),
    s = comparison.total;
  $("result-intro").textContent =
    `${visibleDataset.cases.length} of ${dataset.cases.length} posters assessed · ${s.rated} human ratings · ${dataset.model}. Results use your latest ratings, including any edits. Only compared posters appear here; the remaining judge verdicts stay hidden. Agreement measures consistency with you, not objective correctness.`;
  $("metrics").replaceChildren();
  for (const [label, value, detail] of [
    [
      "Agreement",
      s.agreement === null ? "—" : `${Math.round(s.agreement * 100)}%`,
      `${s.agree} of ${s.compared} binary judgments`,
    ],
    ["False accepts", s.falseAccept, "Model passed · you failed"],
    ["False rejects", s.falseReject, "Model failed · you passed"],
    ["No binary verdict", s.abstained, "Uncertain, not applicable or error"],
  ]) {
    const box = text("div", "", "metric");
    box.append(
      text("span", label),
      text("strong", value),
      text("span", detail),
    );
    $("metrics").append(box);
  }
  $("criterion-summary").replaceChildren();
  if (dataset.previous) {
    const originalIds = new Set(dataset.previous.caseIds);
    const added = compareReview(review, {
      ...visibleDataset,
      cases: visibleDataset.cases.filter((c) => !originalIds.has(c.id)),
    }).total;
    if (added.rated)
      $("criterion-summary").append(
        text(
          "p",
          `Added posters only: ${added.agree}/${added.compared} binary judgments agree. This subtotal excludes posters from the original lab.`,
          "criterion-summary",
        ),
      );
  }
  for (const c of criteria) {
    const m = comparison.byCriterion[c.key];
    $("criterion-summary").append(
      text(
        "p",
        `${c.name}: ${m.agree}/${m.compared} agree${m.abstained ? `; ${m.abstained} without a binary verdict` : ""}`,
        "criterion-summary",
      ),
    );
  }
  $("result-details").replaceChildren();
  for (const item of visibleDataset.cases) {
    const index = dataset.cases.findIndex((c) => c.id === item.id);
    const section = text("section", "", "result-case");
    section.append(text("h3", `${index + 1}. ${item.label}`));
    const inspect = text("button", "Inspect poster");
    inspect.type = "button";
    inspect.addEventListener("click", () => showReview(index));
    section.append(inspect);
    const heading = text("div", "", "result-row row-head");
    ["Criterion", "Your rating", "Judge", "Result"].forEach((v) =>
      heading.append(text("span", v)),
    );
    section.append(heading);
    for (const c of criteria) {
      const row = comparison.rows.find(
        (r) => r.id === item.id && r.criterion === c.key,
      );
      const outcome = {
        agree: "Agree",
        false_accept: "False accept",
        false_reject: "False reject",
        no_binary_verdict: "No binary verdict",
        unrated: "Unrated",
      }[row.outcome];
      const line = text("div", "", "result-row");
      line.append(
        text("span", c.name),
        text("span", row.human),
        text("span", row.judge.replaceAll("_", " ")),
        text("span", outcome, row.outcome === "agree" ? "agree" : "disagree"),
      );
      section.append(line);
      const a = item.judgment?.[c.key];
      if (a) {
        const details = text("details", "", "evidence");
        details.append(
          text("summary", `${c.name}: judge’s explanation`),
          text("p", a.summary),
        );
        for (const issue of a.issues)
          details.append(
            text(
              "p",
              `${issue.location}\nReference: ${issue.referenceObservation}\nPoster: ${issue.candidateObservation}`,
            ),
          );
        section.append(details);
      }
    }
    if (review.notes[item.id])
      section.append(text("p", `Your notes: ${review.notes[item.id]}`));
    $("result-details").append(section);
  }
  $("review-summary").hidden = true;
  $("failures").hidden = true;
  $("review").hidden = true;
  $("results").hidden = false;
  window.scrollTo({ top: 0, behavior: "instant" });
}

function showReview(index) {
  if (typeof index === "number") current = index;
  else {
    const next = dataset.cases.findIndex(
      (c) => Object.keys(review.ratings[c.id] ?? {}).length < criteria.length,
    );
    if (next >= 0) current = next;
  }
  $("review-summary").hidden = true;
  $("failures").hidden = true;
  $("results").hidden = true;
  $("review").hidden = false;
  renderCase();
  window.scrollTo({ top: 0, behavior: "instant" });
}

for (const c of criteria) {
  const field = text("div", "", "criterion");
  const state = text("span", "Not rated", "status");
  state.id = `${c.key}-status`;
  field.append(state, text("h3", c.name), text("p", c.help));
  const choices = text("div", "", "choices");
  choices.setAttribute("role", "group");
  choices.setAttribute("aria-label", c.name);
  for (const verdict of ["pass", "fail"]) {
    const b = text("button", verdict === "pass" ? "Pass" : "Fail", verdict);
    b.id = `${c.key}-${verdict}`;
    b.type = "button";
    b.disabled = true;
    b.setAttribute(
      "aria-label",
      `${c.name}: ${verdict === "pass" ? "Pass" : "Fail"}`,
    );
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      if (!ready || conflicted) return;
      confirmCurrent({ [c.key]: verdict });
      refreshControls();
    });
    choices.append(b);
  }
  field.append(choices);
  $("ratings-placeholder").before(field);
}
dataset.cases.forEach((c, i) => {
  const option = text("option", c.label);
  option.value = String(i);
  $("case-select").append(option);
});
$("case-select").addEventListener("change", () => {
  current = Number($("case-select").value);
  renderCase();
});
$("previous").addEventListener("click", () => {
  current--;
  renderCase();
});
$("next").addEventListener("click", () => {
  confirmCurrent();
  if (current < dataset.cases.length - 1) current++;
  renderCase();
});
$("notes").addEventListener("input", () => {
  if (ready && !conflicted) {
    review.notes[dataset.cases[current].id] = $("notes").value;
    persist();
  }
});
$("finish").addEventListener("click", async () => {
  if (!ready || conflicted || !completedCaseIds(review, dataset).length) return;
  review = revealAssessed(review, dataset);
  refreshControls();
  await persist();
  showResults();
});
$("show-results").addEventListener("click", showResults);
$("show-review").addEventListener("click", () => showReview());
$("export").addEventListener("click", () => {
  const payload = {
    ...review,
    exportedAt: new Date().toISOString(),
    model: dataset.model,
    runAt: dataset.runAt,
    comparison: comparisonDataset(review, dataset).cases.length
      ? compareReview(review, comparisonDataset(review, dataset))
      : null,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `poster-ratings-${dataset.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async () => {
  try {
    const file = $("import-file").files[0];
    if (!file) return;
    if (file.size > Math.max(100_000, dataset.cases.length * 100_000))
      throw new Error("Ratings file is too large.");
    const incoming = validateReview(JSON.parse(await file.text()), dataset);
    if (
      ratingCount(review) &&
      !confirm(
        "Replace the current unfinished ratings with this file? Export first if you need a backup.",
      )
    )
      return;
    review = incoming;
    renderCase();
    await persist();
    if (review.revealedAt) showResults();
  } catch (error) {
    status(error.message, true);
  }
  $("import-file").value = "";
});
function zoom(image, label) {
  $("zoom-image").src = image;
  $("zoom-title").textContent = label;
  $("zoom-frame").classList.remove("actual");
  $("zoom-size").textContent = "Original size";
  $("image-dialog").showModal();
}
$("candidate-zoom").addEventListener("click", () =>
  zoom(dataset.cases[current].candidate, dataset.cases[current].label),
);
$("reference-zoom").addEventListener("click", () =>
  zoom(
    dataset.cases[current].references[reference].image,
    dataset.cases[current].references[reference].role,
  ),
);
$("close-zoom").addEventListener("click", () => $("image-dialog").close());
$("zoom-size").addEventListener("click", () => {
  const actual = $("zoom-frame").classList.toggle("actual");
  $("zoom-size").textContent = actual ? "Fit to window" : "Original size";
});

let selectedFailure = null,
  failureReference = 0,
  feedbackDirty = false;
function filteredFailures() {
  return disagreementCases(review, dataset).filter(
    (r) =>
      ($("failure-criterion").value === "all" ||
        r.criterion === $("failure-criterion").value) &&
      ($("failure-direction").value === "all" ||
        r.originalJudge === $("failure-direction").value) &&
      ($("failure-status").value === "all" ||
        ($("failure-status").value === "pending"
          ? r.status !== "reviewed"
          : r.status === "reviewed")),
  );
}
function leaveFeedback() {
  return (
    !feedbackDirty ||
    confirm("Discard the unsaved feedback on this disagreement?")
  );
}
function showFailures() {
  if (dataset.humanOnly) return;
  if (!leaveFeedback()) return;
  feedbackDirty = false;
  $("review-summary").hidden = true;
  $("review").hidden = true;
  $("results").hidden = true;
  $("failures").hidden = false;
  renderFailures();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function renderFailures() {
  const all = disagreementCases(review, dataset),
    rows = filteredFailures();
  const live = all.filter((r) => r.human !== r.judge).length;
  const reviewed = all.filter((r) => r.status === "reviewed").length;
  $("failure-summary").textContent =
    `${live} current disagreements · ${all.length} original or current disagreements · ${reviewed} reviewed · ${all.length - reviewed} need review. Only posters whose judgments you have revealed appear here.`;
  $("failure-queue").replaceChildren();
  if (!rows.some((r) => r.key === selectedFailure))
    selectedFailure = rows[0]?.key ?? null;
  for (const r of rows) {
    const b = text("button", "", r.key === selectedFailure ? "selected" : "");
    b.type = "button";
    const name = criteria.find((c) => c.key === r.criterion).name;
    b.append(
      text("strong", r.label),
      text("span", name),
      text("span", `You: ${r.originalHuman} · Judge: ${r.originalJudge}`),
      text("span", r.status === "stale" ? "Changed · review again" : r.status),
    );
    b.setAttribute("aria-current", String(r.key === selectedFailure));
    b.onclick = () => {
      if (!leaveFeedback()) return;
      feedbackDirty = false;
      selectedFailure = r.key;
      renderFailures();
    };
    $("failure-queue").append(b);
  }
  $("failure-detail").hidden = !selectedFailure;
  if (!rows.length)
    $("failure-queue").append(
      text("p", "No disagreements match these filters.", "small"),
    );
  if (!selectedFailure) return;
  const row = rows.find((r) => r.key === selectedFailure),
    item = dataset.cases.find((c) => c.id === row.id),
    c = criteria.find((c) => c.key === row.criterion);
  $("failure-title").textContent = item.label;
  $("failure-candidate").src = item.candidate;
  $("failure-candidate").alt = item.label;
  $("failure-criterion-title").textContent = c.name;
  $("failure-rubric").textContent = c.help;
  $("failure-human").textContent = row.originalHuman;
  $("failure-judge").textContent = row.judge;
  $("failure-current").textContent =
    `Current human rating: ${row.human}. ${row.status === "stale" ? "Ratings or judge changed since this feedback; adjudicate again." : row.status === "reviewed" ? "Reviewed; original disagreement preserved." : "Awaiting your adjudication."}`;
  for (const verdict of ["pass", "fail"]) {
    const b = $(`failure-rating-${verdict}`);
    b.setAttribute("aria-pressed", String(row.human === verdict));
    b.disabled = !ready || conflicted;
  }
  $("failure-notes").textContent = review.notes[item.id]?.trim()
    ? review.notes[item.id]
    : "No notes recorded for this poster.";
  const evidence = $("failure-evidence");
  evidence.replaceChildren();
  const judgment = item.judgment?.[c.key];
  evidence.append(text("p", judgment?.summary ?? "No explanation available."));
  for (const issue of judgment?.issues ?? [])
    evidence.append(
      text(
        "p",
        `${issue.location}\nReference: ${issue.referenceObservation}\nPoster: ${issue.candidateObservation}`,
      ),
    );
  $("failure-brief").replaceChildren(
    text("p", item.brief?.style?.references ?? ""),
    text("p", `Style: ${item.brief?.style?.name ?? "—"}`),
  );
  const brief = text("details", "");
  brief.append(
    text("summary", "Full generation brief"),
    text("p", JSON.stringify(item.brief, null, 2)),
  );
  $("failure-brief").append(brief);
  failureReference = Math.max(
    0,
    item.references.findIndex(
      (r) => r.role.trim().toLowerCase() === "schematic",
    ),
  );
  $("failure-reference-tabs").replaceChildren();
  item.references.forEach((r, i) => {
    const b = text("button", r.role);
    b.type = "button";
    b.onclick = () => {
      failureReference = i;
      renderFailureReference();
    };
    $("failure-reference-tabs").append(b);
  });
  renderFailureReference();
  const f = row.feedback;
  $("feedback-decision").value = f?.decision ?? "keep_human";
  $("feedback-reason").value = f?.reason ?? "threshold";
  $("feedback-rationale").value = f?.rationale ?? "";
  $("feedback-rule").value = f?.rule ?? "";
  $("feedback-status").textContent = f
    ? `Saved ${new Date(f.updatedAt).toLocaleString()}`
    : "No feedback saved yet.";
  for (const el of $("feedback-form").elements)
    el.disabled = !ready || conflicted;
  feedbackDirty = false;
}
function renderFailureReference() {
  const row = disagreementCases(review, dataset).find(
    (r) => r.key === selectedFailure,
  );
  if (!row) return;
  const item = dataset.cases.find((c) => c.id === row.id),
    ref = item.references[failureReference];
  $("failure-reference").src = ref.image;
  $("failure-reference").alt = ref.role + " reference";
  $("failure-reference-caption").textContent = ref.role + " reference";
  Array.from($("failure-reference-tabs").children).forEach((b, i) =>
    b.setAttribute("aria-pressed", String(i === failureReference)),
  );
}
async function saveFeedback(advance) {
  if (!ready || conflicted) return;
  try {
    const rows = filteredFailures(),
      index = rows.findIndex((r) => r.key === selectedFailure);
    review = saveDisagreement(review, dataset, selectedFailure, {
      decision: $("feedback-decision").value,
      reason: $("feedback-reason").value,
      rationale: $("feedback-rationale").value,
      rule: $("feedback-rule").value,
    });
    feedbackDirty = false;
    refreshControls();
    await persist();
    if (advance)
      selectedFailure =
        rows.slice(index + 1).find((r) => r.status !== "reviewed")?.key ??
        rows[index + 1]?.key ??
        rows[0]?.key;
    renderFailures();
  } catch (error) {
    $("feedback-status").textContent = error.message;
    $("feedback-status").classList.add("error");
  }
}
for (const verdict of ["pass", "fail"])
  $(`failure-rating-${verdict}`).onclick = async () => {
    if (!ready || conflicted) return;
    const row = disagreementCases(review, dataset).find(
      (r) => r.key === selectedFailure,
    );
    if (row?.human === verdict) return;
    const draft = feedbackDirty
      ? {
          rationale: $("feedback-rationale").value,
          rule: $("feedback-rule").value,
          reason: $("feedback-reason").value,
        }
      : null;
    try {
      review = correctDisagreementRating(
        review,
        dataset,
        selectedFailure,
        verdict,
      );
      if (!filteredFailures().some((r) => r.key === selectedFailure))
        $("failure-status").value = "all";
      refreshControls();
      await persist();
      renderFailures();
      if (draft) {
        $("feedback-rationale").value = draft.rationale;
        $("feedback-rule").value = draft.rule;
        $("feedback-reason").value = draft.reason;
        feedbackDirty = true;
        $("feedback-status").textContent =
          "Rating corrected. Your unsaved feedback draft is preserved.";
      }
    } catch (error) {
      $("feedback-status").textContent = error.message;
      $("feedback-status").classList.add("error");
    }
  };
$("show-failures").onclick = showFailures;
$("feedback-form").onsubmit = (e) => {
  e.preventDefault();
  saveFeedback(false);
};
$("feedback-next").onclick = () => saveFeedback(true);
$("feedback-form").oninput = () => {
  feedbackDirty = true;
  $("feedback-status").textContent = "Unsaved feedback";
  $("feedback-status").classList.remove("error");
};
for (const id of ["failure-criterion", "failure-direction", "failure-status"])
  $(id).onchange = () => {
    if (!leaveFeedback()) return;
    feedbackDirty = false;
    renderFailures();
  };
for (const id of ["show-review", "show-results", "finish"])
  $(id).addEventListener(
    "click",
    (e) => {
      if (!$("failures").hidden && !leaveFeedback()) {
        e.stopImmediatePropagation();
        e.preventDefault();
      } else feedbackDirty = false;
    },
    { capture: true },
  );
window.addEventListener("beforeunload", (e) => {
  if (feedbackDirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
$("export-calibration").onclick = () => {
  const payload = calibrationBundle(review, dataset),
    url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
  const a = document.createElement("a");
  a.href = url;
  a.download = `poster-calibration-${dataset.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("failure-candidate-zoom").onclick = () => {
  const row = disagreementCases(review, dataset).find(
      (r) => r.key === selectedFailure,
    ),
    item = dataset.cases.find((c) => c.id === row.id);
  zoom(item.candidate, item.label);
};
$("failure-reference-zoom").onclick = () => {
  const row = disagreementCases(review, dataset).find(
      (r) => r.key === selectedFailure,
    ),
    ref = dataset.cases.find((c) => c.id === row.id).references[
      failureReference
    ];
  zoom(ref.image, ref.role);
};

const reasonNames = {
  threshold: "Pass / fail threshold",
  style: "Artistic style tolerance",
  missed_detail: "Missed or misread detail",
  geography: "Geographic relationship",
  other: "Other / rating correction",
};
function showReviewSummary() {
  if (dataset.humanOnly) return;
  if (!leaveFeedback()) return;
  feedbackDirty = false;
  $("review").hidden = true;
  $("results").hidden = true;
  $("failures").hidden = true;
  $("review-summary").hidden = false;
  renderReviewSummary();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function inspectSummaryRow(key) {
  $("failure-criterion").value = "all";
  $("failure-direction").value = "all";
  $("failure-status").value = "all";
  selectedFailure = key;
  showFailures();
}
function renderReviewSummary() {
  const s = disagreementSummary(review, dataset),
    pct = (n) => `${(n * 100).toFixed(1)}%`;
  $("summary-intro").textContent =
    `${s.total - s.pending} of ${s.total} disagreements reviewed across ${s.posters} posters. ${s.pending ? `${s.pending} still need review.` : "Every saved disagreement has been adjudicated."} Source: your latest saved ratings and feedback · ${dataset.model}.`;
  $("summary-metrics").replaceChildren();
  for (const [label, value, detail] of [
    [
      "Disagreements reviewed",
      s.total - s.pending,
      `${s.total} total criterion-level differences`,
    ],
    [
      "Kept your assessment",
      s.kept,
      "Judge still differs from your preference",
    ],
    ["Corrected your assessment", s.corrected, "Accepted the judge’s verdict"],
    [
      "Saved calibration rules",
      s.rules,
      "Cases with a rule for future posters",
    ],
  ]) {
    const box = text("div", "", "metric");
    box.append(
      text("span", label),
      text("strong", value),
      text("span", detail),
    );
    $("summary-metrics").append(box);
  }
  $("summary-criteria").replaceChildren();
  for (const c of criteria) {
    const m = s.byCriterion[c.key],
      block = text("div", "");
    block.append(text("h3", `${c.name} · ${m.total}`));
    const bar = text("div", "", "summary-bar");
    for (const [key, label] of [
      ["kept", "Kept"],
      ["corrected", "Corrected"],
      ["pending", "Pending"],
    ]) {
      const seg = text("span", "", key);
      seg.style.width = `${m.total ? (m[key] / m.total) * 100 : 0}%`;
      seg.title = `${label}: ${m[key]}`;
      bar.append(seg);
    }
    block.append(
      bar,
      text(
        "p",
        `${m.kept} kept · ${m.corrected} corrected · ${m.pending} pending`,
        "small",
      ),
    );
    $("summary-criteria").append(block);
  }
  $("summary-reasons").replaceChildren();
  for (const [key, count] of Object.entries(s.reasons).sort(
    (a, b) => b[1] - a[1],
  )) {
    const row = text("div", "", "summary-reason");
    row.append(text("span", reasonNames[key]), text("strong", count));
    $("summary-reasons").append(row);
  }
  $("summary-agreement").textContent =
    `${s.current.agree}/${s.current.compared} binary verdicts agree (${s.current.agreement === null ? "—" : pct(s.current.agreement)}). ${s.current.falseAccept} judge passes you reject; ${s.current.falseReject} judge failures you accept. ${s.current.abstained} without a binary verdict.`;
  $("summary-rules").replaceChildren();
  for (const c of criteria) {
    const rules = new Map();
    for (const r of s.rows.filter(
      (r) =>
        r.criterion === c.key &&
        r.status === "reviewed" &&
        r.feedback.rule.trim(),
    )) {
      const rule = r.feedback.rule.trim();
      if (!rules.has(rule)) rules.set(rule, []);
      rules.get(rule).push(r);
    }
    const box = text("div", "");
    box.append(text("h3", c.name));
    if (!rules.size)
      box.append(
        text(
          "p",
          "No explicit rules recorded. See the case rationales below.",
          "small",
        ),
      );
    for (const [rule, rows] of rules) {
      const entry = text("div", "", "summary-rule");
      entry.append(
        text("p", rule),
        text(
          "span",
          `${rows.length} source ${rows.length === 1 ? "case" : "cases"}`,
          "small",
        ),
      );
      const b = text("button", "View source");
      b.onclick = () => inspectSummaryRow(rows[0].key);
      entry.append(b);
      box.append(entry);
    }
    $("summary-rules").append(box);
  }
  const rows = s.rows.filter(
    (r) =>
      ($("summary-criterion").value === "all" ||
        r.criterion === $("summary-criterion").value) &&
      ($("summary-decision").value === "all" ||
        ($("summary-decision").value === "pending"
          ? r.status !== "reviewed"
          : r.status === "reviewed" &&
            r.feedback.decision === $("summary-decision").value)),
  );
  $("summary-detail-heading").textContent =
    `Disagreement details · ${rows.length} of ${s.total}`;
  $("summary-details").replaceChildren();
  for (const r of rows) {
    const item = dataset.cases.find((c) => c.id === r.id),
      f = r.feedback;
    const box = text("article", "", "summary-case");
    box.append(
      text("h3", r.label),
      text("p", criteria.find((c) => c.key === r.criterion).name, "small"),
      text(
        "span",
        r.status !== "reviewed"
          ? "Needs review"
          : f.decision === "keep_human"
            ? "Kept your assessment"
            : "Corrected your assessment",
        "summary-tag",
      ),
      text(
        "p",
        `Original human: ${r.originalHuman} · Judge: ${r.originalJudge} · Current human: ${r.human}`,
      ),
    );
    if (f)
      box.append(
        text("p", `Reason: ${reasonNames[f.reason]}`),
        text("p", f.rationale),
        ...(f.rule ? [text("p", `Rule: ${f.rule}`)] : []),
      );
    if (review.notes[r.id])
      box.append(
        text(
          "p",
          `Original review notes: ${review.notes[r.id]}`,
          "original-notes",
        ),
      );
    const judge = text("details", "", "evidence");
    judge.append(
      text("summary", "Judge’s explanation"),
      text("p", item.judgment?.[r.criterion]?.summary ?? "Unavailable"),
    );
    box.append(judge);
    const b = text("button", "Inspect images & feedback");
    b.onclick = () => inspectSummaryRow(r.key);
    box.append(b);
    $("summary-details").append(box);
  }
  if (!rows.length)
    $("summary-details").append(
      text("p", "No disagreements match these filters."),
    );
}
$("show-review-summary").onclick = showReviewSummary;
$("summary-criterion").onchange = renderReviewSummary;
$("summary-decision").onchange = renderReviewSummary;
$("summary-export").onclick = () => $("export-calibration").click();

let local = null;
try {
  const stored = localStorage.getItem(storageKey);
  if (stored) local = validateReview(JSON.parse(stored), dataset);
} catch {
  /* Invalid browser cache is never silently used. */
}
if (!local && dataset.previous) {
  try {
    const oldKey = `scenic-poster-review:${dataset.previous.id}${practice ? ":practice" : ""}`;
    const old = localStorage.getItem(oldKey);
    if (old)
      local = extendReview(
        JSON.parse(old),
        {
          id: dataset.previous.id,
          cases: dataset.previous.caseIds.map((id) => ({ id })),
        },
        dataset,
      );
  } catch {
    /* An incompatible older review is retained under its original storage key. */
  }
}
if (local) review = local;
let seedServer = false;
if (
  !practice &&
  location.protocol === "http:" &&
  location.hostname === "127.0.0.1"
) {
  try {
    const response = await fetch("/ratings", {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Local save service unavailable");
    const stored = await response.json();
    const serverReview = validateReview(stored.review, dataset);
    if (
      stored.revision === 0 &&
      ratingCount(serverReview) === 0 &&
      local &&
      ratingCount(local) > 0
    ) {
      review = local;
      seedServer = true;
    } else review = serverReview;
    revision = stored.revision;
    serverAvailable = true;
    status("Autosave ready · Ratings stay on this computer");
  } catch {
    status("Using browser storage · Local file saving unavailable", true);
  }
} else
  status(
    practice
      ? "Test ratings are isolated from your real review"
      : "Ratings save in this browser · Export to retain a portable copy",
  );
current = Math.max(
  0,
  dataset.cases.findIndex(
    (c) => Object.keys(review.ratings[c.id] ?? {}).length < criteria.length,
  ),
);
ready = true;
renderCase();
if (seedServer) await persist();
if (
  location.hash === "#summary" &&
  comparisonDataset(review, dataset).cases.length
)
  showReviewSummary();
else if (
  location.hash === "#disagreements" &&
  comparisonDataset(review, dataset).cases.length
)
  showFailures();
else if (review.revealedAt) showResults();
if (dataset.evaluationNote)
  $("rubric-note").textContent = dataset.evaluationNote;
if (dataset.humanOnly) {
  document.querySelector("header .intro").textContent =
    "Assess the new posters against their saved references. Judge evaluation has not run on these examples.";
  $("completion-hint").textContent =
    "All three criteria default to Pass. Override failures and use Save & next to confirm each poster; on the last poster, use Save assessment. Unconfirmed defaults do not count. Your ratings and notes save locally; Export ratings creates a portable copy. These posters have no judge verdicts yet.";
}
