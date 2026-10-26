// The director's panel. Every choice becomes words in the keyframe prompt (Krea 2) or the motion prompt (H3).
// `style` is the genre in one sentence (the Film tab and the motion prompt use it). `slots` is the same look in parts:
// Create puts each part in the prompt only while you haven't chosen something for that slot yourself, so a genre's
// "shot on 35mm" never fights the IMAX body you picked, and its moonlight never fights your firelight.
// "auto" in a list = the genre decides (its slot words go in the prompt instead)
const AUTO = {id: "auto", name: "From genre", words: "", tip: "Leave it to the genre: its own words for this go in the prompt."};
export const GENRE_SLOTS = {
  gothic: {medium: "Cinematic live-action film still", mood: "dark and moody gothic horror, drifting mist", body: "shot on 35mm",
           light: "cold blue moonlight against warm candlelight", grade: "high contrast, fine film grain, sharp focus"},
  noir: {medium: "Film noir still", mood: "wet streets, cigarette smoke", era: "set in the 1940s", light: "hard venetian-blind shadows",
         grade: "black-and-white, deep blacks, silver grain"},
  neon: {medium: "Cinematic sci-fi still", mood: "rain-soaked city at night, volumetric haze", light: "magenta and cyan neon reflections",
         kit: "anamorphic flares", grade: "saturated neon colour"},
  fairytale: {medium: "Painterly dark fairy-tale film still", mood: "enchanted forest, fog", light: "shafts of golden light through the fog",
              grade: "rich saturated colour, soft bloom"},
  western: {medium: "Widescreen western film still", mood: "dusty frontier town", light: "harsh desert sun", body: "Kodak film grain",
            grade: "warm ochre palette"},
  music: {medium: "Stylised music video still", mood: "haze, graphic composition", light: "strong silhouette backlight", grade: "bold colour, crisp"},
  documentary: {medium: "Natural documentary still", mood: "handheld realism", light: "available light", kit: "shallow depth of field",
                grade: "true-to-life colour"},
  fantasy: {medium: "Epic fantasy film still", mood: "vast scale, dramatic clouds, rich textures", light: "rim light", grade: "cinematic grade"},
  thriller: {medium: "Cinematic thriller film still", mood: "tense city night, rain on glass", light: "cold sodium streetlight and deep shadow", body: "shot on 35mm",
             grade: "desaturated teal, crisp"},
  romance: {medium: "Romantic drama film still", mood: "intimate and tender", light: "soft golden window light", kit: "shallow depth of field", grade: "warm pastel tones, gentle bloom"},
  period: {medium: "Period drama film still", mood: "a sunlit country estate in the nineteenth century", light: "soft daylight through tall windows", body: "shot on 35mm",
           grade: "painterly, muted greens and creams"},
  scifi: {medium: "Epic science-fiction film still", mood: "vast spacecraft interior, light haze", light: "hard white key light and practical panel lights", kit: "anamorphic flares",
          grade: "clean cool palette"},
  horror: {medium: "Modern horror film still", mood: "a quiet house at night, unnerving stillness", light: "a single practical lamp, deep darkness", grade: "low-key, greenish shadows, film grain"},
  adventure: {medium: "Sunlit adventure film still", mood: "jungle ruins, drifting mist", light: "dappled sunlight through the canopy", grade: "lush greens and golds"},
  anime: {medium: "Hand-drawn anime film still", mood: "painted backgrounds, expressive", light: "soft cel-shaded light", grade: "clean line art, vivid colour"},
};
export const GENRES = [
  {id: "gothic", name: "Gothic horror", thumb: "gothic.jpg", style: "Cinematic live-action film still, shot on 35mm, dark and moody gothic horror, high contrast, cold blue moonlight against warm candlelight, drifting mist, fine film grain, sharp focus."},
  {id: "noir", c1: "#4a4a52", c2: "#0b0b0d", name: "Film noir", thumb: "noir.jpg", style: "Black-and-white film noir still, 1940s, hard venetian-blind shadows, wet streets, cigarette smoke, deep blacks, silver grain."},
  {id: "neon", c1: "#7a2a8a", c2: "#0a1a2a", name: "Neon sci-fi", thumb: "neon.jpg", style: "Cinematic sci-fi still, rain-soaked city at night, magenta and cyan neon reflections, volumetric haze, anamorphic flares."},
  {id: "fairytale", c1: "#6a5a22", c2: "#0e1a10", name: "Dark fairy tale", thumb: "fairytale.jpg", style: "Painterly dark fairy-tale film still, enchanted forest, shafts of golden light through fog, rich saturated colour, soft bloom."},
  {id: "western", c1: "#8a5a2a", c2: "#1a0e06", name: "Western", thumb: "western.jpg", style: "Widescreen western film still, dusty frontier town, harsh desert sun, warm ochre palette, Kodak film grain."},
  {id: "music", c1: "#5a2a8a", c2: "#0a0612", name: "Music video", thumb: "music.jpg", style: "Stylised music video still, bold colour, strong silhouette backlight, haze, graphic composition, crisp."},
  {id: "documentary", c1: "#3a4a3a", c2: "#0c100c", name: "Documentary", thumb: "documentary.jpg", style: "Natural documentary still, available light, handheld realism, true-to-life colour, shallow depth of field."},
  {id: "fantasy", c1: "#7a5a2a", c2: "#140c08", name: "Epic fantasy", thumb: "fantasy.jpg", style: "Epic fantasy film still, vast scale, dramatic clouds, rim light, rich textures, cinematic grade."},
  {id: "thriller", c1: "#2a4a52", c2: "#06100f", name: "Thriller", thumb: "thriller.jpg", style: "Cinematic thriller film still, shot on 35mm, tense city night, rain on glass, cold sodium streetlight and deep shadow, desaturated teal, crisp."},
  {id: "romance", c1: "#8a5a4a", c2: "#1a0e0c", name: "Romance", thumb: "romance.jpg", style: "Romantic drama film still, intimate and tender, soft golden window light, shallow depth of field, warm pastel tones, gentle bloom."},
  {id: "period", c1: "#5a6a4a", c2: "#10140c", name: "Period drama", thumb: "period.jpg", style: "Period drama film still, shot on 35mm, a sunlit country estate in the nineteenth century, soft daylight through tall windows, painterly, muted greens and creams."},
  {id: "scifi", c1: "#3a4a6a", c2: "#080c14", name: "Sci-fi epic", thumb: "scifi.jpg", style: "Epic science-fiction film still, vast spacecraft interior, light haze, hard white key light and practical panel lights, anamorphic flares, clean cool palette."},
  {id: "horror", c1: "#3a4a3a", c2: "#060806", name: "Modern horror", thumb: "horror.jpg", style: "Modern horror film still, a quiet house at night, unnerving stillness, a single practical lamp, deep darkness, low-key, greenish shadows, film grain."},
  {id: "adventure", c1: "#4a6a2a", c2: "#0c1406", name: "Adventure", thumb: "adventure.jpg", style: "Sunlit adventure film still, jungle ruins, drifting mist, dappled sunlight through the canopy, lush greens and golds."},
  {id: "anime", c1: "#6a4a8a", c2: "#100c1a", name: "Anime", thumb: "anime.jpg", style: "Hand-drawn anime film still, painted backgrounds, expressive, soft cel-shaded light, clean line art, vivid colour."},
];

