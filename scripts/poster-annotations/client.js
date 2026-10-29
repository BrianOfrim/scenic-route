const dataset = JSON.parse(document.getElementById("dataset").textContent),
  $ = (id) => document.getElementById(id),
  practice = new URLSearchParams(location.search).has("practice");
const storageKey = `scenic-geography-annotations:${dataset.id}${practice ? ":practice" : ""}`;
let state = emptyAnnotations(dataset),
  revision = 0,
  current = 0,
  referenceKey = null,
  selected = "A",
  loaded = false,
  online = false,
  conflict = false,
  queue = Promise.resolve(),
  largeKey = null;
let undoStack = [],
  typing = false,
  saveTimer = null,
  draft = null;
const item = () => dataset.cases[current];
function entry() {
  return (state.cases[item().id] ??= {
    issues: [{ label: "A", explanation: "", paths: {} }],
    ready: false,
    updatedAt: new Date().toISOString(),
  });
}
function issue() {
  return entry().issues.find((i) => i.label === selected);
}
function status(message, error = false) {
  $("save-status").textContent = (practice ? "Practice mode · " : "") + message;
  $("save-status").classList.toggle("error", error);
}
function remember() {
  undoStack.push({ id: item().id, entry: structuredClone(entry()) });
  if (undoStack.length > 60) undoStack.shift();
}
function changed() {
  entry().ready = false;
  entry().updatedAt = new Date().toISOString();
  refresh();
  save();
}
function save() {
  const snapshot = structuredClone(state);
  let browserSaved = false;
  try {
    localStorage.setItem(storageKey, JSON.stringify(snapshot));
    browserSaved = true;
  } catch {}
  status("Saving…");
  queue = queue
    .catch(() => {})
    .then(async () => {
      if (online && !conflict) {
        try {
          const response = await fetch("/annotations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ revision, annotations: snapshot }),
              signal: AbortSignal.timeout(5000),
            }),
            body = await response.json();
          if (response.status === 409) {
            conflict = true;
            refresh();
            throw new Error(body.error);
          }
          if (!response.ok) throw new Error(body.error ?? "Could not save");
          revision = body.revision;
          status("Saved to geography-annotations.json on this computer");
          return;
        } catch (e) {
          status(
            (browserSaved ? "Browser backup saved. " : "") + e.message,
            true,
          );
          return;
        }
      }
      status(
        browserSaved
          ? "Saved in this browser · Export annotations for a portable copy"
          : "Could not save; export annotations to keep your work",
        !browserSaved,
      );
    });
  return queue;
}
function text(tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}
function render() {
  const c = item();
  if (!c) return;
  selected = entry().issues[0]?.label ?? null;
  typing = false;
  referenceKey =
    c.images.find((i) => i.role.trim().toLowerCase() === "schematic")?.key ??
    c.images[1].key;
  $("case-title").textContent = c.label;
  $("original-notes").textContent = c.notes || "No original notes recorded.";
  $("judge-explanation").textContent = c.judge.summary;
  $("poster-select").value = String(current);
  $("position").textContent = `${current + 1} of ${dataset.cases.length}`;
  $("candidate-image").src = c.images[0].file;
  $("candidate-image").alt = c.label;
  $("reference-tabs").replaceChildren();
  for (const image of c.images.slice(1)) {
    const b = text("button", image.role);
    b.type = "button";
    b.dataset.key = image.key;
    b.onclick = () => {
      finishPath();
      referenceKey = image.key;
      renderReference();
    };
    $("reference-tabs").append(b);
  }
  renderReference();
  renderIssues();
  refresh();
}
function renderReference() {
  const ref = item().images.find((i) => i.key === referenceKey);
  $("reference-image").src = ref.file;
  $("reference-image").alt = ref.role + " reference";
  $("reference-caption").textContent = ref.role + " reference";
  for (const b of $("reference-tabs").children)
    b.setAttribute("aria-pressed", String(b.dataset.key === referenceKey));
  drawAll();
}
function renderIssues() {
  $("issue-list").replaceChildren();
  for (const i of entry().issues) {
    const b = text(
      "button",
      `${i.scope === "full_poster" ? "Full poster" : "Region"} ${i.label}`,
    );
    b.setAttribute("aria-pressed", String(i.label === selected));
    b.onclick = () => {
      finishPath();
      selected = i.label;
      typing = false;
      renderIssues();
      refresh();
    };
    $("issue-list").append(b);
  }
  $("annotation-scope").value = issue()?.scope ?? "region";
  $("explanation-label").textContent = selected
    ? issue()?.scope === "full_poster"
      ? "What is wrong with the poster overall?"
      : `What differs in region ${selected}?`
    : "Add a comment to begin";
  $("explanation").value = issue()?.explanation ?? "";
  drawAll();
}
function refresh() {
  $("ready-status").classList.remove("error");
  const n = Object.values(state.cases).filter((c) => c.ready).length;
  $("progress").textContent =
    `${n} / ${dataset.cases.length} ready as teaching examples`;
  $("previous").disabled = current === 0;
  $("next").disabled = current === dataset.cases.length - 1;
  for (const id of [
    "add-region",
    "remove-region",
    "explanation",
    "annotation-scope",
    "mark-ready",
    "undo",
  ])
    $(id).disabled = !loaded || conflict;
  $("add-region").disabled ||= entry().issues.length >= 26;
  $("remove-region").disabled ||= !selected;
  $("explanation").disabled ||= !selected;
  $("undo").disabled ||= !undoStack.length;
  const i = issue();
  $("region-state").textContent =
    i?.scope === "full_poster"
      ? "Applies to the entire poster. No outlines required."
      : i
        ? item()
            .images.map(
              (image) =>
                `${image.role}: ${i.paths[image.key] ? `${i.paths[image.key].length}-point line saved` : "no line yet"}`,
            )
            .join("\n")
        : "No region selected.";
  $("ready-status").textContent = entry().ready
    ? "Ready · comments and any regional outlines saved"
    : i?.scope === "full_poster"
      ? "Draft · add a general explanation, then mark ready."
      : "Draft · mark ready after pairing regions and adding explanations.";
}
function imageFor(key) {
  return item().images.find((i) => i.key === key);
}
function addLine(svg, points, w, h, className) {
  const line = document.createElementNS(
    "http://www.w3.org/2000/svg",
    points.length >= 3 ? "polygon" : "polyline",
  );
  line.setAttribute(
    "points",
    points.map((p) => `${p.x * w},${p.y * h}`).join(" "),
  );
  if (className) line.setAttribute("class", className);
  svg.append(line);
}
function draw(svg, key, img) {
  svg.replaceChildren();
  if (!img.naturalWidth) return;
  const w = img.naturalWidth,
    h = img.naturalHeight;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  for (const i of entry().issues) {
    const points = i.paths[key];
    if (i.scope === "full_poster" || !points) continue;
    if (draft?.key === key && draft.label === i.label) continue;
    addLine(svg, points, w, h, i.label === selected ? "selected" : "");
    addLabel(svg, i.label, points[0], w, h);
  }
  if (draft?.key === key && draft.id === item().id) {
    addLine(svg, draft.points, w, h, "preview");
    for (const p of draft.points) {
      const dot = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      dot.setAttribute("cx", p.x * w);
      dot.setAttribute("cy", p.y * h);
      dot.setAttribute("r", Math.max(5, w * 0.006));
      svg.append(dot);
    }
    if (draft.points.length) addLabel(svg, draft.label, draft.points[0], w, h);
  }
}
function addLabel(svg, label, p, w, h) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
  node.setAttribute("x", Math.min(p.x * w + 8, w - 40));
  node.setAttribute("y", Math.min(p.y * h + Math.max(32, w * 0.055), h - 8));
  node.style.fontSize = Math.max(30, w * 0.05) + "px";
  node.textContent = label;
  svg.append(node);
}
function drawAll() {
  draw($("candidate-overlay"), "candidate", $("candidate-image"));
  if (referenceKey)
    draw($("reference-overlay"), referenceKey, $("reference-image"));
  if (largeKey) draw($("large-overlay"), largeKey, $("large-image"));
  refreshDrawing();
}
function refreshDrawing() {
  const n = draft?.points.length ?? 0;
  for (const id of ["finish-line", "large-finish"])
    $(id).disabled = !loaded || conflict || n < 2;
  for (const id of ["undo-point", "cancel-line", "large-undo-point"])
    $(id).disabled = !loaded || conflict || !n;
  $("drawing-status").textContent =
    issue()?.scope === "full_poster"
      ? "Full-poster comment selected. Drawing is disabled; explain the overall issue below."
      : draft
        ? `${imageFor(draft.key).role} · Region ${draft.label} · ${n} points. Double-click or Finish line to save.`
        : "Click points on an image to trace a line. Three or more points close automatically. Double-click or Finish line to save. Enter finishes; Escape cancels.";
}
function finishPath() {
  if (!draft) return;
  const d = draft;
  draft = null;
  if (d.id === item().id && d.points.length >= 2) {
    remember();
    entry().issues.find((i) => i.label === d.label).paths[d.key] = d.points;
    changed();
  }
  drawAll();
}
function cancelPath() {
  draft = null;
  drawAll();
}
function undoPoint() {
  if (!draft) return;
  draft.points.pop();
  if (!draft.points.length) draft = null;
  drawAll();
}
function bindDrawing(svg, keyFn, img) {
  svg.addEventListener("click", (e) => {
    if (
      !loaded ||
      conflict ||
      !issue() ||
      issue().scope === "full_poster" ||
      !img.naturalWidth ||
      e.button !== 0 ||
      e.detail > 1
    )
      return;
    const key = keyFn();
    if (
      draft &&
      (draft.key !== key || draft.label !== selected || draft.id !== item().id)
    )
      finishPath();
    if (!draft) draft = { id: item().id, key, label: selected, points: [] };
    if (draft.points.length >= 500) {
      finishPath();
      return;
    }
    const r = svg.getBoundingClientRect(),
      p = {
        x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
        y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
      };
    const prev = draft.points.at(-1);
    if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > 0.0001)
      draft.points.push(p);
    drawAll();
  });
  svg.addEventListener("dblclick", (e) => {
    e.preventDefault();
    finishPath();
  });
}
for (const id of ["candidate-image", "reference-image", "large-image"])
  $(id).onload = drawAll;
