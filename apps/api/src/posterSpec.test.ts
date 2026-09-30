import assert from "node:assert/strict";
import { test } from "node:test";
import { specToImagePrompt, titleFontSizePx, TITLE_CAP_WIDTH_RATIO, validatePosterSpec } from "./posterSpec";

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
  assert.match(spec.finalPrompt, /8% of the poster width/);
  assert.match(spec.finalPrompt, /Do not add a title when the design has none/);
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
  assert.match(prompt, /Route visibility is non-negotiable/);
  assert.match(prompt, /strong contrast with its immediate background/);
  assert.match(prompt, /Title-block safety is non-negotiable/);
  assert.match(prompt, /never on, over, through, or beyond the route/);
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
  assert.match(prompt, /8% of the poster width/);
  assert.match(prompt, /clearly readable when the whole poster is viewed on a phone/);
  assert.match(prompt, /not a zoomed crop/);
  assert.match(prompt, /Do not add a title when the design has none/);
  assert.match(prompt, /Typography: Helvetica\. Large display title/);
  assert.match(prompt, /Title block: top\. Large display title/);
  assert.match(prompt, /no title too small to read when the whole poster is viewed on a phone/);
  assert.match(prompt, /Stats to typeset, exactly: 42\.0 km\./);
  assert.match(prompt, /with no category word added in front/);
  assert.doesNotMatch(prompt, /Distance 42\.0 km/);
  assert.match(prompt, /Typeset each item once/);
  assert.match(prompt, /must not appear as both a large display figure and a labeled line/);
});

test("specToImagePrompt drops labels only when the value already says what it is", () => {
  const prompt = specToImagePrompt(
    validatePosterSpec({
      ...sample,
      text: {
        ...sample.text,
        subtitle: "",
        stats: [
          { label: "Date", value: "Sep 27, 2026" },
          { label: "Distance", value: "10.0 km" },
          { label: "Moving time", value: "1h 5m" },
          { label: "Average speed", value: "14.2 km/h" },
          { label: "Elevation gain", value: "420 m" },
          { label: "Sport", value: "Ride" },
        ],
      },
    }),
  );
  assert.match(
    prompt,
    /Stats to typeset, exactly: Sep 27, 2026 · 10\.0 km · 1h 5m · 14\.2 km\/h · Elevation gain 420 m · Ride\./,
  );
});

test("specToImagePrompt typesets a people credit once and keeps it off the map", () => {
  const prompt = specToImagePrompt(
    validatePosterSpec({
      ...sample,
      text: {
        ...sample.text,
        subtitle: "",
        stats: [
          { label: "Distance", value: "12.4 km" },
          { label: "With", value: "Alex, Jordan, and Sam" },
        ],
      },
    }),
  );
  assert.match(prompt, /Stats to typeset, exactly: 12\.4 km\./);
  assert.match(
    prompt,
    /People who did this activity, typeset once in the title block, exactly: "With Alex, Jordan, and Sam"\./,
  );
  assert.match(prompt, /These are people, not places\. Do not add them to the map/);
  assert.match(prompt, /the people credit "With Alex, Jordan, and Sam"/);
  assert.doesNotMatch(prompt, /With Alex, Jordan, and Sam ·/);
});

test("specToImagePrompt closes the title block when the only stat is the title", () => {
  const prompt = specToImagePrompt(
    validatePosterSpec({
      ...sample,
      text: {
        title: "Chain of Lakes Trail",
        subtitle: "",
        stats: [{ label: "Title", value: "Chain of Lakes Trail" }],
        rules: "",
      },
    }),
  );
  assert.match(prompt, /Title, exactly: "Chain of Lakes Trail"/);
  assert.match(prompt, /Title-block text is closed\. It may contain only the title "Chain of Lakes Trail"/);
  assert.match(prompt, /No stats were supplied\. Do not set a stats line/);
  assert.match(prompt, /The marker is a symbol only/);
  assert.doesNotMatch(prompt, /Stats to typeset/);
  assert.doesNotMatch(prompt, /A distance, date, duration, or speed already says what it is/);
  assert.doesNotMatch(prompt, /Title Chain of Lakes Trail/);
});

test("specToImagePrompt keeps time labels when moving and elapsed are both shown", () => {
  const prompt = specToImagePrompt(
    validatePosterSpec({
      ...sample,
      text: {
        ...sample.text,
        subtitle: "",
        stats: [
          { label: "Moving time", value: "1h 5m" },
          { label: "Elapsed time", value: "1h 20m" },
        ],
      },
    }),
  );
  assert.match(prompt, /Stats to typeset, exactly: Moving time 1h 5m · Elapsed time 1h 20m\./);
});

