// A rep's territory and captain role (strategy §7.2: reps in 2-3
// neighbourhoods, one captain each). sales_people has no column for either,
// so the roster keeps them as labelled first lines of notes, plain text a
// person can read: "Territory: Park Slope" and "Role: captain". Pure: the
// page reads them on the server, the form writes them in the browser.

export type Profile = { territory: string; captain: boolean; notes: string };

const LINE = /^(territory|role):[ \t]*(.*)$/i;

export function readProfile(raw: string | null): Profile {
  const lines = (raw ?? "").split("\n");
  const p: Profile = { territory: "", captain: false, notes: "" };
  let i = 0;
  for (let m; i < lines.length && (m = LINE.exec(lines[i].trim())); i++) {
    if (m[1].toLowerCase() === "territory") p.territory = m[2].trim();
    else p.captain = m[2].trim().toLowerCase() === "captain";
  }
  p.notes = lines.slice(i).join("\n").trim();
  return p;
}

export function writeProfile(p: Profile): string | null {
  const territory = p.territory.replace(/\s+/g, " ").trim();
  return [territory && `Territory: ${territory}`, p.captain && "Role: captain", p.notes.trim()].filter(Boolean).join("\n") || null;
}
