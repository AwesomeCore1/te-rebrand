const QUESTIONS = [
  {
    q: "Does it work on TruckersMP?",
    a: "Yes. The telemetry plugin runs inside the game, so the tracker sees the same data in singleplayer and on TruckersMP.",
  },
  {
    q: "Which games does it track?",
    a: "Euro Truck Simulator 2 and American Truck Simulator. One tracker handles both and knows which one is running.",
  },
  {
    q: "Kilometres or miles?",
    a: "Both. Everything is stored in kilometres and shown in miles when you choose it, which most ATS drivers do.",
  },
  {
    q: "Will it slow my game down?",
    a: "The tracker is a small native app written in Rust. It reads telemetry a few times a second and stays in the tray while you drive.",
  },
  {
    q: "How does my VTC get on Tacho?",
    a: "The owner registers it with its TruckersMP VTC ID, and we check on TruckersMP that they run it. Drivers who apply are checked the same way.",
  },
  {
    q: "Can other companies see our admin pages?",
    a: "No. Members, applications, flagged jobs and settings are visible only to your own company's managers.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-24 md:px-8 md:pb-32">
      <h2 className="text-center text-[clamp(2rem,4.5vw,3.5rem)] leading-[1] font-extrabold">
        Common questions.
      </h2>
      <dl className="mt-12 grid overflow-hidden rounded-[24px] border border-border bg-card md:grid-cols-2">
        {QUESTIONS.map(({ q, a }, i) => (
          <div
            key={q}
            className={`border-border p-6 md:p-8 ${i > 0 ? "border-t" : ""} ${i === 1 ? "md:border-t-0" : ""} ${i % 2 === 1 ? "md:border-l" : ""}`}
          >
            <dt className="text-[17px] font-bold">{q}</dt>
            <dd className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