test("specToImagePrompt does not add a title when the design has none", () => {
  const titled = validatePosterSpec(sample);
  const prompt = specToImagePrompt({
    ...titled,
    text: { ...titled.text, title: "" },
    style: {
      ...titled.style,
      typography:
        "Helvetica. Large display title, clearly readable when the whole poster is viewed on a phone, not a zoomed crop, with the title font at least 8% of the poster width.",
    },
    composition: {
      ...titled.composition,
      titleBlock:
        "top. Large display title, clearly readable when the whole poster is viewed on a phone, not a zoomed crop, with the title font at least 8% of the poster width.",
    },
  });
  assert.match(prompt, /This design has no title\. Do not add one\./);
  assert.doesNotMatch(prompt, /Title, exactly/);
  assert.doesNotMatch(prompt, /8% of the poster width/);
  assert.match(prompt, /Typography: Helvetica\./);
  assert.match(prompt, /Title block: top\./);
  assert.match(prompt, /no invented title/);
});

test("title type is large enough to read on a phone-width poster", () => {
  assert.equal(TITLE_CAP_WIDTH_RATIO, 0.08);
  const phoneWidth = 390;
  assert.ok(titleFontSizePx(phoneWidth) >= 31);
  assert.equal(titleFontSizePx(phoneWidth), 31.2);
});

test("specToImagePrompt appends explicit exclusions once", () => {
  const prompt = specToImagePrompt(validatePosterSpec({ ...sample, negative: ["photorealism", "no watermark"] }));
  assert.match(prompt, /Avoid: photorealism; no watermark; no legend strip or color key;/);
  assert.equal(prompt.match(/no watermark/g)?.length, 1);
  assert.match(prompt, /no number-to-name legend or index/);
  assert.match(prompt, /no numbered landmark discs, pin numbers, or numbered callouts/);
  assert.match(prompt, /no scale bar, graphic scale, distance ruler, or map scale/);
  assert.match(prompt, /Do not draw a scale bar, graphic scale, or distance ruler/);
  assert.match(prompt, /no text other than the supplied title, subtitle, and stats in the title block, and the listed landmark, trail, region, and start\/finish names on the map/);
  assert.match(prompt, /no title-block text other than the supplied title, subtitle, and stats/);
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

test("unannotated prompt keeps geometry, deduplicates text and omits obsolete planner rules", () => {
  const prompt = specToImagePrompt(validatePosterSpec({ ...sample,
    geography: [{ kind: "water", name: "", treatment: "flat blue lakes" }], landmarks: [],
    negative: ["no red route"], finalPrompt: "Invent a new route", grounding: {
      images: sample.grounding.images, rules: ["Print invented text"],
    },
  }));
  assert.match(prompt, /flat blue lakes/);
  assert.match(prompt, /Preserve every segment/);
  assert.match(prompt, /Preserve segment breaks/);
  assert.match(prompt, /Background roads, bridges and shorelines must never become route segments/);
  assert.match(prompt, /Draw the route in red/);
  assert.equal(prompt.match(/42\.0 km/g)?.length, 1);
  assert.equal(prompt.match(/8%/g)?.length, 1);
  assert.doesNotMatch(prompt, /Castle Mountain|numbered|ochre|no red route|Invent a new route|Print invented text/);
});

test("unannotated prompt typesets a people credit once and keeps it off the map", () => {
  const prompt = specToImagePrompt(validatePosterSpec({
    ...sample,
    geography: [{ kind: "water", name: "", treatment: "flat blue lakes" }],
    landmarks: [],
    text: {
      title: "Bow Valley",
      subtitle: "42.0 km",
      stats: [
        { label: "Distance", value: "42.0 km" },
        { label: "With", value: "Alex, Jordan, and Sam" },
      ],
      rules: "",
    },
  }));
  assert.equal(prompt.match(/42\.0 km/g)?.length, 1);
  assert.match(prompt, /People who did this activity, typeset once in the title block, exactly: "With Alex, Jordan, and Sam"/);
  assert.match(prompt, /These are people, not places\. Do not add them to the map/);
  assert.equal(prompt.match(/With Alex, Jordan, and Sam/g)?.length, 1);
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
