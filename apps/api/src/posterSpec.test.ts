import assert from "node:assert/strict";
import { test } from "node:test";
import { specToImagePrompt, validatePosterSpec } from "./posterSpec";

const sample = {
  style: {
    name: "Swiss minimal",
    medium: "print poster",
    palette: ["off-white", "red"],
    typography: "Helvetica",
    texture: "paper",
    references: "",
  },
  composition: {
    aspectRatio: "2:3",
    routePlacement: "center",
    titleBlock: "top",
    border: "hairline",
    decorations: [],
  },
  route: {
    treatment: "single accent line",
    color: "red",
    startMarker: "green dot",
    finishMarker: "black dot",
    shapeNotes: "north-south loop",
  },
  geography: [{ kind: "water", name: "lake", placement: "left", treatment: "flat blue" }],
  landmarks: [{ name: "Castle Mountain", kind: "peak", placement: "upper-right", icon: "peak" }],
  text: {
    title: "Bow Valley",
    subtitle: "Sep 5, 2026 · 42.0 km",
    stats: [{ label: "Distance", value: "42.0 km" }],
    rules: "exact spelling",
  },
  grounding: {
    images: [{ index: 1, role: "schematic", legend: "red = route" }],
    rules: ["do not invent geography"],
  },
  negative: ["photorealism"],
  finalPrompt: "Swiss modernist map poster of a red loop.",
};

test("validatePosterSpec accepts a complete spec", () => {
  const spec = validatePosterSpec(sample);
  assert.equal(spec.text.title, "Bow Valley");
  assert.equal(spec.landmarks[0].name, "Castle Mountain");
  assert.equal(spec.landmarks[0].pin, 1);
});

test("validatePosterSpec fills a missing finalPrompt", () => {
  const spec = validatePosterSpec({ ...sample, finalPrompt: "" });
  assert.match(spec.finalPrompt, /1 "Castle Mountain"/);
  assert.match(spec.finalPrompt, /write each name and any icon beside the path/);
  assert.match(spec.finalPrompt, /Bow Valley/);
  assert.match(spec.finalPrompt, /Start marker: green dot/);
  assert.match(spec.finalPrompt, /Finish marker: black dot/);
});

test("validatePosterSpec fallback uses one marker when start and finish match", () => {
  const spec = validatePosterSpec({
    ...sample,
    route: { ...sample.route, startMarker: "combined gold/green disc", finishMarker: "combined gold/green disc" },
    finalPrompt: "",
  });
  assert.match(spec.finalPrompt, /Marker: combined gold\/green disc/);
});

test("validatePosterSpec fallback writes a shared start/finish name on the map", () => {
  const spec = validatePosterSpec({
    ...sample,
    route: {
      ...sample.route,
      startMarker: "combined gold/green disc",
      finishMarker: "combined gold/green disc",
      startName: "Parkridge",
      finishName: "Parkridge",
    },
    finalPrompt: "",
  });
  assert.match(spec.finalPrompt, /Write "Parkridge" at the start\/finish marker/);
  assert.match(spec.finalPrompt, /schematic has no start\/finish text/);
  assert.match(spec.finalPrompt, /Do not put this name in the title block/);
});

test("specToImagePrompt writes distinct start and finish names on the map", () => {
  const prompt = specToImagePrompt(
    validatePosterSpec({
      ...sample,
      route: { ...sample.route, startName: "Camrose", finishName: "Edmonton" },
    }),
  );
  assert.match(prompt, /Write "Camrose" at the start marker and "Edmonton" at the finish marker/);
  assert.match(prompt, /Those markers are a private location index/);
  assert.match(prompt, /These names sit on the map, not in the title block/);
});

test("validatePosterSpec rejects a missing title", () => {
  assert.throws(
    () => validatePosterSpec({ ...sample, text: { ...sample.text, title: "" }, finalPrompt: "x" }),
    /title/,
  );
});

test("validatePosterSpec fallback never emits blank fragments", () => {
  const spec = validatePosterSpec({
    ...sample,
    style: { ...sample.style, name: "", medium: "", palette: [] },
    route: { ...sample.route, treatment: "", color: "" },
    text: { ...sample.text, subtitle: "" },
    finalPrompt: "",
  });
  assert.doesNotMatch(spec.finalPrompt, /Palette: \./);
  assert.doesNotMatch(spec.finalPrompt, /Route:\s+in\s+\./);
  assert.doesNotMatch(spec.finalPrompt, /Subtitle exactly ""/);
  assert.match(spec.finalPrompt, /Create a stylized map poster/);
});

