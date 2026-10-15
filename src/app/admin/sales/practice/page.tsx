import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { PERSONAS, PRACTICE_MAX_CHARS, PRACTICE_MAX_TURNS, PRACTICE_MIN_TURNS, PRACTICE_OFF, type PersonaKey } from "./coach";
import Practice from "./Practice";
import s from "../../admin.module.css";

export const runtime = "nodejs";

// Pitch practice: an AI role-play of a skeptical shop owner, then a scorecard.
// Only the public side of each persona reaches the browser; the hidden briefs
// stay in coach.ts on the server.
export default async function SalesPracticePage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const personas = (Object.keys(PERSONAS) as PersonaKey[]).map((key) => {
    const { label, who, name, scene } = PERSONAS[key];
    return { key, label, who, name, scene };
  });

  return (
    <>
      <div className={s.head}>
        <div>
          <h1 className={s.title}>Practice</h1>
          <div className={s.sub}>
            Pitch a busy, skeptical owner before you pitch a real one. Type what you&apos;d say at the counter. After {PRACTICE_MIN_TURNS} turns, get a scorecard.
          </div>
        </div>
      </div>
      <Practice
        personas={personas}
        off={process.env.ANTHROPIC_API_KEY ? null : PRACTICE_OFF}
        limits={{ min: PRACTICE_MIN_TURNS, max: PRACTICE_MAX_TURNS, chars: PRACTICE_MAX_CHARS }}
      />
    </>
  );
}