export const FRAMING = [
  {id: "wide", name: "Wide", words: "Wide shot:"}, {id: "medium", name: "Medium", words: "Medium shot:"},
  {id: "close", name: "Close-up", words: "Close-up:"}, {id: "ecu", name: "Extreme close-up", words: "Extreme close-up:"},
  {id: "ots", name: "Over the shoulder", words: "Over-the-shoulder shot:"}, {id: "low", name: "Low angle", words: "Low-angle shot looking up:"},
  {id: "high", name: "High angle", words: "High-angle shot looking down:"},
];

export const LENS = [
  {id: "auto", name: "Any", words: "", tip: "No focal length in the prompt (a lens kit like fisheye or macro sets its own)."},
  {id: "18", name: "18mm", words: "ultra-wide 18mm lens, deep perspective"}, {id: "35", name: "35mm", words: "35mm lens"},
  {id: "50", name: "50mm", words: "50mm lens, natural perspective"}, {id: "85", name: "85mm", words: "85mm portrait lens, creamy background blur"},
  {id: "135", name: "135mm", words: "135mm telephoto, compressed background"}, {id: "macro", name: "Macro", words: "macro lens, tiny details large"},
];

export const LIGHT = [
  AUTO,
  {id: "moon", name: "Moonlight", words: "cold blue moonlight"}, {id: "candle", name: "Candlelight", words: "warm flickering candlelight"},
  {id: "golden", name: "Golden hour", words: "low golden-hour sun"}, {id: "neon", c1: "#7a2a8a", c2: "#0a1a2a", name: "Neon", words: "saturated neon light"},
  {id: "overcast", name: "Overcast", words: "soft overcast light"}, {id: "back", name: "Backlit", words: "strong backlight, glowing rim light"},
  {id: "fire", name: "Firelight", words: "orange firelight from below"}, {id: "storm", name: "Lightning", words: "stark lightning flashes in a storm"},
];

export const GRADE = [
  {id: "none", name: "Natural", words: ""}, {id: "teal", name: "Teal & orange", words: "teal and orange colour grade"},
  {id: "bleach", name: "Bleach bypass", words: "bleach-bypass desaturated grade"}, {id: "mono", name: "Monochrome", words: "black-and-white"},
  {id: "techni", name: "Technicolor", words: "vivid three-strip Technicolor colour"}, {id: "faded", name: "Faded film", words: "faded 1970s film stock"},
  {id: "steel", name: "Cold steel", words: "cold steel-blue grade"},
];

export const MOVES = [
  {id: "static", name: "Locked off", words: "The camera holds perfectly still."},
  {id: "push", name: "Slow push in", words: "The camera pushes in slowly."},
  {id: "pull", name: "Pull-back reveal", words: "The camera pulls back slowly to reveal the space."},
  {id: "orbit", name: "Orbit", words: "The camera slowly circles the subject."},
  {id: "crane", name: "Crane up", words: "The camera cranes up and rises above the scene."},
  {id: "track", name: "Tracking", words: "The camera tracks alongside the subject."},
  {id: "hand", name: "Handheld", words: "Handheld camera, subtle natural shake."},
  {id: "dolly", name: "Dolly zoom", words: "A slow dolly-zoom: the background stretches while the subject stays the same size."},
];

export const ASPECTS = [{id: "9:16", w: 768, h: 1344}, {id: "16:9", w: 1344, h: 768}, {id: "1:1", w: 1024, h: 1024}];

export function keyframePrompt({genre, framing, lens, light, grade, subject}) {
  const parts = [genre?.style || "", `${framing?.words || ""} ${subject || ""}`.trim()];
  const look = [light?.words, lens?.words, grade?.words].filter(Boolean).join(", ");
  if (look) parts.push(look[0].toUpperCase() + look.slice(1) + ".");
  return parts.filter(Boolean).join(" ");
}

// What H3 is told it hears. A shot told only "quiet room tone" came out silent whenever a last frame was pinned (a light
// change: -91 dB on three seeds); told the scene itself as sound, it played it on every seed, pinned or not.
export function soundPrompt({subject = "", action = "", sound = ""} = {}) {
  if (sound.trim()) return sound.trim();
  const scene = [subject.trim(), action.trim()].filter(Boolean).join("; ").replace(/[.;,\s]+$/, "");
  return scene ? `The sound of the scene as it happens, ${scene}. Everything in the picture is heard: its people and creatures, their steps and movements, the place around them.` : "";
}
// look: a film's own look line (its light and stock), said in full, with the light held: H3 lit SÉANCE's red-lamp
// parlour like a showroom within a second when nothing said what the light was. A camera direction in the action wins
// over a film's default move (it said "pushes in" after the action said "holds still"). An action that changes the light
// itself (a sword catches fire, the lamp goes out, the sun comes up) isn't told the light stays: H3 would keep it.
const LIGHT_CHANGES = /\b(ignites?|catch(es)? fire|flares?|flaring|explod\w*|floods?|roars? back|races? up|blazes? up|brighten\w*|brighter|sunlight|sunrise|dawn|darken\w*|goes out|gutters?|dies)\b/i;
export function motionPrompt({genre, move, action, look = null}) {
  const sc = look || (genre?.style || "").split(",")[0];
  const act = (action || "subtle natural motion").trim().replace(/[.\s]+$/, "");
  const cam = look && /\bcamera\b/i.test(act) ? "" : (move?.words || "");      // (Create's chosen move always stands)
  return [`${sc.replace(/[.\s]+$/, "")}.`, `The scene begins exactly as shown in the first frame and comes alive: ${act}.`,
    look && !LIGHT_CHANGES.test(act) ? "The light, its colour and the shadows stay exactly as in the first frame from start to end." : "", cam].filter(Boolean).join(" ").trim();
}