test("specToImagePrompt renders prose without JSON or empty fields", () => {
  const spec = validatePosterSpec({
    ...sample,
    style: { ...sample.style, references: "", texture: "" },
    composition: { ...sample.composition, decorations: [], border: "" },
    grounding: { images: [], rules: [] },
  });
  const prompt = specToImagePrompt(spec);
  assert.doesNotMatch(prompt, /SPEC \(JSON\)/);
  assert.doesNotMatch(prompt, /[{}\[\]]/);
  assert.doesNotMatch(prompt, /References:|Texture:|Border:|Decorations:|Reference images:/);
  assert.match(prompt, /Style: Swiss minimal\./);
  assert.match(prompt, /Palette: off-white, red\./);
  assert.match(prompt, /CRITICAL route fidelity/);
  assert.match(prompt, /Trace that line exactly/);
  assert.match(prompt, /A prettier wrong path is a failed poster/);
  assert.match(prompt, /Never interrupt the line for a label, icon, or decoration/);
  assert.match(prompt, /Route: single accent line, in red\./);
  assert.match(prompt, /Start marker: green dot\. Finish marker: black dot\./);
  assert.match(prompt, /1 "Castle Mountain" \(upper-right; icon: peak\)/);
  assert.match(prompt, /private location index/);
  assert.match(prompt, /A small marker may sit on the route/);
  assert.match(prompt, /offset off the path/);
  assert.match(prompt, /never treat an icon as a destination/);
  assert.match(prompt, /Do not draw the numbers/);
  assert.match(prompt, /Do not add a legend, key, or numbered callouts/);
  assert.match(prompt, /replace every disc with a small on-route marker/);
  assert.match(prompt, /Title, exactly: "Bow Valley"\./);
  assert.match(prompt, /Stats to typeset: Distance 42\.0 km\./);
});

test("specToImagePrompt appends explicit exclusions once", () => {
  const prompt = specToImagePrompt(validatePosterSpec({ ...sample, negative: ["photorealism", "no watermark"] }));
  assert.match(prompt, /Avoid: photorealism; no watermark; no legend strip or color key;/);
  assert.equal(prompt.match(/no watermark/g)?.length, 1);
  assert.match(prompt, /no number-to-name legend or index/);
  assert.match(prompt, /no numbered landmark discs, pin numbers, or numbered callouts/);
  assert.match(prompt, /no scale bar, graphic scale, distance ruler, or map scale/);
  assert.match(prompt, /Do not draw a scale bar, graphic scale, or distance ruler/);
  assert.match(prompt, /no text other than the title block and the listed landmark, trail, region, and start\/finish names/);
  assert.match(prompt, /no different route than the GPS track on the schematic/);
  assert.match(prompt, /no color-to-name legend or trail color key/);
  assert.match(prompt, /no schematic route colors on the finished path/);
  assert.match(prompt, /no schematic ochre or brown wash color on named regions/);
  assert.match(prompt, /no named region drawn away from its lettered wash/);
  assert.match(prompt, /no multi-colored GPS track copied from the schematic/);
  assert.match(prompt, /no smoothed, straightened, shortcut, or invented path/);
  assert.match(prompt, /no labels or landmark illustrations covering, breaking, or replacing the route/);
  assert.match(prompt, /no landmark icon used as a destination or gap in the path/);
});

