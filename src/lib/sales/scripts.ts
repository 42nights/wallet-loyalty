import { DEFAULT_TIMEZONE, PUBLIC_BASE_URL } from "@/lib/config";
import { recipientZone } from "./compliance";
import type { Channel, Lead } from "./types";

// The sales script library (admin-sales spec §3.1-3.2). Code constants, versioned
// in git: one author (Ayaan), edited here. Bodies are the text of strategy §4.5
// A-J and the existing live-selling / sales-kit scripts, with their [brackets]
// turned into merge fields where one exists. A [bracket] that is left is for
// the rep to fill. scripts.test.ts lints every body: no prices, no Planned
// features, no speed claims, and every email ends with the CAN-SPAM footer.
//
// Syntax: {{field}} is a merge field. [[ ... ]] is an optional chunk, dropped
// when any merge field inside it is empty (e.g. the line naming the pilot shop
// before SALES_REFERENCE_SHOP is set).

export type Script = {
  id: string;
  tab: string; // the scripts-panel tab it shows under
  channel: Channel | null; // the checkContact() channel that gates it; null = never gated
  title: string;
  body: string;
  source: string;
};

export const SCRIPTS: Script[] = [
  {
    id: "counter_opener",
    tab: "Counter",
    channel: "walk_in",
    title: "At the counter: who decides?",
    source: "live-selling §3",
    body: `"Hi! Quick one. I'm {{rep_name}}, I'm local.[[ I set up the loyalty card at {{pilot_shop}} on {{pilot_street}}.]] Who decides on punch cards and rewards here? Is that you?"

- "That's me." Go to the first 10 seconds.
- "That's the owner." "Got it. What's their first name? … When are they usually in? … Great, I'll come back [day] around [time]. Can I leave this for [name]?" Write the name and your return time on the one-pager in front of them.
- "They're not here." "No problem. When's the best time to catch them?" Log it.`,
  },
  {
    id: "routing_question",
    tab: "Counter",
    channel: "walk_in",
    title: "Routing question (question 0)",
    source: "strategy §4.5 A",
    body: `"Are you here most days, or does a manager run things day to day?"

If the owner is there most days, run the counter close. If a manager runs it, use the P2 manager hand-off.`,
  },
  {
    id: "first_10_seconds",
    tab: "Counter",
    channel: "walk_in",
    title: "First 10 seconds with the owner",
    source: "live-selling §4",
    body: `"Hi {{owner_first_name}}, I'm {{rep_name}}. I'll be quick. I put loyalty cards in customers' Apple Wallets instead of paper punch cards.[[ {{pilot_shop}} down the street runs it.]] Can I ask you two quick questions about how you handle regulars now?"

- Do not say "Is this a bad time?"
- If they're clearly slammed: "You're busy. When's your slowest hour, Tuesday around 3?" Then leave within 30 seconds.`,
  },
  {
    id: "questions",
    tab: "Counter",
    channel: "walk_in",
    title: "Questions before the pitch",
    source: "live-selling §5",
    body: `1. "Do you do a punch card or anything for regulars right now?"
2. "Roughly how many of your customers are regulars, people you see every week?"
3. "If a regular stopped coming, would you know?"
4. "What happens with the paper cards? Do people lose them, forget them?"
5. "Who's on the counter at your busy times? Is there a phone or tablet back there?"
6. "If you tried this for a month, what would it need to show you for it to be worth keeping?" Write the answer down: that's the day-30 success test.`,
  },
  {
    id: "phone_call",
    tab: "Phone",
    channel: "call",
    title: "Calling the shop line",
    source: "live-selling §10",
    body: `"Hi, this is {{rep_name}}. I'm local.[[ I set up the Apple Wallet loyalty card at {{pilot_shop}} on {{pilot_street}}.]] Quick question: who decides on your punch cards or rewards there?"

- Staff: "Got it. What's their first name? … When are they usually in? … Perfect, I'll stop by {{visit_day}} around 3. Thanks, [staff name]."
- Owner: "I'll be quick. This is much better seen on your own phone than heard over the phone. I'm in [area] Tuesday and Wednesday afternoon. Could I stop by for ten minutes, Tuesday at 3 or Wednesday at 3:30?" (Offer two times. Don't ask whether they're free.)`,
  },
  {
    id: "phone_rule_line",
    tab: "Phone",
    channel: "call",
    title: "Book the visit only (TX, OK, and good practice everywhere)",
    source: "strategy §4.5 E",
    body: `"I won't take your time on the phone. It's much better seen on your own phone. Could I stop by Tuesday at 3 or Wednesday at 3:30 for ten minutes?"

No price, no "yes" and no payment on the phone.`,
  },
  {
    id: "voicemail",
    tab: "Voicemail",
    channel: "voicemail",
    title: "Voicemail (max 2, under 20 seconds)",
    source: "live-selling §10",
    body: `"Hi, it's {{rep_name}}. I'm local[[, I set up the Apple Wallet loyalty card at {{pilot_shop}}]]. I'll stop by {{visit_day}} around 3[[ to show {{owner_first_name}}]] in person. No need to call back."`,
  },
  {
    id: "email_first_touch",
    tab: "Email",
    channel: "email",
    title: "Email: first touch",
    source: "sales-kit §4.2 + footer (strategy §4.5 C)",
    body: `Subject: A loyalty card for {{business_name}} that lives in Apple Wallet

Hi {{owner_first_name}},

I'm {{rep_name}}, based in [area]. I've built a loyalty card for independent {{segment_line}}s that customers keep in Apple Wallet instead of their pocket.

- Customers join from a QR code at your counter: name, phone, add to Wallet. No app.
- Staff scan the card on a phone or tablet you already have and type the bill amount.
- You get a dashboard: members, repeat rate, your busiest hours, and a list of regulars who have stopped coming.
- Prefer stamps to points? It can run as a stamp card instead, with one reward when the card is full.
- A printed "Scan to join" poster for your counter.

There's a two-minute interactive demo at {{demo_link}}. I'm offering a free 30-day pilot to a few local businesses and I'll set everything up. Would a 10-minute visit this week work?

{{rep_name}} · [phone]

{{footer}}`,
  },
  {
    id: "email_followup",
    tab: "Email",
    channel: "email",
    title: "Email: follow-up (4 to 5 days later)",
    source: "sales-kit §4.3 + footer",
    body: `Hi {{owner_first_name}}, just bumping this in case it got buried. Happy to show you in 10 minutes at the counter whenever suits. If loyalty isn't a priority right now, no worries.

{{footer}}`,
  },
  {
    id: "email_after_demo",
    tab: "Email",
    channel: "email",
    title: "Email: after a demo",
    source: "sales-kit §4.4 + footer",
    body: `Thanks for your time today, {{owner_first_name}}. As promised: free 30-day pilot, I set it up, and we review your dashboard together at the end. To start I need your logo, your brand colours, and which reward set you want (restaurant, café or retail). Reply with those and I'll have your card ready within [a timeframe you can actually meet].

{{footer}}`,
  },
  {
    id: "dm_first_touch",
    tab: "DM",
    channel: "dm",
    title: "Instagram/Facebook DM (active accounts only)",
    source: "sales-kit §4.1",
    body: `Hi {{owner_first_name}}, love [specific item from their feed]. I'm a local founder with a loyalty card that lives in your customers' Apple Wallet: they add it from a QR code, your staff scan it at the till, and you get a dashboard of your regulars. You can try it here: {{demo_link}}. Could I stop by for 10 minutes and show you on your own phone? The first month is a free pilot.`,
  },
  {
    id: "p2_manager_handoff",
    tab: "P2 owner",
    channel: "walk_in",
    title: "Semi-absentee owner: manager hand-off at the counter",
    source: "strategy §4.5 B",
    body: `To the manager, after the 90-second demo:

"You've seen it. Your staff would run it, so your opinion matters most. Who signs off on things like this? … Can I email [owner] a 2-minute demo, or would you rather forward it? And when are they usually in, Saturdays?"`,
  },
  {
    id: "p2_owner_email",
    tab: "P2 owner",
    channel: "email",
    title: "Semi-absentee owner: email to the owner",
    source: "strategy §4.5 B",
    body: `Only with the manager's OK or a published business email.

Subject: {{business_name}}: what your counter rang up today

Hi {{owner_first_name}}, I stopped by {{business_name}} on [day] and showed [manager name] a loyalty card that lives in your customers' Apple Wallet. One thing owners who aren't in every day like: the dashboard on your phone shows who your regulars are, who stopped coming, and what each staff member rang up, with any unusually large bill flagged. It runs on the phone or tablet already at your counter, and I set it up for you. There's a 2-minute demo at {{demo_link}}. I'm back[[ on {{street}}]] {{visit_day}}. Could I show you in 10 minutes then, or on a Saturday morning?

{{footer}}`,
  },
  {
    id: "close_the_loop",
    tab: "Close-the-loop",
    channel: "email",
    title: "Close-the-loop email (day 14)",
    source: "strategy §4.5 D",
    body: `Hi {{owner_first_name}}, I don't want to keep filling your inbox. Should I check back in a few months, or is loyalty just not a priority? Either answer helps.

{{footer}}`,
  },
  {
    id: "opt_out",
    tab: "Opt-out",
    channel: null,
    title: "Opt-out, word for word",
    source: "strategy §4.5 F",
    body: `"Understood, I'll take you off our list today. Sorry to bother you."

Then log the outcome "opt out" before you do anything else. Never argue and never try "one last thing".`,
  },
  {
    id: "franchise_unit",
    tab: "Franchise",
    channel: "walk_in",
    title: "Franchise unit",
    source: "strategy §4.5 G",
    body: `"Thanks. Since you're a [brand] franchise, I'd need your franchisor's OK before setting anything up. Do you know if [brand] already has a loyalty program they require? … Who at head office handles marketing?"

Log the brand and do not demo for a sale. Check FDD Items 8 and 11 first.`,
  },
  {
    id: "referral_ask",
    tab: "Referral ask",
    channel: "walk_in",
    title: "Merchant referral ask",
    source: "strategy §4.5 H",
    body: `At go-live, at the day-30 review, after the first campaign:

"Who's another owner nearby you're friendly with? If you'd text them yourself, something like 'the guy who set up my Wallet card is legit, worth 10 minutes', I'll stop by. If they sign up, you both get a month free."

The merchant sends the text from their own phone; we don't. Log "referred by".`,
  },
  {
    id: "partner_pitch",
    tab: "Partner",
    channel: "walk_in",
    title: "Partner pitch: bookkeeper, print/sign shop, web agency",
    source: "strategy §4.5 I",
    body: `"Hi [name], I run 42nights. We put a restaurant's loyalty card in their customers' Apple Wallet instead of a paper punch card: no app, no hardware, I set it up. You already look after [restaurants/cafés]. When one of them asks about loyalty, or you're printing their menus, would you introduce me? For every shop that becomes a paying customer, you get 20% of what they pay us for two years, paid monthly. Here's the 2-minute demo: {{demo_link}}. Can I buy you a coffee and show you on your phone?"

By email, add the footer.`,
  },
  {
    id: "iso_pitch",
    tab: "ISO",
    channel: "walk_in",
    title: "ISO / Clover dealer pitch",
    source: "strategy §4.5 J",
    body: `"You're already in front of restaurant owners every week, and loyalty is an add-on they ask about. Ours lives in Apple Wallet, which Clover Rewards doesn't appear to do [say only after re-checking]. It needs no hardware and runs month to month. You demo it, I do the setup, and you earn 30% of the subscription for 24 months while the merchant pays. I'll train you in one afternoon and give you demo access."

Never offer Square or Toast resellers this deal: both sell their own loyalty.`,
  },
];