bindDrawing($("candidate-overlay"), () => "candidate", $("candidate-image"));
bindDrawing($("reference-overlay"), () => referenceKey, $("reference-image"));
bindDrawing($("large-overlay"), () => largeKey, $("large-image"));
function enlarge(key) {
  if (draft && draft.key !== key) finishPath();
  largeKey = key;
  $("large-title").textContent =
    `${imageFor(key).role} · Region ${selected ?? "—"}`;
  $("large-image").src = imageFor(key).file;
  $("large-dialog").showModal();
  drawAll();
}
$("enlarge-candidate").onclick = () => enlarge("candidate");
$("enlarge-reference").onclick = () => enlarge(referenceKey);
$("close-large").onclick = () => {
  finishPath();
  $("large-dialog").close();
  largeKey = null;
};
$("large-dialog").onclose = () => {
  finishPath();
  largeKey = null;
};
$("poster-select").onchange = () => {
  finishPath();
  current = Number($("poster-select").value);
  render();
};
$("previous").onclick = () => {
  finishPath();
  current--;
  render();
};
$("next").onclick = () => {
  finishPath();
  current++;
  render();
};
$("annotation-scope").onchange = () => {
  if (!issue() || conflict) return;
  finishPath();
  remember();
  if ($("annotation-scope").value === "full_poster")
    issue().scope = "full_poster";
  else delete issue().scope;
  typing = false;
  changed();
  renderIssues();
};
$("add-region").onclick = () => {
  finishPath();
  remember();
  const label = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    .split("")
    .find((l) => !entry().issues.some((i) => i.label === l));
  entry().issues.push({ label, explanation: "", paths: {} });
  selected = label;
  changed();
  renderIssues();
};
$("remove-region").onclick = () => {
  if (!selected) return;
  cancelPath();
  remember();
  entry().issues = entry().issues.filter((i) => i.label !== selected);
  selected = entry().issues[0]?.label ?? null;
  changed();
  renderIssues();
};
$("undo").onclick = () => {
  if (draft) {
    undoPoint();
    return;
  }
  const prev = undoStack.pop();
  if (!prev) return;
  state.cases[prev.id] = prev.entry;
  current = dataset.cases.findIndex((c) => c.id === prev.id);
  render();
  save();
};
$("explanation").onfocus = () => {
  typing = false;
};
$("explanation").oninput = () => {
  if (!issue() || conflict) return;
  if (!typing) {
    remember();
    typing = true;
  }
  issue().explanation = $("explanation").value;
  entry().ready = false;
  entry().updatedAt = new Date().toISOString();
  refresh();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
};
$("mark-ready").onclick = () => {
  finishPath();
  try {
    const next = structuredClone(state);
    next.cases[item().id].ready = true;
    validateAnnotations(next, dataset);
    remember();
    state = next;
    state.cases[item().id].updatedAt = new Date().toISOString();
    refresh();
    save();
  } catch (e) {
    $("ready-status").textContent = e.message;
    $("ready-status").classList.add("error");
  }
};
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("export").onclick = () => {
  finishPath();
  download(
    new Blob(
      [
        JSON.stringify(
          {
            ...state,
            exportedAt: new Date().toISOString(),
            scopePolicy:
              "issues with scope full_poster apply to the entire poster and do not require geometry; omitted scope means a specific region",
            coordinateSystem:
              "normalized original image coordinates; each paths[imageKey] is an ordered array of {x,y} vertices; paths with 3 or more vertices are implicitly closed from last to first; 2-vertex paths remain open",
            examples: dataset.cases.map((c) => ({
              ...c,
              humanVerdict: "fail",
              judgeVerdict: "pass",
              annotation: state.cases[c.id] ?? null,
            })),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    `geography-annotations-${dataset.id}.json`,
  );
};
async function png(key, img) {
  finishPath();
  if (!img.complete || !img.naturalWidth) return;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const w = canvas.width,
    h = canvas.height,
    stroke = Math.max(4, w / 220),
    font = Math.max(30, w * 0.045);
  for (const i of entry().issues) {
    const points = i.paths[key];
    if (i.scope === "full_poster" || !points) continue;
    ctx.strokeStyle = "#c52c15";
    ctx.lineWidth = stroke;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    points.forEach((p, index) =>
      index ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h),
    );
    if (points.length >= 3) ctx.closePath();
    ctx.stroke();
    ctx.font = `bold ${font}px system-ui`;
    const p = points[0],
      x = Math.min(p.x * w + stroke, w - font * 1.2),
      y = Math.max(font, Math.min(p.y * h + font, h - stroke));
    ctx.fillStyle = "#c52c15";
    ctx.fillRect(x - stroke, y - font, font * 1.1, font * 1.2);
    ctx.fillStyle = "white";
    ctx.fillText(i.label, x, y - font * 0.03);
  }
  canvas.toBlob((blob) => {
    if (blob)
      download(blob, `${item().id}-${key.replace(":", "-")}-annotated.png`);
  }, "image/png");
}
$("download-candidate").onclick = () => png("candidate", $("candidate-image"));
$("download-reference").onclick = () => png(referenceKey, $("reference-image"));
for (const id of ["finish-line", "large-finish"]) $(id).onclick = finishPath;
for (const id of ["undo-point", "large-undo-point"]) $(id).onclick = undoPoint;
$("cancel-line").onclick = cancelPath;
document.addEventListener("keydown", (e) => {
  if (["TEXTAREA", "INPUT", "SELECT"].includes(e.target.tagName)) return;
  if (e.key === "Enter" && draft) {
    e.preventDefault();
    finishPath();
  }
  if (e.key === "Escape" && draft) {
    e.preventDefault();
    cancelPath();
  }
});
window.addEventListener("beforeunload", (e) => {
  if (draft?.points.length) {
    e.preventDefault();
    e.returnValue = "";
  }
});
$("intro").textContent =
  `${dataset.cases.length} posters where you failed background geography and the updated rubric judge passed. Draw matching regions to build visual teaching examples.`;
for (const [i, c] of dataset.cases.entries()) {
  const o = text("option", `${i + 1}. ${c.label}`);
  o.value = i;
  $("poster-select").append(o);
}
try {
  const cached = localStorage.getItem(storageKey);
  if (cached) state = validateAnnotations(JSON.parse(cached), dataset);
} catch {}
if (!practice) {
  try {
    const res = await fetch("/annotations", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    state = validateAnnotations(data.annotations, dataset);
    revision = data.revision;
    online = true;
    status("Autosave ready · Annotations stay on this computer");
  } catch {
    status(
      "File autosave unavailable · Browser backup and export remain available",
      true,
    );
  }
} else status("Isolated practice annotations; real annotations are unchanged");
loaded = true;
render();