// ---------------------------------------------------------------- Edit: looks (anchor prompt for Krea, description for H3)
// {T} is replaced with the target as the user typed it ("the man", "her dress", ...). rb: Krea's faithfulness to the
// original (low: the look takes over, a whole new face; high: the shape stays and only the material changes). who: what
// H3 is told it is when no target is named. keep: what follows the new first frame. Every thumbnail is the look made on
// one of the SÉANCE cast's costume-test sheets by the Transform's own first step (tools/look_thumbs.mjs).
// A reference picture (dropped, or painted from words) can go with any look, or be the look on its own (OWN_LOOK).
export const LOOK_GROUPS = [
  {id: "element", name: "Elements"}, {id: "material", name: "Materials"}, {id: "light", name: "Light & tech"}, {id: "costume", name: "Costume"},
  {id: "age", name: "Age & weather"}, {id: "spirit", name: "Spirits"}, {id: "creature", name: "Creatures"},
];
const KEEP_ALL = "Keep the pose, the camera angle, the framing, the background and the lighting exactly the same.";
const KEEP_FACE = "Keep the face, the pose, the camera angle, the framing, the background and the lighting exactly the same.";
const look = (group, id, name, rb, who, keep, anchor, desc) => ({group, id, name, thumb: `looks/${id}.jpg`, rb, who, keep, anchor, desc});
// a creature or a spirit replaces the face (low rb); a material keeps the shape (high rb); a costume keeps the face
const creature = (id, name, rb, what, desc) => look("creature", id, name, rb, "the person", "the face, skin and head", `Transform {T} into ${what}. Inhuman and convincing, photographed for real. ${KEEP_ALL}`, desc);
const spirit = (id, name, rb, what, desc) => look("spirit", id, name, rb, "the person", "the face, the clothes and the light on them", `Transform {T} into ${what}. ${KEEP_ALL}`, desc);
const aged = (id, name, rb, what, desc) => look("age", id, name, rb, "the person", "the face and the clothes", `Make {T} ${what}. ${KEEP_ALL}`, desc);
const material = (id, name, rb, what, desc) => look("material", id, name, rb, "the subject", "the material, its texture and the light on it", `Turn {T} into ${what}. Keep the pose, the framing and everything else exactly the same.`, desc);
const element = (id, name, rb, what, desc) => look("element", id, name, rb, "the subject", "the material, colour and light", `Turn {T} into ${what}. Keep everything else exactly the same.`, desc);
const costume = (id, name, rb, what, desc) => look("costume", id, name, rb, "the person", "the face and the costume", `Dress {T} in ${what}. ${KEEP_FACE}`, desc);
const light = (id, name, rb, what, desc) => look("light", id, name, rb, "the subject", "the light, its colour and the shape", `Turn {T} into ${what}. Keep the pose, the framing and everything else exactly the same.`, desc);
export const LOOKS = [
  // creatures
  creature("werewolf", "Werewolf", .5, "a werewolf: a wolf's head with a long snout, bared fangs and yellow eyes, coarse grey-brown fur over the face, neck and hands, clawed fingers, still in the same clothes",
    "a werewolf: a wolf's head with a long snout, bared fangs, yellow eyes, coarse grey-brown fur and clawed hands, in the same clothes"),
  creature("zombie", "Zombie", .6, "a rotting zombie: grey-green mottled skin, cracked lips, clouded white eyes in dark sunken sockets, lank hair, the same clothes torn and dirty",
    "a rotting zombie with grey-green mottled skin, cracked lips and clouded white eyes, in torn dirty clothes"),
  creature("demon", "Demon", .5, "a demon: dark red skin, curved black horns rising from the forehead, glowing ember-orange eyes, sharp cheekbones and pointed teeth",
    "a demon with dark red skin, curved black horns, glowing ember-orange eyes and pointed teeth"),
  creature("orc", "Orc", .5, "an orc: green-grey skin, a heavy brow, small tusks jutting up from the lower jaw, a broad flat nose and old battle scars",
    "an orc with green-grey skin, a heavy brow, small tusks and a broad flat nose"),
  creature("elf", "Elf", 1.0, "an elf: long pointed ears, fine sharp features, luminous pale skin, long silver hair",
    "an elf with long pointed ears, fine features, luminous pale skin and long silver hair"),
  creature("alien", "Grey alien", .4, "a grey alien: smooth grey skin, a large bald head, huge black almond eyes, a tiny mouth and no nose",
    "a grey alien with smooth grey skin, a large bald head and huge black almond eyes"),
  creature("android", "Android", .6, "an android: the face and hands made of white plastic panels with fine seams, glowing circuitry showing at the jaw and neck, glassy blue eyes",
    "an android made of white plastic panels with fine seams, glowing circuitry at the jaw and neck and glassy blue eyes"),
  creature("reptile", "Reptilian", .5, "a reptilian creature: green scaled skin, slit golden eyes, a flat nose and a thin lipless mouth",
    "a reptilian creature with green scaled skin and slit golden eyes"),
  creature("mummy", "Mummy", .5, "an ancient mummy: wrapped in yellowed, frayed linen bandages, dark sunken eyes showing between the wraps",
    "an ancient mummy wrapped in yellowed, frayed linen bandages"),
  look("creature", "skeleton", "Skeleton", .6, "the person", "the bones and clothing",
    "Turn {T} into a living skeleton: bare bone skull and bony hands, the same clothes hanging loose. Keep the pose, the framing and everything else exactly the same.",
    "a living skeleton with a bare bone skull and bony hands, wearing the same clothes"),
  look("creature", "vampire", "Vampire", .5, "the person", "the face, skin and head",
    "Transform {T} into a grotesque monstrous vampire: a gaunt, skull-like corpse face with grey-green leathery skin stretched over the bones, sunken dark eye sockets with burning red eyes, a wide mouth full of long jagged fangs, pointed bat-like ears. Inhuman and terrifying. Keep the pose, the camera angle, the framing, the background and the lighting exactly the same.",
    "a grotesque monstrous vampire: a gaunt skull-like corpse face, sunken eye sockets with burning red eyes, long jagged fangs and pointed bat-like ears"),
  // spirits
  spirit("ghost", "Ghost", 2.0, "a ghost: translucent and pale blue-white, the edges of the body fading into mist, the eyes hollow and faintly glowing",
    "a translucent pale blue-white ghost whose edges fade into mist"),
  spirit("wraith", "Wraith", .6, "a wraith: a tattered black hooded shroud, the face a shadowed void with two cold pinpoints of light, wisps of black smoke trailing off",
    "a wraith in a tattered black hooded shroud, its face a shadowed void with two cold pinpoints of light"),
  spirit("drowned", "Drowned", 1.5, "someone drowned: soaking wet, lank wet hair plastered to the face, waterlogged blue-grey skin, clouded milky eyes, strands of pondweed, water dripping",
    "drowned and soaking wet, with lank wet hair, waterlogged blue-grey skin, clouded milky eyes and strands of pondweed"),
  spirit("shadow", "Living shadow", .8, "a living shadow: a figure of pure black shadow with soft smoky edges, the same silhouette, two faint glowing eyes",
    "a figure of living black shadow with soft smoky edges and two faint glowing eyes"),
  spirit("angel", "Angel", 1.5, "an angel: luminous skin, a soft ring of golden light behind the head, white feathered wings folded behind the shoulders",
    "an angel with luminous skin, a soft golden halo and white feathered wings"),
  look("spirit", "bride", "Ghost bride", 4.0, "the person", "the veil, the gown and her face",
    "Transform {T} into a ghost bride: a long torn lace wedding veil flowing from the hair and around the shoulders, a gown of tattered ghostly lace that dissolves into mist, pale blue-white translucent skin. Keep the face, the pose, the camera angle, the framing, the background and the lighting exactly the same.",
    "a ghost bride: a long torn lace wedding veil, a gown of tattered ghostly lace that dissolves into mist, pale blue-white translucent skin"),
  // age & weather
  aged("old", "Aged", 1.5, "fifty years older: deep wrinkles, thin white hair, age spots and sagging skin, the same face grown old", "fifty years older, with deep wrinkles, thin white hair and age spots"),
  look("age", "frozen", "Frozen", .5, "the person", "the face and the clothes",
    "Cover {T} in snow and thick white hoarfrost, as if frozen in a blizzard: frost crusted white on the hair, eyebrows and eyelashes, snow caked on the shoulders and clothes, small icicles, the lips blue and the skin pale with cold. Keep the pose, the camera angle, the framing, the background and the lighting exactly the same.",
    "frozen solid, crusted in thick white frost and ice crystals, with icicles hanging and pale blue skin"),
  aged("worn", "Battle-worn", 1.5, "battle-worn: a face streaked with dirt, soot and sweat, a healed scar across the brow, the clothes torn and scorched", "battle-worn, streaked with dirt and soot, with a scar across the brow and torn scorched clothes"),
  aged("overgrown", "Overgrown", 1.2, "overgrown: moss, lichen and small ferns growing over the skin and clothes, ivy wrapping the arms and neck, tiny white flowers", "overgrown with moss, lichen, ferns and ivy, with tiny white flowers"),
  aged("soaked", "Caught in rain", 1.0, "drenched by heavy rain: the hair soaking wet and plastered flat to the head, water streaming down the face, glistening wet skin, the clothes soaked dark and dripping", "drenched by heavy rain, the hair plastered flat, water streaming down the face, the clothes soaked dark"),
  // materials
  material("bronze", "Bronze statue", 1.5, "a weathered bronze statue: dark bronze with green verdigris in the creases and polished highlights on the raised parts", "a weathered bronze statue with green verdigris in the creases"),
  material("stone", "Marble statue", 1.5, "a carved white marble statue with grey veins and fine chisel marks", "carved white marble with grey veins and fine chisel marks"),
  material("gold", "Gold", 1.5, "solid polished gold: a gleaming gold statue with mirror-bright highlights and warm reflections", "solid polished gold with mirror-bright highlights"),
  material("chrome", "Liquid chrome", 4.0, "flowing liquid chrome: a mirror-polished metal that ripples like mercury and reflects the room around it", "flowing liquid chrome, a mirror-polished metal that ripples like mercury and reflects its surroundings"),
  material("porcelain", "Porcelain", 1.5, "a porcelain doll: glossy white porcelain skin with fine hairline cracks, painted rosy cheeks and lips, glass eyes", "a porcelain doll with glossy white skin, fine hairline cracks and glass eyes"),
  material("glass", "Glass", 1.5, "clear glass: the whole figure, clothes and all, cast in transparent glass that bends the background through it, with bright edges and caustic highlights", "clear transparent glass, clothes and all, bending the background through it, with bright edges"),
  material("ice", "Ice sculpture", 1.5, "carved ice: a translucent ice sculpture with frosted surfaces, clear edges and trapped bubbles, cold light shining through it", "a translucent carved ice sculpture with frosted surfaces and trapped bubbles"),
  material("wood", "Carved wood", 1.5, "a carved wooden figure: polished wood with visible grain, chisel marks and dark knots", "polished carved wood with visible grain and chisel marks"),
  material("clay", "Clay", .45, "a claymation puppet: the face, hair and clothes all sculpted from smooth matte plasticine in simple colours, rounded and hand-made, with thumbprints and tool marks, like a stop-motion film", "a stop-motion clay puppet, face, hair and clothes sculpted from soft terracotta plasticine with thumbprints"),
  material("paper", "Folded paper", 1.5, "folded paper: crisp white paper folded in origami facets with sharp creases and soft shadows", "crisp white paper folded in origami facets"),
  material("crystal", "Crystal", 1.5, "amethyst crystal: faceted violet crystal with light glinting off the facets and clusters of crystal points", "faceted violet amethyst crystal with light glinting off the facets"),
  material("obsidian", "Obsidian", 1.5, "black obsidian: glossy volcanic glass with sharp curved fractures catching the light", "glossy black obsidian with sharp curved fractures catching the light"),
  // elements
  element("fire", "Living fire", 4.0, "living fire: flowing flames and glowing molten embers with a white-hot core, throwing warm orange light", "living fire, flowing flames and glowing molten embers with a white-hot core"),
  element("ghostfire", "Ghost-fire", 4.0, "pale blue ghost-fire: translucent spectral flames and drifting wisps of glowing ectoplasm giving off cold white-blue light", "pale blue ghost-fire, translucent spectral flames and drifting wisps of glowing ectoplasm giving off cold white-blue light"),
  element("smoke", "Smoke & embers", 4.0, "living black smoke with glowing ember-red seams and drifting cinders", "living black smoke with glowing ember-red seams and drifting cinders"),
  element("water", "Water", 2.5, "living water: the figure, clothes and all, made of clear moving water with ripples and droplets, light refracting through it", "clear moving water, clothes and all, with ripples and droplets, light refracting through it"),
  element("lightning", "Lightning", 2.5, "crackling electricity: arcs of blue-white lightning crawling over the surface, glowing where they run", "crackling with arcs of blue-white lightning crawling over the surface"),
  element("sand", "Sand", 1.5, "packed golden sand: the whole figure, clothes and all, made of fine sand, grains streaming away in the wind from its edges", "packed golden sand, clothes and all, grains streaming away in the wind from the edges"),
  element("ash", "Ash", 1.5, "burnt ash: charred black ash with glowing orange cracks, grey flakes drifting off", "charred black ash with glowing orange cracks, flakes drifting off"),
  element("lava", "Molten rock", 2.0, "molten rock: a black cooling crust split by bright orange molten cracks, glowing with heat", "molten rock, a black cooling crust split by glowing orange cracks"),
  element("flowers", "Flowers", 2.0, "a figure made of flowers: densely packed roses, peonies and green leaves, a few petals drifting away", "made of densely packed roses, peonies and leaves, petals drifting away"),
  element("cosmos", "Night sky", 2.0, "a window onto the night sky: the silhouette filled with stars and a glowing violet nebula", "a silhouette filled with stars and a glowing violet nebula"),
  element("ink", "Ink", 2.0, "black ink: glossy liquid ink that drips and bleeds away into the air", "glossy black liquid ink that drips and bleeds away into the air"),
  // costume
  costume("armour", "Plate armour", 2.5, "a full suit of polished medieval steel plate armour with a dark surcoat", "wearing a full suit of polished medieval steel plate armour"),
  costume("astronaut", "Space suit", 2.5, "a white space suit with mission patches, the helmet off", "wearing a white space suit with mission patches"),
  costume("samurai", "Samurai", 2.5, "samurai armour: lacquered black plates laced with red silk cords", "wearing samurai armour of lacquered black plates laced with red silk cords"),
  costume("victorian", "Victorian", 2.5, "Victorian dress: dark velvet with a high collar, lace cuffs and a cameo brooch", "in Victorian dress of dark velvet with a high collar and lace cuffs"),
  costume("royal", "Royal", 2.5, "royal regalia: a jewelled gold crown and a crimson robe trimmed with ermine", "wearing a jewelled gold crown and a crimson robe trimmed with ermine"),
  costume("diver", "Old diving suit", 1.0, "an old brass diving suit: heavy canvas and a brass helmet with round glass portholes", "in an old canvas diving suit with a brass helmet and round portholes"),
  costume("cyber", "Cyberpunk", 2.5, "cyberpunk techwear: a black jacket with glowing cyan light strips and a chrome implant at the temple", "in black cyberpunk techwear with glowing cyan light strips"),
  // light & tech
  light("hologram", "Hologram", 2.0, "a hologram: translucent cyan light with scanlines and flickering edges", "a translucent cyan hologram with scanlines and flickering edges"),
  light("biolum", "Bioluminescent", 2.5, "a bioluminescent creature of the deep: glowing blue-green patterns along the skin, softly lit in the dark", "glowing with bioluminescent blue-green patterns along the skin"),
  light("runes", "Glowing runes", 3.0, "someone marked with glowing golden runes and sigils carved across the skin and clothes, lit from within", "marked with glowing golden runes and sigils, lit from within"),
  light("neon", "Neon", 2.0, "a figure outlined in glowing neon tubes, magenta and cyan, against shadow", "outlined in glowing magenta and cyan neon tubes"),
  light("xray", "X-ray", .8, "an x-ray: a glowing blue-white x-ray image with the skeleton visible through translucent flesh", "a glowing blue-white x-ray image, the skeleton visible through translucent flesh"),
];
// your own look: words, a reference picture, or both
export const OWN_LOOK = {id: "own", name: "Your own look", rb: 1.0, who: "the subject", keep: "the look in the reference picture"};
export function ownLook({words = "", ref = false} = {}) {
  const w = words.trim().replace(/[.\s]+$/, "");
  const what = w || "the look in the reference picture";
  return {...OWN_LOOK, ref,
    anchor: `Transform {T} into ${what}${ref ? ", exactly as in the reference picture: its shape, materials, colours and details" : ""}. Keep the pose, the camera angle, the framing, the background and the lighting exactly the same.`,
    desc: w ? `${w}${ref ? ", as in the reference picture" : ""}` : "the look shown in the reference picture"};
}
// the painted reference: a clean costume-test picture of the look, so Krea and H3 read it as one subject
export function lookRefPrompt(words) {
  return `A clean reference photograph of ${words.trim().replace(/[.\s]+$/, "")}, seen whole and in sharp focus, on a plain neutral grey background, soft even studio light, no text.`;
}