export const MERGE_KEYS = [
  "business_name", "owner_first_name", "street", "cluster", "segment_line", "rep_name",
  "pilot_shop", "pilot_street", "demo_link", "visit_day", "footer",
] as const;
export type MergeKey = (typeof MERGE_KEYS)[number];
// null = missing: the fallback below is used, and an optional chunk naming it is dropped.
export type MergeFields = Record<MergeKey, string | null>;

const FALLBACK: Partial<Record<MergeKey, string>> = { owner_first_name: "there", visit_day: "this week" };

export type SalesEnv = { postalAddress: string | null; referenceShop: string | null; baseUrl: string };

// Server-only in practice (the values are not NEXT_PUBLIC_): a page reads it
// and hands the result to client components.
export function salesEnv(): SalesEnv {
  return {
    postalAddress: process.env.SALES_POSTAL_ADDRESS?.trim() || null,
    referenceShop: process.env.SALES_REFERENCE_SHOP?.trim() || null,
    baseUrl: PUBLIC_BASE_URL,
  };
}

export const FOOTER_MISSING = "Set SALES_POSTAL_ADDRESS (CAN-SPAM)";

const SEGMENT_WORD: Record<Lead["segment"], string> = { cafe: "café", restaurant: "restaurant", retail: "shop", other: "shop" };