test("specToImagePrompt drops planner copy that treats numbers as artwork", () => {
  const prompt = specToImagePrompt(
    validatePosterSpec({
      ...sample,
      finalPrompt:
        "Middle-earth map. Numbered sepia discs mark landmarks. Lower cartouche for the title.",
      grounding: {
        images: [{ index: 1, role: "schematic", legend: "red = route" }],
        rules: ["Landmarks are represented solely by numbered circular discs matching their pin index."],
      },
      negative: ["printed landmark text labels", "photorealism"],
    }),
  );
  assert.doesNotMatch(prompt, /Numbered sepia discs mark landmarks/);
  assert.doesNotMatch(prompt, /represented solely by numbered/);
  assert.doesNotMatch(prompt, /printed landmark text labels/);
  assert.match(prompt, /Lower cartouche for the title/);
  assert.match(prompt, /Write each name once/);
  assert.match(prompt, /Copy the route shape as a traced original/);
  assert.match(prompt, /Do not copy the schematic's route colors/);
});

test("specToImagePrompt includes a private trail color key", () => {
  const prompt = specToImagePrompt(
    validatePosterSpec({
      ...sample,
      geography: [
        {
          kind: "trail",
          name: "Porcupine Rim",
          placement: "upper-right",
          color: "teal",
          treatment: "write the name along that stretch",
        },
        ...sample.geography,
      ],
    }),
  );
  assert.match(prompt, /teal = Porcupine Rim/);
  assert.match(prompt, /private trail index/);
  assert.match(prompt, /discard the color/);
  assert.match(prompt, /one continuous line in the poster route color/);
  assert.match(prompt, /same line weight/);
  assert.match(prompt, /Do not draw a color key/);
  assert.doesNotMatch(prompt, /teal stretch of the GPS track/);
  assert.doesNotMatch(prompt, /[{}\[\]]/);
});

test("specToImagePrompt scrubs leftover teal-stretch copy", () => {
  const prompt = specToImagePrompt(
    validatePosterSpec({
      ...sample,
      finalPrompt: "Middle-earth map. Paint the teal stretch of the GPS track. Title at the top.",
    }),
  );
  assert.doesNotMatch(prompt, /teal stretch of the GPS track/);
  assert.match(prompt, /Middle-earth map/);
  assert.match(prompt, /Title at the top/);
});

test("specToImagePrompt tells the model named regions are washes not pins", () => {
  const prompt = specToImagePrompt(
    validatePosterSpec({
      ...sample,
      geography: [
        {
          kind: "neighbourhood",
          name: "Old Strathcona",
          placement: "upper-left",
          treatment: "pale wash",
          letter: "A",
        },
        ...sample.geography,
      ],
    }),
  );
  assert.match(prompt, /neighbourhood Old Strathcona/);
  assert.match(prompt, /CRITICAL region fidelity/);
  assert.match(prompt, /exact footprint/);
  assert.match(prompt, /same place, same extent/);
  assert.match(prompt, /discard both the letter and the ochre/);
  assert.match(prompt, /Paint parks and green space green/);
  assert.match(prompt, /Never copy the schematic's brown or ochre wash/);
  assert.match(prompt, /A = Old Strathcona/);
  assert.match(prompt, /do not draw the letter/i);
  assert.match(prompt, /paint for what it is, not schematic ochre/);
  assert.match(prompt, /do not paint campuses or neighbourhoods brown/);
  assert.doesNotMatch(prompt, /[{}\[\]]/);
});

test("specToImagePrompt describes a route-only poster when there are no named features", () => {
  const prompt = specToImagePrompt(
    validatePosterSpec({
      ...sample,
      geography: [],
      landmarks: [],
    }),
  );
  assert.match(prompt, /route-only poster/i);
  assert.match(prompt, /no landmarks, trail names, or named districts/);
  assert.match(prompt, /no text other than the title block and optional start\/finish names/);
  assert.match(prompt, /no landmark names, trail names, district labels, or invented place names/);
  assert.doesNotMatch(prompt, /relative to water, roads, and landmarks/);
  assert.doesNotMatch(prompt, /Castle Mountain/);
  assert.doesNotMatch(prompt, /listed landmark, trail, region/);
});

test("specToImagePrompt keeps geography without annotations when layers have no names", () => {
  const prompt = specToImagePrompt(
    validatePosterSpec({
      ...sample,
      geography: [{ kind: "water", name: "", placement: "", treatment: "flat blue lakes", color: "", letter: "" }],
      landmarks: [],
    }),
  );
  assert.match(prompt, /no landmarks, trail names, or named districts/);
  assert.match(prompt, /Style roads, water, forest/);
  assert.match(prompt, /flat blue lakes/);
  assert.match(prompt, /relative to water, roads, and land cover/);
  assert.doesNotMatch(prompt, /route-only poster: only the GPS track/i);
  assert.doesNotMatch(prompt, /Castle Mountain/);
});

test("specToImagePrompt explains a route-only reference when present", () => {
  const prompt = specToImagePrompt(
    validatePosterSpec({
      ...sample,
      grounding: {
        images: [
          { index: 1, role: "schematic", legend: "red = route" },
          { index: 2, role: "route-only", legend: "same red line as the schematic" },
        ],
        rules: [],
      },
    }),
  );
  assert.match(prompt, /image 2 is the route-only/);
  assert.match(prompt, /every separate red stroke on it is a required segment/i);
  assert.match(prompt, /same red GPS track/);
  assert.match(prompt, /Do not drop a stroke/);
});

test("specToImagePrompt explains a satellite reference when present", () => {
  const prompt = specToImagePrompt(
    validatePosterSpec({
      ...sample,
      grounding: {
        images: [
          { index: 1, role: "schematic", legend: "red = route" },
          { index: 2, role: "satellite", legend: "real aerial imagery with the GPS track" },
        ],
        rules: [],
      },
    }),
  );
  assert.match(prompt, /image 2 is the satellite/);
  assert.match(prompt, /real aerial photography of the same frame/i);
  assert.match(prompt, /every separate red stroke on it is a required segment/i);
  assert.match(prompt, /Do not copy the photograph/);
  assert.match(prompt, /keep the poster stylized/);
});