export const REMOVE_PROMPT = "Remove {T} from the picture completely: show only what is behind it, the background continuing naturally where it was. Keep everything else in the picture exactly the same.";

// ---------------------------------------------------------------- Cinema Studio (Higgsfield-style director controls)
// Every control is words: the keyframe prompt (Krea 2) takes the camera body, lens, era, light and look; the motion
// prompt (H3) takes the camera move, the tempo and the emotion. Moves are phrased the way H3 follows them best.
// tested on H3 i2v (Oct 19, one keyframe): works = crash_zoom_in (as a fast push), fpv_drone, whip_pan; partial = orbit_360
// (half orbit), crane_overhead (rose over the river); weak = dolly_zoom_in (plain push-in). The four weak/partial ones were reworded.
export const CAMERA_MOVES = [
  // basic
  {id: "static", group: "Basic", name: "Static", words: "The camera is locked off on a tripod and does not move at all."},
  {id: "push_in", group: "Basic", name: "Push in", words: "The camera pushes in slowly and steadily toward the subject."},
  {id: "pull_out", group: "Basic", name: "Pull out", words: "The camera pulls back slowly, revealing more and more of the surroundings."},
  {id: "pan_left", group: "Basic", name: "Pan left", words: "The camera pans slowly to the left on a fixed tripod."},
  {id: "pan_right", group: "Basic", name: "Pan right", words: "The camera pans slowly to the right on a fixed tripod."},
  {id: "tilt_up", group: "Basic", name: "Tilt up", words: "The camera tilts slowly upward from the ground to the sky."},
  {id: "tilt_down", group: "Basic", name: "Tilt down", words: "The camera tilts slowly downward from the sky to the ground."},
  {id: "zoom_in", group: "Basic", name: "Zoom in", words: "A smooth optical zoom in; the camera itself stays in place."},
  {id: "zoom_out", group: "Basic", name: "Zoom out", words: "A smooth optical zoom out; the camera itself stays in place."},
  {id: "handheld", group: "Basic", name: "Handheld", words: "Handheld camera with a subtle natural shake, following the action."},
  // dolly
  {id: "dolly_left", group: "Dolly", name: "Truck left", words: "The camera trucks sideways to the left, gliding parallel to the subject."},
  {id: "dolly_right", group: "Dolly", name: "Truck right", words: "The camera trucks sideways to the right, gliding parallel to the subject."},
  {id: "super_dolly_in", group: "Dolly", name: "Super dolly in", words: "A fast, dramatic dolly-in from a wide shot all the way to a close-up of the subject's face."},
  {id: "super_dolly_out", group: "Dolly", name: "Super dolly out", words: "A fast dolly-out from a close-up of the subject's face all the way back to a wide shot."},
  {id: "dolly_zoom_in", group: "Dolly", name: "Dolly zoom in", words: "A dolly zoom, the vertigo effect: the subject stays exactly the same size and in the same place in the frame the whole time, while everything behind them stretches away and shrinks into the distance, the horizon receding and the background warping."},
  {id: "dolly_zoom_out", group: "Dolly", name: "Dolly zoom out", words: "A reverse dolly zoom: the camera moves away while zooming in, so the subject stays the same size while the background rushes forward and looms."},
  // crane
  {id: "crane_up", group: "Crane", name: "Crane up", words: "The camera cranes up smoothly, rising high above the scene."},
  {id: "crane_down", group: "Crane", name: "Crane down", words: "The camera cranes down smoothly from high above to the subject's eye level."},
  {id: "crane_overhead", group: "Crane", name: "Crane over the head", words: "The camera rises straight up above the subject and tilts down as it climbs, ending directly overhead looking straight down on the top of their head; the subject stays in the centre of the frame."},
  {id: "top_down", group: "Crane", name: "Top-down", words: "A top-down overhead shot looking straight down on the subject; the camera slowly rotates."},
  {id: "low_angle_hero", group: "Crane", name: "Hero rise", words: "A low-angle hero shot: the camera rises slowly from the ground, looking up at the subject."},
  // orbit
  {id: "arc_left", group: "Orbit", name: "Arc left", words: "The camera arcs around the subject to the left, keeping them centred in frame."},
  {id: "arc_right", group: "Orbit", name: "Arc right", words: "The camera arcs around the subject to the right, keeping them centred in frame."},
  {id: "orbit_360", group: "Orbit", name: "360 orbit", words: "The camera circles the subject in one complete 360-degree orbit, passing behind them and coming all the way round to the front again, keeping them centred the whole time."},
  {id: "lazy_susan", group: "Orbit", name: "Turntable", words: "The subject slowly rotates in place as if on a turntable while the camera stays still."},
  {id: "bullet_time", group: "Orbit", name: "Bullet time", words: "Bullet time: the action freezes in mid-moment, and the camera sweeps around the frozen subject in a smooth arc."},
  // dynamic
  {id: "crash_zoom_in", group: "Dynamic", name: "Crash zoom in", words: "A crash zoom: in the first second the lens snaps from the wide shot to an extreme close-up of the subject's face, with a jolt of motion blur, then holds on the face."},
  {id: "crash_zoom_out", group: "Dynamic", name: "Crash zoom out", words: "A sudden crash zoom out from the subject's face to a wide shot."},
  {id: "whip_pan", group: "Dynamic", name: "Whip pan", words: "A whip pan: the camera swings fast to the side with heavy motion blur, then whips straight back and settles on the subject."},
  {id: "fpv_drone", group: "Dynamic", name: "FPV drone", words: "An FPV drone shot: the camera flies fast and low through the scene, banking and diving past the subject."},
  {id: "helicopter", group: "Dynamic", name: "Helicopter", words: "An aerial helicopter shot, high above, sweeping slowly across the landscape toward the subject."},
  {id: "snorricam", group: "Dynamic", name: "Snorricam", words: "A snorricam shot: the camera is rigidly mounted to the subject's body, their face fixed in frame while the world swings wildly behind them."},
  {id: "robo_arm", group: "Dynamic", name: "Robo arm", words: "A robotic camera arm move: a precise, fast sweep that swings around the subject and stops dead."},
  {id: "head_tracking", group: "Dynamic", name: "Head tracking", words: "The camera tracks the subject's head closely as they move, always keeping the face centred."},
  {id: "follow", group: "Dynamic", name: "Follow", words: "The camera follows close behind the subject as they walk forward."},
  {id: "lead", group: "Dynamic", name: "Lead", words: "The camera leads in front of the subject, moving backwards as they walk toward it."},
  {id: "car_chase", group: "Dynamic", name: "Car chase", words: "A car-chase tracking shot: the camera speeds alongside the moving vehicle at road level."},
  {id: "through_in", group: "Dynamic", name: "Through object", words: "The camera pushes forward through a gap in the foreground and into the scene beyond."},
  {id: "pov", group: "Dynamic", name: "POV", words: "First-person point of view: we see through the subject's own eyes as they move."},
  {id: "eyes_in", group: "Dynamic", name: "Into the eye", words: "The camera pushes all the way into the subject's eye until the pupil fills the frame."},
  {id: "earth_zoom_out", group: "Dynamic", name: "Earth zoom out", words: "The camera zooms out continuously and very fast from the subject, up through the clouds, until the whole Earth is seen from space."},
  {id: "dutch", group: "Dynamic", name: "Dutch roll", words: "A canted Dutch angle; the camera slowly rolls further off-axis."},
  {id: "rack_focus", group: "Dynamic", name: "Rack focus", words: "A rack focus: the focus shifts from the foreground to the subject in the background."},
  {id: "hyperlapse", group: "Dynamic", name: "Hyperlapse", words: "A hyperlapse: the camera glides forward in fast motion while people and clouds race by."},
];

