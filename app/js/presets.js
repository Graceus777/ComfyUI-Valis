// The director's panel. Every choice becomes words in the keyframe prompt (Krea 2) or the motion prompt (H3).
export const GENRES = [
  {id: "gothic", name: "Gothic horror", thumb: "gothic.jpg", style: "Cinematic live-action film still, shot on 35mm, dark and moody gothic horror, high contrast, cold blue moonlight against warm candlelight, drifting mist, fine film grain, sharp focus."},
  {id: "noir", c1: "#4a4a52", c2: "#0b0b0d", name: "Film noir", thumb: "noir.jpg", style: "Black-and-white film noir still, 1940s, hard venetian-blind shadows, wet streets, cigarette smoke, deep blacks, silver grain."},
  {id: "neon", c1: "#7a2a8a", c2: "#0a1a2a", name: "Neon sci-fi", thumb: "neon.jpg", style: "Cinematic sci-fi still, rain-soaked city at night, magenta and cyan neon reflections, volumetric haze, anamorphic flares."},
  {id: "fairytale", c1: "#6a5a22", c2: "#0e1a10", name: "Dark fairy tale", thumb: "fairytale.jpg", style: "Painterly dark fairy-tale film still, enchanted forest, shafts of golden light through fog, rich saturated colour, soft bloom."},
  {id: "western", c1: "#8a5a2a", c2: "#1a0e06", name: "Western", thumb: "western.jpg", style: "Widescreen western film still, dusty frontier town, harsh desert sun, warm ochre palette, Kodak film grain."},
  {id: "music", c1: "#5a2a8a", c2: "#0a0612", name: "Music video", thumb: "music.jpg", style: "Stylised music video still, bold colour, strong silhouette backlight, haze, graphic composition, crisp."},
  {id: "documentary", c1: "#3a4a3a", c2: "#0c100c", name: "Documentary", thumb: "documentary.jpg", style: "Natural documentary still, available light, handheld realism, true-to-life colour, shallow depth of field."},
  {id: "fantasy", c1: "#7a5a2a", c2: "#140c08", name: "Epic fantasy", thumb: "fantasy.jpg", style: "Epic fantasy film still, vast scale, dramatic clouds, rim light, rich textures, cinematic grade."},
];

export const FRAMING = [
  {id: "wide", name: "Wide", words: "Wide shot:"}, {id: "medium", name: "Medium", words: "Medium shot:"},
  {id: "close", name: "Close-up", words: "Close-up:"}, {id: "ecu", name: "Extreme close-up", words: "Extreme close-up:"},
  {id: "ots", name: "Over the shoulder", words: "Over-the-shoulder shot:"}, {id: "low", name: "Low angle", words: "Low-angle shot looking up:"},
  {id: "high", name: "High angle", words: "High-angle shot looking down:"},
];

export const LENS = [
  {id: "18", name: "18mm", words: "ultra-wide 18mm lens, deep perspective"}, {id: "35", name: "35mm", words: "35mm lens"},
  {id: "50", name: "50mm", words: "50mm lens, natural perspective"}, {id: "85", name: "85mm", words: "85mm portrait lens, creamy background blur"},
  {id: "135", name: "135mm", words: "135mm telephoto, compressed background"}, {id: "macro", name: "Macro", words: "macro lens, tiny details large"},
];