// Strategy §4.5 C. Only built when the postal address is set.
export function footerText(lead: Pick<Lead, "business_name" | "segment">, postalAddress: string): string {
  return (
    `42nights · ${postalAddress}\n` +
    `You're getting this because ${lead.business_name} is a local ${SEGMENT_WORD[lead.segment]}. ` +
    `This is a promotional message. Not interested? Reply "no thanks" and I won't email again.`
  );
}

export function mergeFields(
  lead: Pick<Lead, "id" | "business_name" | "owner_name" | "address" | "cluster" | "segment" | "source" | "next_action_at" | "recipient_tz" | "state">,
  repName: string | null,
  env: SalesEnv
): MergeFields {
  // "Bean & Bun, Elm St" → shop "Bean & Bun", street "Elm St".
  const [shop, ...street] = (env.referenceShop ?? "").split(",");
  const tz = recipientZone(lead).tz ?? DEFAULT_TIMEZONE;
  return {
    business_name: lead.business_name,
    owner_first_name: lead.owner_name?.trim().split(/\s+/)[0] || null,
    street: lead.address?.replace(/^\s*[\d-]+[a-z]?\s+/i, "").trim() || null,
    cluster: lead.cluster || null,
    segment_line: SEGMENT_WORD[lead.segment],
    rep_name: repName?.trim() || "Ayaan",
    pilot_shop: shop.trim() || null,
    pilot_street: street.join(",").trim() || null,
    demo_link: `${env.baseUrl}/demo?src=${encodeURIComponent(lead.source)}-${lead.id.slice(0, 8)}`,
    visit_day: lead.next_action_at
      ? new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: tz }).format(new Date(lead.next_action_at))
      : null,
    footer: env.postalAddress ? footerText(lead, env.postalAddress) : null,
  };
}

const FIELD_RE = /\{\{(\w+)\}\}/g;

export function fillTemplate(body: string, f: MergeFields): string {
  const value = (k: string) => (f as Record<string, string | null>)[k];
  return body
    .replace(/\[\[([\s\S]*?)\]\]/g, (_, chunk: string) =>
      [...chunk.matchAll(FIELD_RE)].some(([, k]) => !value(k)) ? "" : chunk
    )
    .replace(FIELD_RE, (_, k: string) => value(k) ?? FALLBACK[k as MergeKey] ?? "");
}

// A script ready to show: the filled text, or why it can't be used yet. The
// panel also disables it when checkContact() blocks script.channel.
export function renderScript(script: Script, f: MergeFields): { text: string; disabled: string | null } {
  const needsFooter = script.body.includes("{{footer}}");
  return { text: fillTemplate(script.body, f), disabled: needsFooter && !f.footer ? FOOTER_MISSING : null };
}