export const BODIES = [
  AUTO,
  {id: "digital", name: "Digital cinema", words: "shot on a large-format digital cinema camera, clean and sharp"},
  {id: "35mm", name: "35mm film", words: "shot on 35mm film, natural grain, rich colour"},
  {id: "16mm", name: "16mm film", words: "shot on 16mm film, visible grain, soft and warm"},
  {id: "super8", name: "Super 8", words: "a frame of faded Super 8 home-movie film: heavy grain, warm light leaks, soft focus, gate weave"},
  {id: "imax", name: "IMAX 65mm", words: "IMAX 65mm photography, immense detail and scale"},
  {id: "dv", name: "DV camcorder", words: "a frame of early-2000s DV camcorder video: flat digital colour, harsh sharpening, clipped white highlights, interlaced edges"},
  {id: "vhs", name: "VHS camcorder", words: "a frame of worn 1980s VHS home video: low resolution, smeared bleeding colour, soft focus, tape noise and tracking lines"},
  {id: "phone", name: "Phone", words: "a frame of vertical smartphone video: natural, immediate, slightly over-sharpened, auto exposure"},
  {id: "action", name: "Action cam", words: "a frame of action-camera video: ultra-wide fisheye view, punchy colour, deep focus"},
  {id: "cctv", name: "Security cam", words: "a frame of grainy security-camera video seen from a high fixed corner angle: washed-out colour, low resolution, a timestamp-free surveillance look"},
  {id: "silent", name: "Silent film", words: "a frame of a 1920s hand-cranked silent film: flickering, scratched, soft black-and-white"},
];

