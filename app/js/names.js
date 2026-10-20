// Naive names from a scene description, for SAM 3: every noun phrase that is a thing (not clothing, light, a style or
// a pronoun), "the" in front, at most 8. The person edits them before splitting; this only saves typing.
export function suggestNames(prompt) {
  const SPLIT = /\s+(?:and|with|holding|carrying|on|at|in front of|behind|beside|next to|under|beneath|near|over|above|below|against|in|inside|by|among|across|along|around|through|into|from|of|while|who|that|which|wearing|toward|towards|facing|overlooking|climbing|leaning on|looking at)\s+/i;
  const LEAD = /^(?:toward|towards|to|into|onto|up|down|a|an|the|some|two|three|four|five|six|several|many|one|a pair of|a row of|rows of|its|his|her|their|our|lone|single)\s+/i;
  const TAIL = /\s+(?:burning|glowing|standing|sitting|flying|falling|shining|walking|lit|rising|floating|hanging|waiting|looming|smoking|erupting|flickering|reading|watching|looking|staring|crashing|drifting|swirling|dancing|running|flowing|pouring|blowing|breaking|climbing)$/i;
  const SKIP = /^(?:him|her|them|it|us|me|you|hand|hands|face|eyes|eye|head|arm|arms|leg|legs|hair|fingers|feet|cloak|cape|coat|dress|robe|robes|gown|hat|hood|collar|shirt|armor|armour|jacket|boots|gloves|mask|light|lighting|glow|shadows?|style|photo|photograph|painting|render|shot|view|scene|frame|night|day|evening|morning|dusk|dawn|mood|atmosphere|fog|haze|cinematic|background|foreground|distance|left|right|center|centre|middle|top|bottom|side|front|back)$/i;
  const out = [];
  for (const chunk of prompt.split(/[,.;:!?\n]+/)) {
    for (let p of chunk.split(SPLIT)) {
      p = p.trim().toLowerCase();
      for (let k = 0; k < 3; k++) p = p.replace(LEAD, "");
      p = p.replace(TAIL, "").replace(/\s+/g, " ").trim();
      const w = p.split(" ").filter(Boolean);
      if (!w.length || w.length > 4 || SKIP.test(w[w.length - 1]) || /^\d/.test(p) || /\b(?:cinematic|style|lens|mm|film|shot|lighting|light)\b/.test(p)) continue;
      const n = "the " + p;
      if (!out.includes(n)) out.push(n);
    }
  }
  if (/\b(?:sky|skies|night|clouds?|stars?|moon|sunset|sunrise|dawn|dusk|horizon)\b/i.test(prompt) && !out.some(n => /\bsky\b/.test(n))) out.unshift("the sky");
  return out.slice(0, 8);
}