export const LIGHT = [
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

export function motionPrompt({genre, move, action}) {
  const sc = (genre?.style || "").split(",")[0];
  return `${sc}. The scene begins exactly as shown in the first frame and comes alive: ${action || "subtle natural motion"}. ${move?.words || ""}`.trim();
}

// ---------------------------------------------------------------- Edit: looks (anchor prompt for Krea, description for H3)
// {T} is replaced with the target as the user typed it ("the man", "her dress", ...)
export const LOOKS = [
  {id: "vampire", name: "Vampire", thumb: "vampire.jpg", rb: 0.5, who: "the man", keep: "the face, skin and head",
   anchor: "Transform {T} into a grotesque monstrous vampire: a gaunt, skull-like corpse face with grey-green leathery skin stretched over the bones, sunken dark eye sockets with burning red eyes, a wide mouth full of long jagged fangs, pointed bat-like ears. Inhuman and terrifying. Keep the pose, the camera angle, the framing, the background and the lighting exactly the same.",
   desc: "a grotesque monstrous vampire: a gaunt skull-like corpse face, sunken eye sockets with burning red eyes, long jagged fangs and pointed bat-like ears"},
  {id: "bride", name: "Ghost bride", thumb: "bride.jpg", rb: 4.0, who: "the woman", keep: "the veil, the gown and her face",
   anchor: "Transform {T} into a ghost bride: a long torn lace wedding veil flowing from the hair and around the shoulders, a gown of tattered ghostly lace that dissolves into mist, pale blue-white translucent skin. Keep the face, the pose, the camera angle, the framing, the background and the lighting exactly the same.",
   desc: "a ghost bride: a long torn lace wedding veil, a gown of tattered ghostly lace that dissolves into mist, pale blue-white translucent skin"},
  {id: "ghostfire", name: "Ghost-fire", thumb: "ghostfire.jpg", rb: 4.0, who: "the clothing", keep: "the material, colour and light",
   anchor: "Turn {T} into pale blue ghost-fire: translucent spectral flames and drifting wisps of glowing ectoplasm giving off cold white-blue light. Keep everything else exactly the same.",
   desc: "pale blue ghost-fire, translucent spectral flames and drifting wisps of glowing ectoplasm giving off cold white-blue light"},
  {id: "smoke", name: "Smoke & embers", thumb: "smoke.jpg", rb: 4.0, who: "the clothing", keep: "the material, colour and light",
   anchor: "Turn {T} into living black smoke with glowing ember-red seams and drifting cinders. Keep everything else exactly the same.",
   desc: "living black smoke with glowing ember-red seams and drifting cinders"},
  {id: "chrome", name: "Liquid chrome", thumb: "chrome.jpg", rb: 4.0, who: "the subject", keep: "the material and reflections",
   anchor: "Turn {T} into flowing liquid chrome: a mirror-polished metal that ripples like mercury and reflects the room around it. Keep everything else exactly the same.",
   desc: "flowing liquid chrome, a mirror-polished metal that ripples like mercury and reflects its surroundings"},
  {id: "stone", name: "Marble statue", thumb: "stone.jpg", rb: 1.5, who: "the subject", keep: "the stone texture and veins",
   anchor: "Turn {T} into a carved white marble statue with grey veins and fine chisel marks. Keep the pose, the framing and everything else exactly the same.",
   desc: "carved white marble with grey veins and fine chisel marks"},
  {id: "skeleton", name: "Skeleton", thumb: "skeleton.jpg", rb: 0.6, who: "the person", keep: "the bones and clothing",
   anchor: "Turn {T} into a living skeleton: bare bone skull and bony hands, the same clothes hanging loose. Keep the pose, the framing and everything else exactly the same.",
   desc: "a living skeleton with a bare bone skull and bony hands, wearing the same clothes"},
  {id: "fire", name: "Living fire", thumb: "fire.jpg", rb: 4.0, who: "the subject", keep: "the flames and light",
   anchor: "Turn {T} into living fire: flowing flames and glowing molten embers with a white-hot core, throwing warm orange light. Keep everything else exactly the same.",
   desc: "living fire, flowing flames and glowing molten embers with a white-hot core"},
];

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
  {id: "digital", name: "Digital cinema", words: "shot on a large-format digital cinema camera, clean and sharp"},
  {id: "35mm", name: "35mm film", words: "shot on 35mm film, natural grain, rich colour"},
  {id: "16mm", name: "16mm film", words: "shot on 16mm film, visible grain, soft and warm"},
  {id: "super8", name: "Super 8", words: "Super 8 home movie, heavy grain, light leaks, gate weave"},
  {id: "imax", name: "IMAX 65mm", words: "IMAX 65mm photography, immense detail and scale"},
  {id: "dv", name: "DV camcorder", words: "early-2000s DV camcorder footage, flat and sharp, clipped highlights"},
  {id: "vhs", name: "VHS camcorder", words: "1980s VHS camcorder footage, smeared colour, soft"},
  {id: "phone", name: "Phone", words: "smartphone video, natural and immediate"},
  {id: "action", name: "Action cam", words: "action-camera footage, ultra-wide fisheye"},
  {id: "cctv", name: "Security cam", words: "security camera footage, high fixed angle, grainy"},
  {id: "silent", name: "Silent film", words: "a 1920s hand-cranked silent film, flicker, scratches"},
];

export const LENS_KITS = [
  {id: "spherical", name: "Clean primes", words: "clean modern spherical prime lens"},
  {id: "anamorphic", name: "Anamorphic", words: "anamorphic lens, oval bokeh, horizontal blue lens flares"},
  {id: "vintage", name: "Vintage", words: "vintage lens, soft glowing highlights, swirly bokeh"},
  {id: "macro", name: "Macro", words: "macro lens, tiny details large"},
  {id: "fisheye", name: "Fisheye", words: "fisheye lens, strong barrel distortion"},
];

export const ERAS = [
  {id: "1920s", name: "1920s", words: "set in the 1920s, period costume and props", look: "sepia"},
  {id: "1940s", name: "1940s", words: "set in the 1940s, period costume and props", look: "noir"},
  {id: "1950s", name: "1950s", words: "set in the 1950s, period costume and props", look: "technicolor"},
  {id: "1960s", name: "1960s", words: "set in the 1960s, period costume and props", look: "kodachrome"},
  {id: "1970s", name: "1970s", words: "set in the 1970s, period costume and props", look: "faded_70s"},
  {id: "1980s", name: "1980s", words: "set in the 1980s, period costume and props", look: "vhs"},
  {id: "1990s", name: "1990s", words: "set in the 1990s, period costume and props", look: "film_colors"},
  {id: "2000s", name: "2000s", words: "set in the 2000s, period costume and props", look: "camcorder"},
  {id: "2010s", name: "2010s", words: "set in the 2010s", look: "teal_orange"},
  {id: "today", name: "Today", words: "", look: "natural"},
];

export const TEMPO = [
  {id: "single", name: "Single shot", words: "One continuous take, no cuts."},
  {id: "calm", name: "Calm", words: "Slow, calm, unhurried movement."},
  {id: "measured", name: "Measured", words: "Deliberate, measured movement."},
  {id: "energetic", name: "Energetic", words: "Fast, energetic movement."},
  {id: "chaotic", name: "Chaotic", words: "Frantic, chaotic movement, everything happening at once."},
];

export const LIGHTING = [
  {id: "auto", name: "Auto", words: ""},
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