export const LENS_KITS = [
  AUTO,
  {id: "spherical", name: "Clean primes", words: "clean modern spherical prime lens"},
  {id: "anamorphic", name: "Anamorphic", words: "anamorphic lens, oval bokeh, horizontal blue lens flares"},
  {id: "vintage", name: "Vintage", words: "vintage lens, soft glowing highlights, swirly bokeh"},
  {id: "macro", name: "Macro", words: "macro lens, tiny details large"},
  {id: "fisheye", name: "Fisheye", words: "fisheye lens, strong barrel distortion"},
];

export const ERAS = [
  AUTO,
  {id: "1920s", name: "1920s", words: "set in the 1920s, period costume and props", look: "sepia"},
  {id: "1940s", name: "1940s", words: "set in the 1940s, period costume and props", look: "noir"},
  {id: "1950s", name: "1950s", words: "set in the 1950s, period costume and props", look: "technicolor"},
  {id: "1960s", name: "1960s", words: "set in the 1960s, period costume and props", look: "kodachrome"},
  {id: "1970s", name: "1970s", words: "set in the 1970s, period costume and props", look: "faded_70s"},
  {id: "1980s", name: "1980s", words: "set in the 1980s, period costume and props", look: "vhs"},
  {id: "1990s", name: "1990s", words: "set in the 1990s, period costume and props", look: "film_colors"},
  {id: "2000s", name: "2000s", words: "set in the 2000s, period costume and props", look: "camcorder"},
  {id: "2010s", name: "2010s", words: "set in the 2010s", look: "teal_orange"},
  {id: "today", name: "Today", words: "set in the present day", look: "natural"},
];

export const TEMPO = [
  {id: "single", name: "Single shot", words: "One continuous take, no cuts."},
  {id: "calm", name: "Calm", words: "Slow, calm, unhurried movement."},
  {id: "measured", name: "Measured", words: "Deliberate, measured movement."},
  {id: "energetic", name: "Energetic", words: "Fast, energetic movement."},
  {id: "chaotic", name: "Chaotic", words: "Frantic, chaotic movement, everything happening at once."},
];

export const LIGHTING = [
  {id: "auto", name: "None", words: "", tip: "No lighting setup words: the light source above decides."},
  {id: "silhouette", name: "Silhouette", words: "the subject in silhouette against a bright background"},
  {id: "practicals", name: "Practicals", words: "lit only by practical lamps in the scene, pools of warm light"},
  {id: "window", name: "Window", words: "soft directional light from a large window"},
  {id: "overhead", name: "Overhead fall", words: "a single hard overhead light falling on the subject, dark surroundings"},
  {id: "contre_jour", name: "Contre-jour", words: "contre-jour, backlit by the sun, glowing rim light and flare"},
  {id: "soft_cross", name: "Soft cross", words: "soft cross-lighting from both sides, gentle shadows"},
];

export const EMOTIONS = [
  {id: "neutral", name: "Neutral", words: ""},
  {id: "joy", name: "Joy", words: "their face lights up with joy"},
  {id: "sadness", name: "Sadness", words: "they look heartbroken, eyes wet"},
  {id: "fear", name: "Fear", words: "they are terrified, breathing fast"},
  {id: "anger", name: "Anger", words: "they are furious, jaw clenched"},
  {id: "awe", name: "Awe", words: "they stare in awe, mouth slightly open"},
  {id: "tension", name: "Tension", words: "they are tense and watchful"},
  {id: "love", name: "Love", words: "they look on with deep tenderness"},
  {id: "mystery", name: "Mystery", words: "an enigmatic, unreadable expression"},
];

