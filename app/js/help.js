// "How it fits together": the tabs and what passes between them, drawn once, opened from the header's "?".
import {h} from "./ui.js";

const NODES = {
  film: {x: 225, y: 70, t: "Film", s: "one line → a cut film"},
  create: {x: 225, y: 250, t: "Create", s: "keyframe → shot"},
  score: {x: 225, y: 430, t: "Score", s: "a song as lanes"},
  bin: {x: 450, y: 250, t: "Bin", s: "everything made", big: true},
  edit: {x: 745, y: 70, t: "Edit", s: "change, remove, swap, turn"},
  genjutsu: {x: 745, y: 190, t: "Genjutsu", s: "motion, restyle, swap"},
  fx: {x: 745, y: 310, t: "FX", s: "effects on cue"},
  extras: {x: 745, y: 430, t: "Extras", s: "stereo, loops, stage"},
};
// [from, to, label, both ways, bend (px, a curve to the side)]
const EDGES = [
  ["film", "create", "a shot to Create, and back", true, 0], ["score", "film", "a film on its song", false, -250],
  ["create", "bin", "shots", true, 0], ["film", "bin", "stills, shots, the film", false, 0], ["score", "bin", "rendered shots, the cut", false, 0],
  ["bin", "edit", "clips", false, 0], ["bin", "genjutsu", "clips", false, 0], ["bin", "fx", "clips", false, 0], ["bin", "extras", "stills, clips", false, 0],
  ["fx", "score", "fires on the score's lanes", true, -70], ["extras", "fx", "a loop's effects loop too", false, 0],
];
export function showHelp() {
  document.querySelector(".helpov")?.remove();
  const W = 900, H = 500, NS = "http://www.w3.org/2000/svg";
  const s = (tag, a = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); kids.forEach(k => e.append(k)); return e; };
  const svg = s("svg", {viewBox: `0 0 ${W} ${H}`, class: "helpsvg"});
  svg.append(s("defs", {}, s("marker", {id: "ar", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse"}, s("path", {d: "M0,0 L10,5 L0,10 z", fill: "#7d8aa6"}))));
  for (const [a, b, label, both, bend] of EDGES) {
    const A = NODES[a], B = NODES[b], dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
    // leave each box from the side facing the other (a curve leaves sideways)
    const out = (N, toX, toY) => { const ex = toX - N.x, ey = toY - N.y; if (N.big) { const l = Math.hypot(ex, ey); return [N.x + ex / l * 64, N.y + ey / l * 64]; }
      const k = Math.min(96 / Math.max(Math.abs(ex), 1e-6), 34 / Math.max(Math.abs(ey), 1e-6)); return [N.x + ex * k, N.y + ey * k]; };
    const cx = (A.x + B.x) / 2 + nx * bend, cy = (A.y + B.y) / 2 + ny * bend;
    const [x1, y1] = out(A, bend ? cx : B.x, bend ? cy : B.y), [x2, y2] = out(B, bend ? cx : A.x, bend ? cy : A.y);
    svg.append(s("path", {d: bend ? `M${x1},${y1} Q${cx},${cy} ${x2},${y2}` : `M${x1},${y1} L${x2},${y2}`, fill: "none", stroke: "#4d566b", "stroke-width": 1.4,
      "marker-end": "url(#ar)", ...(both ? {"marker-start": "url(#ar)"} : {})}));
    const mx = bend ? .25 * x1 + .5 * cx + .25 * x2 : (x1 + x2) / 2, my = bend ? .25 * y1 + .5 * cy + .25 * y2 : (y1 + y2) / 2;
    const t = s("text", {x: mx + (bend ? nx * 10 : 0), y: my - 6, "text-anchor": "middle", class: "hl"}); t.textContent = label; svg.append(t);
  }
  for (const [id, n] of Object.entries(NODES)) {
    const g = s("g", {class: "hn" + (n.big ? " big" : ""), "data-view": id});
    g.append(n.big ? s("circle", {cx: n.x, cy: n.y, r: 62}) : s("rect", {x: n.x - 92, y: n.y - 30, width: 184, height: 60, rx: 12}));
    const t1 = s("text", {x: n.x, y: n.y - 3, "text-anchor": "middle", class: "ht"}); t1.textContent = n.t;
    const t2 = s("text", {x: n.x, y: n.y + 16, "text-anchor": "middle", class: "hs"}); t2.textContent = n.s;
    g.append(t1, t2); svg.append(g);
  }
  const ov = h("div", {class: "helpov", onclick: (e) => { if (e.target === ov) ov.remove(); }},
    h("div", {class: "helpbox"},
      h("div", {class: "hh"}, h("h2", {}, "How the tabs work together"), h("button", {class: "x", type: "button", onclick: () => ov.remove()}, "×")),
      svg,
      h("ul", {},
        h("li", {}, h("b", {}, "The bin"), " (bottom right, and Renders) holds every still, clip and song the studio makes. Click one to send it to a tab, or drag it onto any drop zone or Film shot."),
        h("li", {}, h("b", {}, "Film"), " plans a whole film, but every shot can go to ", h("b", {}, "Create"), " for the full director's panel (lens, light, palette, trained moves) and come back as the film's still or shot."),
        h("li", {}, h("b", {}, "Score"), " turns any song into lanes. ", h("b", {}, "FX"), " can fire on those lanes, and ", h("i", {}, "Make a film on it"), " starts a Film on that song."),
        h("li", {}, h("b", {}, "Extras"), ": a loop goes to FX with its effects looping too; any clip can be hidden in noise."),
        h("li", {}, "Every option has a tooltip with the exact words it adds. Every button's time comes from this machine's own past jobs (a ", h("b", {}, "?"), " means it hasn't run that kind of job here yet)."),
        h("li", {}, "Keys: ", h("b", {}, "0"), " Film · ", h("b", {}, "1"), " Create · ", h("b", {}, "2"), " Edit · ", h("b", {}, "6"), " Genjutsu · ", h("b", {}, "3"), " Score · ", h("b", {}, "4"), " FX · ", h("b", {}, "7"), " Extras · ", h("b", {}, "5"), " Renders · ", h("b", {}, "?"), " this help"))));
  document.body.append(ov);
  return ov;
}