// A Cinema Studio shot: the keyframe prompt and the motion prompt from one set of choices.
// look: a palette key (valis_fx/lib/palette.py LOOKS) whose words go in the keyframe and which can grade the result.
export function cinemaPrompts({subject = "", action = "", move, body, lens, focal, era, tempo, light, emotion, lookWords = "", genre} = {}) {
  const pick = (list, id) => (typeof id === "string" ? list.find((x) => x.id === id) : id) || null;
  const mv = pick(CAMERA_MOVES, move), bd = pick(BODIES, body), lk = pick(LENS_KITS, lens), fc = pick(LENS, focal);
  const er = pick(ERAS, era), tp = pick(TEMPO, tempo), lt = pick(LIGHTING, light), em = pick(EMOTIONS, emotion);
  const look = [bd?.words, lk?.words, fc?.words, lt?.words, lookWords].filter(Boolean).join(", ");
  const keyframe = [genre?.style || "Cinematic film still.", subject ? subject[0].toUpperCase() + subject.slice(1).replace(/\.?$/, ".") : "", er?.words ? er.words[0].toUpperCase() + er.words.slice(1) + "." : "",
    look ? look[0].toUpperCase() + look.slice(1) + "." : ""].filter(Boolean).join(" ");
  const act = [action, em?.words].filter(Boolean).join("; ");
  const motion = `The scene begins exactly as shown in the first frame and comes alive: ${act || "subtle natural motion"}. ${mv?.words || ""} ${tp?.words || ""}`.replace(/\s+/g, " ").trim();
  return {keyframe, motion};
}

// ---------------------------------------------------------------- Genjutsu (video-to-video): restyles and prompts
export const GENJUTSU_STYLES = [
  {id: "clay", name: "Clay stop-motion", words: "a hand-made clay stop-motion animation: plasticine figures with visible thumbprints on a miniature set, warm studio lights, slightly jerky stop-motion movement"},
  {id: "anime", name: "Anime", words: "a hand-drawn Japanese anime film: clean line art, cel shading, painted backgrounds, expressive eyes"},
  {id: "watercolor", name: "Watercolour", words: "a living watercolour painting: soft bleeding pigments, paper texture, loose brush strokes"},
  {id: "oil", name: "Oil painting", words: "a moving oil painting: thick impasto brush strokes, rich colour, canvas texture"},
  {id: "ink", name: "Comic ink", words: "a black-and-white comic book: bold ink lines, cross-hatching, halftone shading"},
  {id: "pixel", name: "Pixel art", words: "16-bit pixel-art video game graphics: chunky pixels, limited palette, sprite animation"},
  {id: "papercraft", name: "Papercraft", words: "a papercraft animation: everything cut and folded from coloured paper and card, layered paper depth"},
  {id: "felt", name: "Felt puppets", words: "a felt puppet show: soft fuzzy felt characters with stitched seams and button details"},
  {id: "toon3d", name: "3D cartoon", words: "a polished 3D animated feature: stylised characters, soft subsurface skin, bright cinematic lighting"},
  {id: "charcoal", name: "Charcoal", words: "a charcoal drawing come to life: smudged black charcoal on rough paper, visible eraser marks"},
  {id: "ukiyoe", name: "Ukiyo-e", words: "a Japanese ukiyo-e woodblock print: flat colour areas, bold outlines, paper grain"},
  {id: "stained", name: "Stained glass", words: "a living stained-glass window: coloured glass panes with thick lead lines, light shining through"},
  {id: "origami", name: "Origami", words: "an origami world: everything folded from crisp paper, sharp creases"},
  {id: "wireframe", name: "Neon wireframe", words: "a glowing neon wireframe hologram on black: cyan and magenta lines, scanlines"},
  {id: "marble", name: "Living marble", words: "living white marble statues in motion: carved stone with grey veins, museum light"},
  {id: "chrome", name: "Liquid chrome", words: "liquid chrome figures: mirror-polished metal rippling like mercury, reflections everywhere"},
  {id: "sand", name: "Sand", words: "figures made of packed sand, shedding dust with every movement, wind eroding and rebuilding them"},
  {id: "silent", name: "Silent film", words: "a 1920s silent film: black-and-white, flickering, scratched film, iris vignette"},
  {id: "noir", name: "Film noir", words: "a 1940s film noir: high-contrast black-and-white, hard venetian-blind shadows, smoke"},
  {id: "vhs", name: "VHS home video", words: "a 1980s VHS home video: smeared colour, tracking lines, soft focus"},
  {id: "lowpoly", name: "Low-poly", words: "a low-poly 3D game: flat-shaded triangles, simple bright colours"},
  {id: "pencil", name: "Pencil sketch", words: "an animated pencil sketch: graphite lines on white paper, rough construction lines"},
  {id: "fire", name: "Living fire", words: "figures made entirely of living fire: flowing flames and glowing embers, throwing warm light"},
  {id: "ghost", name: "Ghosts", words: "translucent pale-blue ghosts drifting through a dim haunted space, glowing ectoplasm"},
];

export const GENJUTSU_ROLES = ["character", "second character", "location", "style", "object", "outfit"];

// The prompt H3 gets. refs: [{role}] in slot order (<Picture 1>, <Picture 2>...).
export function genjutsuPrompt({mode = "motion", refs = [], text = "", style = null, target = ""} = {}) {
  const cast = refs.map((r, i) => `<Picture ${i + 1}> is the ${r.role}.`).join(" ");
  const tail = "One continuous shot, no cuts, no text.";
  if (mode === "restyle") return [`The whole video restyled as ${style?.words || text || "a new look"}.`, cast,
    "The people, their motion, the timing and the camera follow the control video exactly.", text && style ? text : "", tail].filter(Boolean).join(" ");
  if (mode === "swap") return [cast, `${target || "The object"} is replaced by ${refs.length ? "<Picture 1>" : (text || "something new")}, keeping its shape, folds and motion and matching the scene's light; everything else in the frame stays exactly the same.`,
    refs.length ? text : "", tail].filter(Boolean).join(" ");
  return [cast, text || "The character performs the same movements as in the control video, in the location shown.",
    "Their body follows the control video's poses and timing exactly.", tail].filter(Boolean).join(" ");
}

// End anchors: H3 pins the shot's last frame too, so a move that would otherwise leave the subject behind ends on
// them. "loop" ends on the first frame (a full orbit comes all the way round; a whip pan swings back); an `edit` makes
// the end frame from the keyframe with Qwen Image 2.1 (the same scene from where the camera should finish).
// tested Oct 19 (same keyframe): orbit_360 at 8 s goes all the way round; whip_pan swings to the river and back; fpv_drone
// circles in to a front close-up; crane_overhead rises to a steep top-down angle with her still in frame. H3 tends to
// reach the pinned frame early and hold it (up to 1.4 s), which ValisTrimHold cuts back to a quarter second.
// Trained camera moves: a LoRA that learned one move, the way Higgsfield-style presets behave (no anchors, no extra pass).
// engine "h3": the LoRA rides on the H3 shot; raw() is the prompt it was trained on; end "loop" pins the first frame as the last.
// engine "wan": Wan 2.2 I2V A14B with a high-noise camera LoRA (graphs.js wanMove), 16 fps.
// Tested Oct 19 on the levee keyframe with tools/motion_check.py. Only installed LoRAs are used (api.hasLora).
const ORBIT_FROZEN = "One frozen instant. Only the camera moves. In a continuous 360 orbit. Preserve every person and object in exactly the same world position, orientation, shape and pose throughout the shot. Airborne objects remain suspended at the captured height and angle: no wobbling, shaking, spinning, drifting, falling or continued action. Keep faces, hands, clothing, liquids and the background motionless while retaining their natural appearance. Camera parallax is the only source of apparent movement. No cuts, zoom, morphing or added objects.";
const frozenOrbit = {engine: "h3", lora: "minimax_h3_flf2v_orbit360_lora_v1.safetensors", strength: 1.0, end: "loop", orbit: true, raw: () => ORBIT_FROZEN,   // orbit: one 8.8 s pinned shot (graphs.js orbit360)
  source: "pablodawson/MiniMax-H3-360-Orbit-LoRA (MiniMax H3 community licence)"};
// Jojocodex multi-move H3 LoRA (Apache-2.0): trained captions read "camera motion, [subject], [scene], [move], [style], [quality]".
const JOJO = "camera_motion_h3_lora_v1_3000_pruned.safetensors";
const jojo = (move) => ({engine: "h3", lora: JOJO, strength: 1.0, source: "Jojocodex/minimax-h3-Camera-Motion-lora (Apache-2.0)",
  raw: ({subject = "the subject", scene = ""} = {}) => ["camera motion", (scene || subject).replace(/[.\s]+$/, ""), move.replaceAll("{subject}", subject), "cinematic, 4k, high quality"].filter(Boolean).join(", ")});
const wan = (lora, strength, phrase) => ({engine: "wan", lora, highOnly: true, strength, phrase,
  source: "Wan 2.2 high-noise camera LoRA (GhostInShell via UnifiedHorusRA; non-commercial licence)"});
export const CAMERA_LORAS = {
  orbit_360: frozenOrbit,          // a full 360 needs the 8.8 s shot and a figure standing clear (not at a table)
  bullet_time: frozenOrbit,        // the same LoRA: a frozen-time orbit
  push_in: jojo("slow push-in dolly to a tight close-up on {subject}'s face"),                                 // works: smooth push to a close-up
  super_dolly_in: jojo("slow push-in dolly to a tight close-up on {subject}'s face"),
  // dolly zoom: a real, modest push (or pull) with true parallax, then Valis Dolly Zoom locks the subject's size
  dolly_zoom_in: {...jojo("slow steady push-in dolly toward {subject} from a full shot to a medium shot, {subject} stays centered"), dolly: {maxZoom: 1.6}},
  // the Jojocodex LoRA can't pull back (it pushes in, then cuts to the empty background, twice); H3 from words does a
  // gentle, continuous pull-back, which is all the lock needs
  dolly_zoom_out: {engine: "h3", lora: null, dolly: {maxZoom: 1.6}, source: "H3 from words + Valis Dolly Zoom",
    words: "The camera slowly dollies straight back away from {subject}, a small, gentle move: they stay centered and remain the clear subject the whole time."},
  // whip pan: H3 whips by dissolving between two views. A steady pan is easy for it, so the shot is a real pan and
  // Valis Whip Pan speed-ramps it (linger, swing at ~20x with the camera's own motion blur, land back on the subject)
  whip_pan: {engine: "h3", lora: null, whip: {mode: "return"}, source: "H3 pan from words + Valis Whip Pan",
    words: "The camera pans steadily to the right on a fixed tripod, leaving {subject} and sweeping across the scene. A smooth, continuous move at an even speed."},
  crane_up: jojo("slow crane up rising high above {subject} with smooth downward tilt keeping them in the center of frame"),  // works
  fpv_drone: jojo("fast aerial drone fly-through swooping low toward {subject} and gliding past"),             // one clean fly-past; ends past them
  crash_zoom_in: wan("wan22_crashzoom_high.safetensors", 0.8, "Rapid zoom in effect, zoom in on face: the camera crash-zooms in on {subject}."),  // works: a real snap-in (Wan, 16 fps)
  arc_right: wan("wan22_arcshot_high.safetensors", 0.8, "Arc shot, camera moving from left to right around {subject}."),   // works: a quarter arc to her front
  // the arc LoRA only learned left-to-right ("right to left" came out static): arc left is arc right on the mirrored frame
  arc_left: {...wan("wan22_arcshot_high.safetensors", 0.8, "Arc shot, camera moving from left to right around {subject}."), mirror: true},    // untested; the author says direction words may be ignored
  // tried and not used: Wan 2.1 360_Orbit on Wan 2.2 (no movement); Wan 2.2 DollyZoom beta (barely moves); H3 Jojocodex
  // "ends on her face" FPV (doubles back). Dolly zoom stays H3 words + the Valis Vertigo effect.
};

const KEEP = " Keep the subject's face, hair, clothing and anything they hold, the setting and the lighting exactly the same.";
export const END_ANCHORS = {
  orbit_360: "loop", whip_pan: "loop", lazy_susan: "loop",
  crane_overhead: {edit: "Show this exact scene from directly overhead: a top-down view looking straight down on the main subject, who stays in the centre of the frame." + KEEP},
  top_down: {edit: "Show this exact scene from directly overhead: a top-down view looking straight down on the main subject, who stays in the centre of the frame." + KEEP},
  crane_up: {edit: "Show this exact scene from high above at a steep downward angle, the main subject small but clearly visible in the centre of the frame." + KEEP},
  helicopter: {edit: "Show this exact scene as a wide aerial view from high in the air, the main subject visible in the centre of the frame." + KEEP},
  fpv_drone: {edit: "Show the main subject from the front in a dramatic close-up, as if the camera has just swooped in to stop right in front of them." + KEEP},
  arc_left: {edit: "Show this exact scene from 90 degrees to the main subject's left: the subject seen in profile, centred in the frame." + KEEP},
  arc_right: {edit: "Show this exact scene from 90 degrees to the main subject's right: the subject seen in profile, centred in the frame." + KEEP},
};
// moves that need more time to complete (seconds)
export const MOVE_SECONDS = {orbit_360: 8, bullet_time: 6, earth_zoom_out: 8, hyperlapse: 8};

// Relight (Higgsfield Relight): a keyframe relit by Qwen Image 2.1 edit, same people and place, new light. Tested on the
// levee keyframe (contre-jour, lantern only, overhead, golden hour: identity and pose held) and the BURN SEASON street.
export const RELIGHT_KEEP = " Keep every person, their pose, face and clothes, and the whole scene exactly as they are; change only the light.";
export const RELIGHT = [
  {id: "contre_jour", name: "Contre-jour", words: "strong backlight from behind the subject: they become a near-silhouette with a bright rim of light around the hair and shoulders, the front in deep shadow"},
  {id: "practical", name: "Lantern / practical only", words: "the only light comes from a lamp, lantern or candle in the scene: warm local light on the faces, everything a few metres away sinks into darkness"},
  {id: "overhead", name: "Overhead fall", words: "a single hard white light from straight overhead, like a lone streetlamp: deep shadows under the brow, nose and chin, a pool of light on the ground, the rest dark"},
  {id: "golden", name: "Golden hour", words: "golden hour: low warm sunlight from the side, long soft shadows, a pale orange sky"},
  {id: "window", name: "Window", words: "soft daylight from a large window to one side, gentle falloff across the faces, the far side in soft shadow"},
  {id: "firelight", name: "Firelight", words: "lit by the orange glow of a huge fire just out of frame, red-orange light on every surface, smoke in the air, ash falling"},
  {id: "moonlight", name: "Moonlight", words: "cold blue moonlight from above and behind, dim and silvery, deep blue shadows"},
  {id: "neon", name: "Neon", words: "mixed neon: magenta light from one side, cyan from the other, glossy reflections"},
  {id: "noir", name: "Noir blinds", words: "film noir: a hard key light through venetian blinds, striped shadows across the faces and walls, deep blacks"},
  {id: "lightning", name: "Lightning", words: "a single stark flash of lightning from outside: cold white light, hard shadows, the rest of the night dark"},
];
